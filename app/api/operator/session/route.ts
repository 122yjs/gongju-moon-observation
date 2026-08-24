import {
  clearOperatorCookie,
  createOperatorCookie,
  getOperatorSession,
  safeSecretEqual,
  sha256Hex,
} from "../../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import { getEnv } from "../../../../lib/runtime";

export async function GET(request: Request) {
  try {
    return json({ authenticated: Boolean(await getOperatorSession(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = (await request.json()) as { password?: unknown };
    if (typeof payload.password !== "string" || payload.password.length < 12 || payload.password.length > 256) {
      throw new HttpError(401, "운영자 비밀번호를 확인해 주세요.");
    }
    const suppliedHash = await sha256Hex(payload.password);
    if (!(await safeSecretEqual(suppliedHash, getEnv().ADMIN_PASSWORD_HASH.trim().toLowerCase()))) {
      throw new HttpError(401, "운영자 비밀번호를 확인해 주세요.");
    }
    return json({ ok: true }, { headers: { "Set-Cookie": await createOperatorCookie() } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return json({ ok: true }, { headers: { "Set-Cookie": clearOperatorCookie() } });
  } catch (error) {
    return errorResponse(error);
  }
}

import {
  clearAdminCookie,
  createAdminCookie,
  getAdminSession,
  safeSecretEqual,
  sha256Hex,
} from "../../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import { getEnv } from "../../../../lib/runtime";

export async function GET(request: Request) {
  try {
    return json({ authenticated: Boolean(await getAdminSession(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = (await request.json()) as { password?: unknown };
    if (typeof payload.password !== "string" || payload.password.length < 12 || payload.password.length > 256) {
      throw new HttpError(401, "관리 비밀번호가 올바르지 않습니다.");
    }
    const submittedHash = await sha256Hex(payload.password);
    if (!(await safeSecretEqual(submittedHash, getEnv().ADMIN_PASSWORD_HASH))) {
      throw new HttpError(401, "관리 비밀번호가 올바르지 않습니다.");
    }
    return json(
      { ok: true },
      { headers: { "Set-Cookie": await createAdminCookie() } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return json({ ok: true }, { headers: { "Set-Cookie": clearAdminCookie() } });
  } catch (error) {
    return errorResponse(error);
  }
}

import {
  clearStudentCookie,
  createStudentCookie,
  getStudentSession,
  safeSecretEqual,
} from "../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../lib/http";
import { getClassLabel, getEnv } from "../../../lib/runtime";

export async function GET(request: Request) {
  try {
    const session = await getStudentSession(request);
    return json({
      authenticated: Boolean(session),
      classLabel: session ? getClassLabel() : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = (await request.json()) as { token?: unknown };
    if (typeof payload.token !== "string" || payload.token.length < 32 || payload.token.length > 256) {
      throw new HttpError(401, "유효하지 않거나 만료된 수업 참여 링크입니다.");
    }
    if (!(await safeSecretEqual(payload.token, getEnv().CLASS_INVITE_TOKEN))) {
      throw new HttpError(401, "유효하지 않거나 만료된 수업 참여 링크입니다.");
    }

    return json(
      { ok: true, classLabel: getClassLabel() },
      { headers: { "Set-Cookie": await createStudentCookie() } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return json({ ok: true }, { headers: { "Set-Cookie": clearStudentCookie() } });
  } catch (error) {
    return errorResponse(error);
  }
}

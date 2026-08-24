import { getOperatorSession } from "../../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import { getOAuthConfig, saveOAuthConfig } from "../../../../lib/tenant";

async function requireOperator(request: Request) {
  if (!(await getOperatorSession(request))) throw new HttpError(401, "운영자 로그인이 필요합니다.");
}

export async function GET(request: Request) {
  try {
    await requireOperator(request);
    const config = await getOAuthConfig();
    return json({
      configured: Boolean(config),
      clientId: config?.clientId || "",
      updatedAt: config?.updatedAt || null,
      redirectUri: `${new URL(request.url).origin}/api/google/callback`,
      scope: "https://www.googleapis.com/auth/drive.file",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    await requireOperator(request);
    const payload = (await request.json()) as { clientId?: unknown; clientSecret?: unknown };
    if (typeof payload.clientId !== "string" || typeof payload.clientSecret !== "string") {
      throw new HttpError(400, "OAuth 클라이언트 ID와 보안 비밀번호를 입력해 주세요.");
    }
    await saveOAuthConfig(payload.clientId, payload.clientSecret);
    return json({ ok: true, message: "Google OAuth 설정을 암호화해 저장했습니다." });
  } catch (error) {
    return errorResponse(error);
  }
}

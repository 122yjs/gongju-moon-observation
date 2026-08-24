import { createOAuthStateCookie } from "../../../../lib/auth";
import { buildGoogleAuthorizationUrl } from "../../../../lib/google-drive";

function errorRedirect(request: Request, error: unknown) {
  const message = error instanceof Error ? error.message : "Google Drive 연결을 시작하지 못했습니다.";
  const url = new URL("/admin", request.url);
  url.searchParams.set("error", message);
  return Response.redirect(url, 302);
}

export async function GET(request: Request) {
  try {
    const { state, cookie } = createOAuthStateCookie();
    const location = await buildGoogleAuthorizationUrl(new URL(request.url).origin, state);
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Set-Cookie": cookie, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorRedirect(request, error);
  }
}

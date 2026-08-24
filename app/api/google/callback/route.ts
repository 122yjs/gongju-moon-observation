import {
  clearOAuthStateCookie,
  createTeacherCookie,
  getOAuthState,
  safeSecretEqual,
} from "../../../../lib/auth";
import { randomToken, sha256Hex } from "../../../../lib/crypto";
import {
  createIdentityFolder,
  deleteDriveFile,
  exchangeAuthorizationCode,
  getFolderOwner,
  initializeTeacherDrive,
  verifyTeacherDrive,
} from "../../../../lib/google-drive";
import {
  createTeacherConnection,
  getTeacherByGooglePermissionId,
  reconnectTeacher,
  revealRefreshToken,
  updateTeacherAccessToken,
} from "../../../../lib/tenant";

function redirectResponse(request: Request, path: string, cookies: string[] = []) {
  const headers = new Headers({ Location: new URL(path, request.url).toString(), "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const expectedState = getOAuthState(request);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const googleError = url.searchParams.get("error");
  let accessToken: string | null = null;
  let candidateRootId: string | null = null;

  try {
    if (googleError) throw new Error("Google Drive 연결이 취소되었거나 승인되지 않았습니다.");
    if (!expectedState || !state || !(await safeSecretEqual(expectedState, state))) {
      throw new Error("Google 연결 요청의 보안 확인에 실패했습니다. 다시 시도해 주세요.");
    }
    if (!code || code.length > 2048) throw new Error("Google에서 연결 승인 코드를 받지 못했습니다.");

    const tokens = await exchangeAuthorizationCode(url.origin, code);
    accessToken = tokens.access_token;
    candidateRootId = await createIdentityFolder(accessToken);
    const identity = await getFolderOwner(accessToken, candidateRootId);
    const existing = await getTeacherByGooglePermissionId(identity.permissionId);
    let teacher;

    if (existing) {
      const refreshToken = tokens.refresh_token || (await revealRefreshToken(existing));
      const existingDriveAvailable = await verifyTeacherDrive(accessToken, existing).catch(() => false);
      if (existingDriveAvailable) {
        await deleteDriveFile(accessToken, candidateRootId).catch(() => undefined);
        candidateRootId = null;
        teacher = await reconnectTeacher(existing, {
          googleEmail: identity.email,
          googleDisplayName: identity.displayName,
          refreshToken,
        });
      } else {
        const resources = await initializeTeacherDrive(accessToken, candidateRootId);
        teacher = await reconnectTeacher(existing, {
          googleEmail: identity.email,
          googleDisplayName: identity.displayName,
          refreshToken,
          ...resources,
        });
        candidateRootId = null;
      }
    } else {
      if (!tokens.refresh_token) {
        throw new Error("장기 연결 토큰을 받지 못했습니다. Google 연결을 다시 승인해 주세요.");
      }
      const resources = await initializeTeacherDrive(accessToken, candidateRootId);
      const inviteToken = randomToken(32);
      teacher = await createTeacherConnection({
        googlePermissionId: identity.permissionId,
        googleEmail: identity.email,
        googleDisplayName: identity.displayName,
        refreshToken: tokens.refresh_token,
        ...resources,
        inviteToken,
        inviteTokenHash: await sha256Hex(inviteToken),
        classLabel: "우리 반",
      });
      candidateRootId = null;
    }

    const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000).toISOString();
    await updateTeacherAccessToken(teacher.id, accessToken, expiresAt);
    return redirectResponse(request, "/admin?connected=1", [
      clearOAuthStateCookie(),
      await createTeacherCookie(teacher.id),
    ]);
  } catch (error) {
    if (accessToken && candidateRootId) {
      await deleteDriveFile(accessToken, candidateRootId).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Google Drive를 연결하지 못했습니다.";
    const target = new URL("/admin", request.url);
    target.searchParams.set("error", message);
    return redirectResponse(request, `${target.pathname}${target.search}`, [clearOAuthStateCookie()]);
  }
}

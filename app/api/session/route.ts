import {
  clearStudentCookie,
  createStudentCookie,
  getStudentSession,
  safeSecretEqual,
  sha256Hex,
} from "../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../lib/http";
import { getTeacherById, getTeacherByInviteHash } from "../../../lib/tenant";

export async function GET(request: Request) {
  try {
    const session = await getStudentSession(request);
    if (!session?.teacherId) return json({ authenticated: false, classLabel: null });
    const teacher = await getTeacherById(session.teacherId);
    if (!teacher) {
      return json(
        { authenticated: false, classLabel: null },
        { headers: { "Set-Cookie": clearStudentCookie() } },
      );
    }
    return json({ authenticated: true, classLabel: teacher.classLabel });
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
    const hash = await sha256Hex(payload.token);
    const teacher = await getTeacherByInviteHash(hash);
    if (!teacher || !(await safeSecretEqual(hash, teacher.inviteTokenHash))) {
      throw new HttpError(401, "유효하지 않거나 만료된 수업 참여 링크입니다.");
    }
    return json(
      { ok: true, classLabel: teacher.classLabel },
      { headers: { "Set-Cookie": await createStudentCookie(teacher.id) } },
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

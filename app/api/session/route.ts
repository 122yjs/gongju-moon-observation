import {
  clearStudentCookie,
  createStudentCookie,
  createStudentResumeToken,
  getStudentResumeSession,
  getStudentSession,
  safeSecretEqual,
  sha256Hex,
} from "../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../lib/http";
import { getTeacherById, getTeacherByInviteHash } from "../../../lib/tenant";

export async function GET(request: Request) {
  try {
    const session = await getStudentSession(request);
    if (!session?.teacherId) {
      return json({
        authenticated: false,
        classLabel: null,
        regionLabel: null,
        regionShortLabel: null,
        observationLat: null,
        observationLon: null,
      });
    }
    const teacher = await getTeacherById(session.teacherId);
    if (!teacher) {
      return json(
        {
          authenticated: false,
          classLabel: null,
          regionLabel: null,
          regionShortLabel: null,
          observationLat: null,
          observationLon: null,
        },
        { headers: { "Set-Cookie": clearStudentCookie() } },
      );
    }
    return json({
      authenticated: true,
      draftScope: await sha256Hex(`student-draft:${teacher.id}`),
      resumeToken: await createStudentResumeToken(teacher.id),
      classLabel: teacher.classLabel,
      regionLabel: teacher.regionLabel,
      regionShortLabel: teacher.regionShortLabel,
      observationLat: teacher.observationLat,
      observationLon: teacher.observationLon,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = (await request.json()) as { token?: unknown; resumeToken?: unknown };
    if (typeof payload.resumeToken === "string") {
      if (payload.resumeToken.length < 32 || payload.resumeToken.length > 1024) {
        throw new HttpError(401, "수업 참여 확인을 복원하지 못했습니다.");
      }
      const resumeSession = await getStudentResumeSession(payload.resumeToken);
      const resumedTeacher = resumeSession?.teacherId ? await getTeacherById(resumeSession.teacherId) : null;
      if (!resumedTeacher) throw new HttpError(401, "수업 참여 확인을 복원하지 못했습니다.");
      return json(
        {
          ok: true,
          authenticated: true,
          draftScope: await sha256Hex(`student-draft:${resumedTeacher.id}`),
          resumeToken: await createStudentResumeToken(resumedTeacher.id),
          classLabel: resumedTeacher.classLabel,
          regionLabel: resumedTeacher.regionLabel,
          regionShortLabel: resumedTeacher.regionShortLabel,
          observationLat: resumedTeacher.observationLat,
          observationLon: resumedTeacher.observationLon,
        },
        { headers: { "Set-Cookie": await createStudentCookie(resumedTeacher.id) } },
      );
    }
    if (typeof payload.token !== "string" || payload.token.length < 32 || payload.token.length > 256) {
      throw new HttpError(401, "유효하지 않거나 만료된 수업 참여 링크입니다.");
    }
    const hash = await sha256Hex(payload.token);
    const teacher = await getTeacherByInviteHash(hash);
    if (!teacher || !(await safeSecretEqual(hash, teacher.inviteTokenHash))) {
      throw new HttpError(401, "유효하지 않거나 만료된 수업 참여 링크입니다.");
    }
    return json(
      {
        ok: true,
        authenticated: true,
        draftScope: await sha256Hex(`student-draft:${teacher.id}`),
        resumeToken: await createStudentResumeToken(teacher.id),
        classLabel: teacher.classLabel,
        regionLabel: teacher.regionLabel,
        regionShortLabel: teacher.regionShortLabel,
        observationLat: teacher.observationLat,
        observationLon: teacher.observationLon,
      },
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

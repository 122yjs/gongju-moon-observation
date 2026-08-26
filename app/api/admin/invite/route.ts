import { getTeacherSession } from "../../../../lib/auth";
import { randomToken, sha256Hex } from "../../../../lib/crypto";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import {
  getTeacherById,
  listTeacherClasses,
  revealInviteToken,
  rotateInviteToken,
} from "../../../../lib/tenant";

async function requireTeacher(request: Request) {
  const session = await getTeacherSession(request);
  if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
  const teacher = await getTeacherById(session.teacherId);
  if (!teacher) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
  return teacher;
}

interface ClassInvite {
  id: string;
  classLabel: string;
  joinUrl: string;
  rootFolderUrl: string;
  spreadsheetUrl: string;
  createdAt: string;
  updatedAt: string;
}

async function responseFor(request: Request, teacher: Awaited<ReturnType<typeof requireTeacher>>) {
  const origin = new URL(request.url).origin;
  const classes = await Promise.all(
    (await listTeacherClasses(teacher.accountId)).map(async (teacherClass) => {
      const detail = await getTeacherById(teacherClass.id);
      if (!detail) return null;
      const token = await revealInviteToken(detail);
      return {
        id: detail.id,
        classLabel: detail.classLabel,
        joinUrl: `${origin}/join?t=${encodeURIComponent(token)}`,
        rootFolderUrl: `https://drive.google.com/drive/folders/${detail.rootFolderId}`,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${detail.spreadsheetId}/edit`,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      };
    }),
  );
  const visibleClasses = classes.filter((teacherClass): teacherClass is ClassInvite => Boolean(teacherClass));
  const activeClass = visibleClasses.find((teacherClass) => teacherClass.id === teacher.id);
  return {
    joinUrl: activeClass?.joinUrl || "",
    activeClassId: teacher.id,
    classLabel: teacher.classLabel,
    googleEmail: teacher.googleEmail,
    googleDisplayName: teacher.googleDisplayName,
    rootFolderUrl: `https://drive.google.com/drive/folders/${teacher.rootFolderId}`,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${teacher.spreadsheetId}/edit`,
    regionLabel: teacher.regionLabel,
    regionShortLabel: teacher.regionShortLabel,
    observationLat: teacher.observationLat,
    observationLon: teacher.observationLon,
    regionSettingsRequired: !teacher.regionSettingsCompletedAt,
    sessionDays: 60,
    classes: visibleClasses,
  };
}

export async function GET(request: Request) {
  try {
    const teacher = await requireTeacher(request);
    return json(await responseFor(request, teacher));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const teacher = await requireTeacher(request);
    const payload = (await request.json().catch(() => ({}))) as { classId?: unknown };
    let target = teacher;
    if (typeof payload.classId === "string") {
      const classTeacher = await getTeacherById(payload.classId);
      if (!classTeacher || classTeacher.accountId !== teacher.accountId) {
        throw new HttpError(404, "같은 Google 계정의 반을 찾지 못했습니다.");
      }
      target = classTeacher;
    }
    const token = randomToken(32);
    await rotateInviteToken(target.id, token, await sha256Hex(token));
    const updated = await getTeacherById(teacher.id);
    if (!updated) throw new HttpError(500, "수업 링크를 갱신하지 못했습니다.");
    return json(await responseFor(request, updated));
  } catch (error) {
    return errorResponse(error);
  }
}

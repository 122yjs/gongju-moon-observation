import { getTeacherSession } from "../../../../lib/auth";
import { randomToken, sha256Hex } from "../../../../lib/crypto";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import {
  getTeacherById,
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

function responseFor(request: Request, teacher: Awaited<ReturnType<typeof requireTeacher>>, token: string) {
  const origin = new URL(request.url).origin;
  return {
    joinUrl: `${origin}/join?t=${encodeURIComponent(token)}`,
    classLabel: teacher.classLabel,
    googleEmail: teacher.googleEmail,
    googleDisplayName: teacher.googleDisplayName,
    rootFolderUrl: `https://drive.google.com/drive/folders/${teacher.rootFolderId}`,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${teacher.spreadsheetId}/edit`,
    sessionDays: 60,
  };
}

export async function GET(request: Request) {
  try {
    const teacher = await requireTeacher(request);
    return json(responseFor(request, teacher, await revealInviteToken(teacher)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const teacher = await requireTeacher(request);
    const token = randomToken(32);
    await rotateInviteToken(teacher.id, token, await sha256Hex(token));
    const updated = await getTeacherById(teacher.id);
    if (!updated) throw new HttpError(500, "수업 링크를 갱신하지 못했습니다.");
    return json(responseFor(request, updated, token));
  } catch (error) {
    return errorResponse(error);
  }
}

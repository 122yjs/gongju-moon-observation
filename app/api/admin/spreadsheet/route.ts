import { getTeacherSession } from "../../../../lib/auth";
import {
  ensureTeacherSummarySheet,
  getTeacherAccessToken,
} from "../../../../lib/google-drive";
import { errorResponse, HttpError } from "../../../../lib/http";
import { getTeacherById } from "../../../../lib/tenant";

async function requireTeacher(request: Request) {
  const session = await getTeacherSession(request);
  if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
  const teacher = await getTeacherById(session.teacherId);
  if (!teacher) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
  return teacher;
}

export async function GET(request: Request) {
  try {
    const teacher = await requireTeacher(request);
    const classId = new URL(request.url).searchParams.get("classId");
    let target = teacher;
    if (classId && classId !== teacher.id) {
      const selected = await getTeacherById(classId);
      if (!selected || selected.accountId !== teacher.accountId) {
        throw new HttpError(404, "같은 Google 계정의 반을 찾지 못했습니다.");
      }
      target = selected;
    }

    const accessToken = await getTeacherAccessToken(teacher);
    const summarySheetId = await ensureTeacherSummarySheet(accessToken, target);
    const previewUrl = new URL(
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(target.spreadsheetId)}/preview`,
    );
    previewUrl.searchParams.set("gid", String(summarySheetId));
    return Response.redirect(previewUrl, 302);
  } catch (error) {
    return errorResponse(error);
  }
}

import { getTeacherSession } from "../../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import { getTeacherById, updateClassLabel } from "../../../../lib/tenant";

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
    return json({
      classLabel: teacher.classLabel,
      googleDisplayName: teacher.googleDisplayName,
      googleEmail: teacher.googleEmail,
      rootFolderUrl: `https://drive.google.com/drive/folders/${teacher.rootFolderId}`,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${teacher.spreadsheetId}/edit`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const teacher = await requireTeacher(request);
    const payload = (await request.json()) as { classLabel?: unknown };
    if (typeof payload.classLabel !== "string") throw new HttpError(400, "학급명을 입력해 주세요.");
    return json({ ok: true, classLabel: await updateClassLabel(teacher.id, payload.classLabel) });
  } catch (error) {
    return errorResponse(error);
  }
}

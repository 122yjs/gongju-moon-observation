import { getTeacherSession } from "../../../../lib/auth";
import { errorResponse, HttpError, json } from "../../../../lib/http";
import { searchKoreanRegions } from "../../../../lib/region-geocode";
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
    await requireTeacher(request);
    const query = new URL(request.url).searchParams.get("q") || "";
    const normalized = query.normalize("NFC").trim();
    if (Array.from(normalized).length < 2) {
      throw new HttpError(400, "지역명은 2자 이상 입력해 주세요.");
    }
    return json({ items: searchKoreanRegions(normalized) });
  } catch (error) {
    return errorResponse(error);
  }
}

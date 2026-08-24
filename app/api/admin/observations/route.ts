import { getTeacherSession } from "../../../../lib/auth";
import { getTeacherAccessToken, listObservationRows } from "../../../../lib/google-drive";
import { errorResponse, HttpError, json } from "../../../../lib/http";
import { decodeCursor, encodeCursor } from "../../../../lib/observations";
import { getTeacherById, seedImageTickets } from "../../../../lib/tenant";

export async function GET(request: Request) {
  try {
    const session = await getTeacherSession(request);
    if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
    const teacher = await getTeacherById(session.teacherId);
    if (!teacher) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
    const url = new URL(request.url);
    const cursorValue = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorValue);
    if (cursorValue && !cursor) throw new HttpError(400, "이어보기 정보가 올바르지 않습니다.");
    const accessToken = await getTeacherAccessToken(teacher);
    const page = await listObservationRows(accessToken, teacher, {
      limit: 30,
      cursor,
      includeHidden: true,
    });
    await seedImageTickets(
      teacher.id,
      page.items.map((item) => ({
        observationId: item.id,
        fileId: item.imageFileId,
        imageType: item.imageType,
        status: item.status,
      })),
    );
    return json({
      items: page.items.map((item) => ({
        id: item.id,
        studentNumber: item.studentNumber,
        studentName: item.studentName,
        observedAt: item.observedAt,
        memo: item.memo,
        imageBytes: item.imageBytes,
        status: item.status,
        createdAt: item.createdAt,
        imageUrl: `/api/images/${item.id}`,
        driveUrl: item.imageWebViewUrl,
      })),
      total: page.total,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor
        ? encodeCursor(page.nextCursor.createdAt, page.nextCursor.id)
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

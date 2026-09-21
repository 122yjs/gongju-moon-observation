import { getTeacherSession } from "../../../../lib/auth";
import {
  ensureTeacherSummarySheet,
  getTeacherAccessToken,
  listObservationRows,
  observationVersion,
  SHEET_SCHEMA_VERSION,
} from "../../../../lib/google-drive";
import { getHeartStates, getHeartViewer } from "../../../../lib/hearts";
import { errorResponse, HttpError, json } from "../../../../lib/http";
import { decodeCursor, encodeCursor } from "../../../../lib/observations";
import { getTeacherById, seedImageTickets } from "../../../../lib/tenant";

export async function GET(request: Request) {
  try {
    const session = await getTeacherSession(request);
    if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
    let teacher = await getTeacherById(session.teacherId);
    if (!teacher) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
    const url = new URL(request.url);
    const cursorValue = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorValue);
    if (cursorValue && !cursor) throw new HttpError(400, "이어보기 정보가 올바르지 않습니다.");
    const accessToken = await getTeacherAccessToken(teacher);
    if (teacher.sheetSchemaVersion < SHEET_SCHEMA_VERSION || !Number.isInteger(teacher.summarySheetId)) {
      await ensureTeacherSummarySheet(accessToken, teacher);
      const refreshed = await getTeacherById(teacher.id);
      if (!refreshed) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
      teacher = refreshed;
    }
    const page = await listObservationRows(accessToken, teacher, {
      limit: 30,
      cursor,
      includeHidden: true,
    });

    const viewer = await getHeartViewer(request, teacher.id);
    const hearts = await getHeartStates(
      teacher.id,
      page.items.map((item) => item.id),
      viewer.voterKey,
    );
    await seedImageTickets(
      teacher.id,
      page.items.map((item) => ({
        observationId: item.id,
        fileId: item.imageFileId,
        imageType: item.imageType,
        status: item.status,
      })),
    ).catch(() => {
      console.warn("교사 갤러리 미리보기 임시정보를 저장하지 못했습니다. 시트 기록으로 사진을 조회합니다.");
    });
    const items = await Promise.all(page.items.map(async (item) => ({
        id: item.id,
        version: await observationVersion(item),
        updatedAt: item.updatedAt,
        studentNumber: item.studentNumber,
        studentName: item.studentName,
        observedAt: item.observedAt,
        originalObservedAt: item.originalObservedAt || item.observedAt,
        photoCapturedAt: item.photoCapturedAt || null,
        correctedObservedAt: item.correctedObservedAt || null,
        correctedAt: item.correctedAt || null,
        memo: item.memo,
        imageBytes: item.imageBytes,
        status: item.status,
        createdAt: item.createdAt,
        imageUrl: `/api/images/${item.id}`,
        driveUrl: item.imageWebViewUrl,
        teacherFeedback: item.teacherFeedback,
        heartCount: hearts[item.id]?.heartCount ?? 0,
        hearted: hearts[item.id]?.hearted ?? false,
      })));
    return json({
      items,
      total: page.total,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor
        ? encodeCursor(page.nextCursor.createdAt, page.nextCursor.id)
        : null,
    }, viewer.cookie ? { headers: { "Set-Cookie": viewer.cookie } } : undefined);
  } catch (error) {
    return errorResponse(error);
  }
}

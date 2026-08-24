import { getAdminSession } from "../../../../lib/auth";
import { errorResponse, HttpError, json } from "../../../../lib/http";
import { decodeCursor, encodeCursor } from "../../../../lib/observations";
import { getClassId, getEnv } from "../../../../lib/runtime";

interface AdminObservationRow {
  id: string;
  student_number: number;
  student_name: string;
  observed_at: string;
  memo: string;
  image_bytes: number;
  status: string;
  created_at: string;
}

export async function GET(request: Request) {
  try {
    if (!(await getAdminSession(request))) throw new HttpError(401, "교사 로그인이 필요합니다.");
    const runtime = getEnv();
    const classId = getClassId(runtime);
    const url = new URL(request.url);
    const cursorValue = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorValue);
    if (cursorValue && !cursor) throw new HttpError(400, "이어보기 정보가 올바르지 않습니다.");
    const limit = 30;

    const statement = cursor
      ? runtime.DB.prepare(
          `SELECT id, student_number, student_name, observed_at, memo, image_bytes, status, created_at
             FROM observations
            WHERE class_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
            ORDER BY created_at DESC, id DESC LIMIT ?`,
        ).bind(classId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
      : runtime.DB.prepare(
          `SELECT id, student_number, student_name, observed_at, memo, image_bytes, status, created_at
             FROM observations
            WHERE class_id = ?
            ORDER BY created_at DESC, id DESC LIMIT ?`,
        ).bind(classId, limit + 1);

    const result = await statement.all<AdminObservationRow>();
    const rows = result.results || [];
    const hasMore = rows.length > limit;
    const visibleRows = rows.slice(0, limit);
    const last = visibleRows.at(-1);
    return json({
      items: visibleRows.map((row) => ({
        id: row.id,
        studentNumber: row.student_number,
        studentName: row.student_name,
        observedAt: row.observed_at,
        memo: row.memo,
        imageBytes: row.image_bytes,
        status: row.status,
        createdAt: row.created_at,
        imageUrl: `/api/images/${row.id}`,
      })),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

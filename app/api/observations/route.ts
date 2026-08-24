import { getAdminSession, getStudentSession } from "../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../lib/http";
import {
  decodeCursor,
  detectImageType,
  encodeCursor,
  maskStudentName,
  stripImageMetadata,
  validateObservationForm,
} from "../../../lib/observations";
import { getClassId, getEnv } from "../../../lib/runtime";

interface ObservationRow {
  id: string;
  student_number: number;
  student_name: string;
  observed_at: string;
  memo: string;
  created_at: string;
}

export async function GET(request: Request) {
  try {
    const viewer = (await getAdminSession(request)) || (await getStudentSession(request));
    if (!viewer) throw new HttpError(401, "수업 참여 링크로 입장한 뒤 이용해 주세요.");

    const runtime = getEnv();
    const classId = getClassId(runtime);
    const url = new URL(request.url);
    const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit")) || 12));
    const cursorValue = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorValue);
    if (cursorValue && !cursor) throw new HttpError(400, "갤러리 이어보기 정보가 올바르지 않습니다.");

    const statement = cursor
      ? runtime.DB.prepare(
          `SELECT id, student_number, student_name, observed_at, memo, created_at
             FROM observations
            WHERE class_id = ? AND status = 'visible'
              AND (created_at < ? OR (created_at = ? AND id < ?))
            ORDER BY created_at DESC, id DESC
            LIMIT ?`,
        ).bind(classId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
      : runtime.DB.prepare(
          `SELECT id, student_number, student_name, observed_at, memo, created_at
             FROM observations
            WHERE class_id = ? AND status = 'visible'
            ORDER BY created_at DESC, id DESC
            LIMIT ?`,
        ).bind(classId, limit + 1);

    const [page, totalRow] = await Promise.all([
      statement.all<ObservationRow>(),
      runtime.DB.prepare(
        "SELECT COUNT(*) AS total FROM observations WHERE class_id = ? AND status = 'visible'",
      )
        .bind(classId)
        .first<{ total: number }>(),
    ]);
    const rows = page.results || [];
    const hasMore = rows.length > limit;
    const visibleRows = rows.slice(0, limit);
    const last = visibleRows.at(-1);

    return json({
      items: visibleRows.map((row) => ({
        id: row.id,
        studentNumber: row.student_number,
        displayName: maskStudentName(row.student_name),
        observedAt: row.observed_at,
        memo: row.memo,
        imageUrl: `/api/images/${row.id}`,
      })),
      total: Number(totalRow?.total || 0),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let storedImageKey: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await getStudentSession(request);
    if (!session) throw new HttpError(401, "수업 참여 링크로 입장한 뒤 제출해 주세요.");

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 4 * 1024 * 1024) throw new HttpError(413, "제출 사진의 용량이 너무 큽니다.");

    const runtime = getEnv();
    const classId = getClassId(runtime);
    const input = validateObservationForm(await request.formData());

    const existing = await runtime.DB.prepare(
      "SELECT id, session_id FROM observations WHERE request_id = ? LIMIT 1",
    )
      .bind(input.requestId)
      .first<{ id: string; session_id: string }>();
    if (existing) {
      if (existing.session_id !== session.sid) throw new HttpError(409, "이미 처리된 제출 요청입니다.");
      return json({ ok: true, id: existing.id, message: "이미 제출된 사진입니다." });
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [deviceCount, classCount] = await Promise.all([
      runtime.DB.prepare(
        "SELECT COUNT(*) AS count FROM observations WHERE session_id = ? AND created_at >= ?",
      )
        .bind(session.sid, tenMinutesAgo)
        .first<{ count: number }>(),
      runtime.DB.prepare(
        "SELECT COUNT(*) AS count FROM observations WHERE class_id = ? AND created_at >= ?",
      )
        .bind(classId, oneHourAgo)
        .first<{ count: number }>(),
    ]);
    if (Number(deviceCount?.count || 0) >= 3) {
      throw new HttpError(429, "10분 동안 제출할 수 있는 횟수를 넘었습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (Number(classCount?.count || 0) >= 100) {
      throw new HttpError(429, "현재 제출이 많습니다. 잠시 후 다시 시도해 주세요.");
    }

    const uploadedBytes = new Uint8Array(await input.photo.arrayBuffer());
    const image = detectImageType(uploadedBytes);
    const bytes = stripImageMetadata(uploadedBytes, image.contentType);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    storedImageKey = `classes/${classId}/observations/${id}.${image.extension}`;

    await runtime.BUCKET.put(storedImageKey, bytes, {
      httpMetadata: { contentType: image.contentType },
      customMetadata: { observationId: id },
    });

    try {
      await runtime.DB.prepare(
        `INSERT INTO observations
          (id, request_id, class_id, session_id, student_number, student_name,
           observed_at, memo, image_key, image_type, image_bytes, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?)`,
      )
        .bind(
          id,
          input.requestId,
          classId,
          session.sid,
          input.studentNumber,
          input.studentName,
          input.observedAt,
          input.memo,
          storedImageKey,
          image.contentType,
          bytes.byteLength,
          createdAt,
        )
        .run();
    } catch (error) {
      await runtime.BUCKET.delete(storedImageKey);
      storedImageKey = null;
      throw error;
    }

    return json(
      { ok: true, id, message: "달 관찰 사진을 제출했습니다." },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

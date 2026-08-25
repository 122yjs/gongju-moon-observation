import { getStudentSession, getTeacherSession } from "../../../lib/auth";
import {
  appendObservationRow,
  deleteDriveFile,
  getTeacherAccessToken,
  listObservationRows,
  uploadObservationPhoto,
} from "../../../lib/google-drive";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../lib/http";
import {
  decodeCursor,
  detectImageType,
  encodeCursor,
  maskStudentName,
  stripImageMetadata,
  validateObservationForm,
} from "../../../lib/observations";
import {
  completeSubmission,
  enforceSubmissionRateLimit,
  getTeacherById,
  releaseSubmission,
  reserveSubmission,
  seedImageTickets,
} from "../../../lib/tenant";

export async function GET(request: Request) {
  try {
    const teacherSession = await getTeacherSession(request);
    const studentSession = teacherSession ? null : await getStudentSession(request);
    const teacherId = teacherSession?.teacherId || studentSession?.teacherId;
    if (!teacherId) throw new HttpError(401, "수업 참여 링크로 입장한 뒤 이용해 주세요.");
    const teacher = await getTeacherById(teacherId);
    if (!teacher) throw new HttpError(401, "수업 연결이 만료되었습니다.");

    const url = new URL(request.url);
    const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit")) || 12));
    const cursorValue = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorValue);
    if (cursorValue && !cursor) throw new HttpError(400, "갤러리 이어보기 정보가 올바르지 않습니다.");

    const accessToken = await getTeacherAccessToken(teacher);
    const page = await listObservationRows(accessToken, teacher, {
      limit,
      cursor,
      includeHidden: false,
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
        displayName: maskStudentName(item.studentName),
        observedAt: item.observedAt,
        memo: item.memo,
        imageUrl: `/api/images/${item.id}`,
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

export async function POST(request: Request) {
  let uploadedFileId: string | null = null;
  let requestId: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await getStudentSession(request);
    if (!session?.teacherId) {
      throw new HttpError(401, "수업 참여 링크로 입장한 뒤 제출해 주세요.");
    }
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 8 * 1024 * 1024) {
      throw new HttpError(413, "제출 사진의 용량이 너무 큽니다.");
    }
    const teacher = await getTeacherById(session.teacherId);
    if (!teacher) throw new HttpError(401, "수업 연결이 만료되었습니다.");

    const input = validateObservationForm(await request.formData());
    requestId = input.requestId;
    const receipt = await reserveSubmission(input.requestId, teacher.id);
    if (!receipt.newlyReserved) {
      if (receipt.status === "completed" && receipt.observationId) {
        return json({ ok: true, id: receipt.observationId, message: "이미 제출된 사진입니다." });
      }
      throw new HttpError(409, "같은 사진을 처리하고 있습니다. 잠시 후 다시 확인해 주세요.");
    }

    try {
      await enforceSubmissionRateLimit(teacher.id, session.sid);
    } catch (error) {
      await releaseSubmission(input.requestId);
      throw error;
    }

    const uploadedBytes = new Uint8Array(await input.photo.arrayBuffer());
    const image = detectImageType(uploadedBytes);
    const bytes = stripImageMetadata(uploadedBytes, image.contentType);
    const observationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const accessToken = await getTeacherAccessToken(teacher);
    const uploaded = await uploadObservationPhoto(accessToken, teacher, {
      bytes,
      contentType: image.contentType,
      extension: image.extension,
      studentNumber: input.studentNumber,
      studentName: input.studentName,
      observedAt: input.observedAt,
    });
    uploadedFileId = uploaded.id;

    try {
      await appendObservationRow(accessToken, teacher, {
        id: observationId,
        requestId: input.requestId,
        classLabel: teacher.classLabel,
        studentNumber: input.studentNumber,
        studentName: input.studentName,
        observedAt: input.observedAt,
        memo: input.memo,
        imageFileId: uploaded.id,
        imageType: image.contentType,
        imageBytes: bytes.byteLength,
        status: "visible",
        createdAt,
        imageWebViewUrl: uploaded.webViewLink,
      });
    } catch (error) {
      await deleteDriveFile(accessToken, uploaded.id).catch(() => undefined);
      uploadedFileId = null;
      throw error;
    }

    await completeSubmission(input.requestId, observationId).catch((error) => {
      console.warn("제출 완료 영수증을 갱신하지 못했습니다.", error);
    });
    await seedImageTickets(teacher.id, [
      {
        observationId,
        fileId: uploaded.id,
        imageType: image.contentType,
        status: "visible",
      },
    ]);
    return json(
      { ok: true, id: observationId, message: "교사 Google Drive에 달 관찰 사진을 제출했습니다." },
      { status: 201 },
    );
  } catch (error) {
    if (requestId && !uploadedFileId) await releaseSubmission(requestId).catch(() => undefined);
    return errorResponse(error);
  }
}

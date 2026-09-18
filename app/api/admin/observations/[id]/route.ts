import { getTeacherSession } from "../../../../../lib/auth";
import {
  deleteObservation,
  findObservationRow,
  getTeacherAccessToken,
  updateObservationFeedback,
  updateObservationObservedAt,
  updateObservationStatus,
} from "../../../../../lib/google-drive";
import { deleteObservationHearts } from "../../../../../lib/hearts";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../../lib/http";
import {
  deleteImageTicket,
  getTeacherById,
  seedImageTickets,
} from "../../../../../lib/tenant";

const MAX_FEEDBACK_LENGTH = 500;

function normalizeTeacherFeedback(value: string) {
  const normalized = value
    .replace(/\r\n|[\r\u000b\u000c\u0085\u2028\u2029]/g, "\n")
    .normalize("NFC")
    .trim();
  if (/\p{Cc}/u.test(normalized.replace(/[\n\t]/g, ""))) {
    throw new HttpError(400, "피드백에 사용할 수 없는 문자가 있습니다.");
  }
  if (Array.from(normalized).length > MAX_FEEDBACK_LENGTH) {
    throw new HttpError(400, "피드백은 500자까지 입력할 수 있습니다.");
  }
  return normalized;
}

async function contextFor(request: Request, id: string) {
  const session = await getTeacherSession(request);
  if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");
  const teacher = await getTeacherById(session.teacherId);
  if (!teacher) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
  const accessToken = await getTeacherAccessToken(teacher);
  const observation = await findObservationRow(accessToken, teacher, id);
  return { teacher, accessToken, observation };
}

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await routeContext.params;
    const payload = (await request.json()) as {
      status?: unknown;
      observedAt?: unknown;
      reason?: unknown;
      teacherFeedback?: unknown;
    };
    const { teacher, accessToken, observation } = await contextFor(request, id);
    if (!observation) throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");

    if (payload.status === "visible" || payload.status === "hidden") {
      await updateObservationStatus(accessToken, teacher, observation, payload.status);
      await seedImageTickets(teacher.id, [
        {
          observationId: observation.id,
          fileId: observation.imageFileId,
          imageType: observation.imageType,
          status: payload.status,
        },
      ]);
      return json({ ok: true, status: payload.status });
    }

    if (typeof payload.observedAt === "string") {
      const observedAt = payload.observedAt.trim();
      const reason = typeof payload.reason === "string" ? payload.reason.normalize("NFC").trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(observedAt)) {
        throw new HttpError(400, "정정할 관찰 시각을 확인해 주세요.");
      }
      const parsed = new Date(`${observedAt}:00+09:00`);
      if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, "정정할 관찰 시각을 확인해 주세요.");
      const normalized = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(parsed).replace(" ", "T");
      if (normalized !== observedAt) throw new HttpError(400, "존재하지 않는 날짜나 시각입니다.");
      if (reason.length < 2 || Array.from(reason).length > 120 || /\p{Cc}/u.test(reason)) {
        throw new HttpError(400, "정정 사유를 2~120자로 입력해 주세요.");
      }
      const updated = await updateObservationObservedAt(accessToken, teacher, observation, observedAt, reason);
      return json({
        ok: true,
        observedAt: updated.observedAt,
        originalObservedAt: observation.originalObservedAt || observation.observedAt,
        correctedAt: updated.correctedAt,
      });
    }

    if (payload.teacherFeedback !== undefined) {
      if (typeof payload.teacherFeedback !== "string") {
        throw new HttpError(400, "피드백 값을 확인해 주세요.");
      }
      const teacherFeedback = normalizeTeacherFeedback(payload.teacherFeedback);
      await updateObservationFeedback(accessToken, teacher, observation, teacherFeedback);
      return json({ ok: true, teacherFeedback });
    }

    throw new HttpError(400, "수정할 값을 확인해 주세요.");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await routeContext.params;
    const { teacher, accessToken, observation } = await contextFor(request, id);
    if (observation) {
      await deleteObservation(accessToken, teacher, observation);
    }
    // 시트 기록이 이미 지워진 재시도에서도 같은 반 범위의 남은 D1 데이터를 정리합니다.
    await Promise.all([
      deleteImageTicket(id, teacher.id),
      deleteObservationHearts(teacher.id, id),
    ]);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

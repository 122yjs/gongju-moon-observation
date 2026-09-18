import { getStudentSession, getTeacherSession } from "../../../../../lib/auth";
import { findObservationRow, getTeacherAccessToken } from "../../../../../lib/google-drive";
import { deleteObservationHearts, getHeartViewer, setHeart } from "../../../../../lib/hearts";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../../lib/http";
import { getTeacherById } from "../../../../../lib/tenant";

const OBSERVATION_ID_PATTERN = /^[0-9a-f-]{36}$/i;

function readHearted(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "좋아요 값을 확인해 주세요.");
  }
  const keys = Object.keys(payload);
  const hearted = (payload as { hearted?: unknown }).hearted;
  if (keys.length !== 1 || keys[0] !== "hearted" || typeof hearted !== "boolean") {
    throw new HttpError(400, "좋아요 값을 확인해 주세요.");
  }
  return hearted;
}

export async function PUT(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await routeContext.params;
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new HttpError(400, "좋아요 값을 확인해 주세요.");
    }
    const hearted = readHearted(payload);

    const teacherSession = await getTeacherSession(request);
    const session = teacherSession || (await getStudentSession(request));
    if (!session?.teacherId) throw new HttpError(401, "수업 참여 링크로 입장한 뒤 이용해 주세요.");
    if (!OBSERVATION_ID_PATTERN.test(id)) throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");

    const teacher = await getTeacherById(session.teacherId);
    if (!teacher) throw new HttpError(401, "수업 연결이 만료되었습니다.");
    const accessToken = await getTeacherAccessToken(teacher);
    const observation = await findObservationRow(accessToken, teacher, id);
    if (!observation) throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");
    if (!teacherSession && observation.status !== "visible") {
      throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");
    }

    // 쿠키가 없으면 새 식별자를 만들지 않습니다. 목록 조회가 먼저 쿠키를 발급합니다.
    const viewer = await getHeartViewer(request, teacher.id, { requireExisting: true });
    const state = await setHeart(teacher.id, observation.id, viewer.voterKey, hearted);

    // 삭제와 겹치거나 재확인이 실패해도 이 요청이 새로 넣은 하트만 되돌립니다.
    const confirmed = await findObservationRow(accessToken, teacher, id).catch(async (error: unknown) => {
      if (state.inserted) await setHeart(teacher.id, observation.id, viewer.voterKey, false);
      throw error;
    });
    if (!confirmed) {
      await deleteObservationHearts(teacher.id, observation.id);
      throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");
    }
    if (!teacherSession && confirmed.status !== "visible") {
      // 숨겨진 기록이라도 이미 있던 하트는 유지하고, 이 요청이 새로 넣은 경우만 되돌립니다.
      if (state.inserted) await setHeart(teacher.id, observation.id, viewer.voterKey, false);
      throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");
    }

    return json({ ok: true, heartCount: state.heartCount, hearted: state.hearted });
  } catch (error) {
    return errorResponse(error);
  }
}

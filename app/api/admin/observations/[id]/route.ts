import { getTeacherSession } from "../../../../../lib/auth";
import {
  deleteObservation,
  findObservationRow,
  getTeacherAccessToken,
  updateObservationStatus,
} from "../../../../../lib/google-drive";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../../lib/http";
import {
  deleteImageTicket,
  getTeacherById,
  seedImageTickets,
} from "../../../../../lib/tenant";

async function contextFor(request: Request, id: string) {
  const session = await getTeacherSession(request);
  if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");
  const teacher = await getTeacherById(session.teacherId);
  if (!teacher) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
  const accessToken = await getTeacherAccessToken(teacher);
  const observation = await findObservationRow(accessToken, teacher, id);
  if (!observation) throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");
  return { teacher, accessToken, observation };
}

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await routeContext.params;
    const payload = (await request.json()) as { status?: unknown };
    if (payload.status !== "visible" && payload.status !== "hidden") {
      throw new HttpError(400, "공개 상태 값이 올바르지 않습니다.");
    }
    const { teacher, accessToken, observation } = await contextFor(request, id);
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
    await deleteObservation(accessToken, teacher, observation);
    await deleteImageTicket(observation.id, teacher.id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

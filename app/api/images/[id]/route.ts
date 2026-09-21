import { getStudentSession, getTeacherSession } from "../../../../lib/auth";
import {
  downloadObservationImage,
  findObservationRow,
  getTeacherAccessToken,
} from "../../../../lib/google-drive";
import { errorResponse, HttpError } from "../../../../lib/http";
import {
  getImageTicket,
  getTeacherById,
  seedImageTickets,
} from "../../../../lib/tenant";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const teacherSession = await getTeacherSession(request);
    const studentSession = teacherSession ? null : await getStudentSession(request);
    const teacherId = teacherSession?.teacherId || studentSession?.teacherId;
    if (!teacherId) throw new HttpError(401, "수업 참여가 필요합니다.");
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "사진을 찾을 수 없습니다.");
    const teacher = await getTeacherById(teacherId);
    if (!teacher) throw new HttpError(401, "수업 연결이 만료되었습니다.");
    const accessToken = await getTeacherAccessToken(teacher);

    // A cache miss/error must still pass the same class-scoped Sheet and Drive checks.
    let ticket = await getImageTicket(id, teacher.id).catch(() => null);
    if (!ticket) {
      const observation = await findObservationRow(accessToken, teacher, id);
      if (!observation) throw new HttpError(404, "사진을 찾을 수 없습니다.");
      ticket = {
        fileId: observation.imageFileId,
        imageType: observation.imageType,
        status: observation.status,
      };
      await seedImageTickets(teacher.id, [
        {
          observationId: observation.id,
          fileId: observation.imageFileId,
          imageType: observation.imageType,
          status: observation.status,
        },
      ]).catch(() => {
        console.warn("사진 미리보기 임시정보를 갱신하지 못했습니다. 확인된 원본 사진을 표시합니다.");
      });
    }
    if (!teacherSession && ticket.status !== "visible") {
      throw new HttpError(404, "사진을 찾을 수 없습니다.");
    }

    const googleResponse = await downloadObservationImage(accessToken, teacher, ticket.fileId);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Type": ticket.imageType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    const length = googleResponse.headers.get("Content-Length");
    if (length) headers.set("Content-Length", length);
    return new Response(googleResponse.body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

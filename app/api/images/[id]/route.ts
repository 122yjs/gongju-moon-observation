import { getAdminSession, getStudentSession } from "../../../../lib/auth";
import { errorResponse, HttpError } from "../../../../lib/http";
import { getClassId, getEnv } from "../../../../lib/runtime";

interface ImageRow {
  image_key: string;
  image_type: string;
  status: string;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getAdminSession(request);
    const student = admin ? null : await getStudentSession(request);
    if (!admin && !student) throw new HttpError(401, "수업 참여가 필요합니다.");

    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "사진을 찾을 수 없습니다.");
    const runtime = getEnv();
    const row = await runtime.DB.prepare(
      "SELECT image_key, image_type, status FROM observations WHERE id = ? AND class_id = ? LIMIT 1",
    )
      .bind(id, getClassId(runtime))
      .first<ImageRow>();
    if (!row || (!admin && row.status !== "visible")) {
      throw new HttpError(404, "사진을 찾을 수 없습니다.");
    }

    const object = await runtime.BUCKET.get(row.image_key);
    if (!object) throw new HttpError(404, "사진 파일을 찾을 수 없습니다.");
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Type": row.image_type,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

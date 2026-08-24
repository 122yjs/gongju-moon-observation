import { getAdminSession } from "../../../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../../lib/http";
import { getClassId, getEnv } from "../../../../../lib/runtime";

interface ManagedRow {
  image_key: string;
  status: string;
}

async function getManagedObservation(id: string) {
  const runtime = getEnv();
  const row = await runtime.DB.prepare(
    "SELECT image_key, status FROM observations WHERE id = ? AND class_id = ? LIMIT 1",
  )
    .bind(id, getClassId(runtime))
    .first<ManagedRow>();
  if (!row) throw new HttpError(404, "관찰 기록을 찾을 수 없습니다.");
  return { runtime, row };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    if (!(await getAdminSession(request))) throw new HttpError(401, "교사 로그인이 필요합니다.");
    const { id } = await context.params;
    const payload = (await request.json()) as { status?: unknown };
    if (payload.status !== "visible" && payload.status !== "hidden") {
      throw new HttpError(400, "공개 상태 값이 올바르지 않습니다.");
    }
    const { runtime } = await getManagedObservation(id);
    await runtime.DB.prepare(
      "UPDATE observations SET status = ? WHERE id = ? AND class_id = ?",
    )
      .bind(payload.status, id, getClassId(runtime))
      .run();
    return json({ ok: true, status: payload.status });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    if (!(await getAdminSession(request))) throw new HttpError(401, "교사 로그인이 필요합니다.");
    const { id } = await context.params;
    const { runtime, row } = await getManagedObservation(id);

    await runtime.DB.prepare(
      "UPDATE observations SET status = 'hidden' WHERE id = ? AND class_id = ?",
    )
      .bind(id, getClassId(runtime))
      .run();
    await runtime.BUCKET.delete(row.image_key);
    await runtime.DB.prepare("DELETE FROM observations WHERE id = ? AND class_id = ?")
      .bind(id, getClassId(runtime))
      .run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

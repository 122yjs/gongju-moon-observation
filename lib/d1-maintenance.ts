import type { AppEnv } from "./runtime";

// 학생 요청과 분리해 만료된 임시정보만 정리합니다.
// 한 번에 삭제하는 양을 제한해 오래 쌓인 자료가 있어도 한 쿼리가 길어지지 않게 합니다.
export async function cleanupExpiredTransientData(db: AppEnv["DB"], now = new Date()) {
  const cutoff = now.toISOString();
  await db.batch([
    db.prepare(`DELETE FROM submission_receipts WHERE request_id IN (
      SELECT request_id FROM submission_receipts WHERE expires_at < ? ORDER BY expires_at LIMIT 500
    )`).bind(cutoff),
    db.prepare(`DELETE FROM submission_events WHERE id IN (
      SELECT id FROM submission_events WHERE expires_at < ? ORDER BY expires_at LIMIT 500
    )`).bind(cutoff),
    db.prepare(`DELETE FROM image_tickets WHERE observation_id IN (
      SELECT observation_id FROM image_tickets WHERE expires_at < ? ORDER BY expires_at LIMIT 500
    )`).bind(cutoff),
  ]);
}

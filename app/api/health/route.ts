import { json } from "../../../lib/http";
import { getEnv } from "../../../lib/runtime";

export async function GET() {
  try {
    const runtime = getEnv();
    const tables = await runtime.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('oauth_config', 'teacher_accounts', 'teacher_connections', 'submission_receipts')`,
    ).all<{ name: string }>();
    const oauth = await runtime.DB.prepare(
      "SELECT client_id FROM oauth_config WHERE id = 'google' LIMIT 1",
    ).first<{ client_id: string }>();
    return json({
      ok: (tables.results || []).length === 4,
      mode: "teacher-drive-oauth",
      oauthConfigured: Boolean(oauth?.client_id),
    });
  } catch {
    return json({ ok: false, mode: "teacher-drive-oauth" }, { status: 503 });
  }
}

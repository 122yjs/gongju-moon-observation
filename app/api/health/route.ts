import { json } from "../../../lib/http";
import { getEnv } from "../../../lib/runtime";

export async function GET() {
  try {
    const runtime = getEnv();
    await runtime.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, { status: 503 });
  }
}

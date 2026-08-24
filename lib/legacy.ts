import { getEnv } from "./runtime";

interface LegacyRow {
  id: string;
  image_key: string;
}

async function legacyTableExists() {
  const row = await getEnv().DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'observations' LIMIT 1",
  ).first<{ name: string }>();
  return Boolean(row);
}

export async function getLegacyStudentDataSummary() {
  const runtime = getEnv();
  const tableExists = await legacyTableExists();
  const row = tableExists
    ? await runtime.DB.prepare("SELECT COUNT(*) AS count FROM observations").first<{ count: number }>()
    : null;
  const listed = runtime.BUCKET
    ? await runtime.BUCKET.list({ prefix: "classes/", limit: 1 })
    : { objects: [], truncated: false };
  return {
    databaseRows: Number(row?.count || 0),
    r2ObjectsPresent: listed.objects.length > 0 || Boolean(listed.truncated),
  };
}

export async function purgeLegacyStudentDataBatch() {
  const runtime = getEnv();
  const tableExists = await legacyTableExists();
  let deletedRows = 0;
  let deletedObjects = 0;

  if (tableExists) {
    const result = await runtime.DB.prepare(
      "SELECT id, image_key FROM observations ORDER BY created_at LIMIT 100",
    ).all<LegacyRow>();
    const rows = result.results || [];
    if (runtime.BUCKET && rows.length > 0) {
      const keys = rows.map((row) => row.image_key).filter(Boolean);
      if (keys.length > 0) {
        await runtime.BUCKET.delete(keys);
        deletedObjects += keys.length;
      }
    }
    if (rows.length > 0) {
      await runtime.DB.batch(
        rows.map((row) => runtime.DB.prepare("DELETE FROM observations WHERE id = ?").bind(row.id)),
      );
      deletedRows += rows.length;
    }
  }

  if (runtime.BUCKET) {
    const listed = await runtime.BUCKET.list({ prefix: "classes/", limit: 1000 });
    const orphanKeys = listed.objects.map((object) => object.key);
    if (orphanKeys.length > 0) {
      await runtime.BUCKET.delete(orphanKeys);
      deletedObjects += orphanKeys.length;
    }
  }

  const remaining = await getLegacyStudentDataSummary();
  return {
    deletedRows,
    deletedObjects,
    complete: remaining.databaseRows === 0 && !remaining.r2ObjectsPresent,
    remaining,
  };
}

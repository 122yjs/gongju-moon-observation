import { randomToken, sha256Hex } from "./crypto";
import { HttpError } from "./http";
import { getEnv } from "./runtime";

const COOKIE_PREFIX = "moon_heart_";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const VOTER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const CLASS_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const OBSERVATION_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const COUNT_BATCH_SIZE = 30;

export interface HeartState {
  heartCount: number;
  hearted: boolean;
}

export interface HeartViewer {
  voterKey: string;
  cookie: string | null;
}

interface HeartCountRow {
  observation_id?: string;
  heart_count: number;
  hearted: number | null;
}


function heartCookieName(classId: string) {
  if (!CLASS_ID_PATTERN.test(classId)) throw new HttpError(400, "수업 정보를 확인할 수 없습니다.");
  return `${COOKIE_PREFIX}${classId}`;
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

// 쿠키 값은 저장하지 않고 수업별 해시만 남깁니다. 학번·이름·세션 ID는 쓰지 않습니다.
function voterKeyFor(classId: string, token: string) {
  return sha256Hex(`${classId}\u0000${token}`);
}

export async function getHeartViewer(
  request: Request,
  classId: string,
  options: { requireExisting?: boolean } = {},
): Promise<HeartViewer> {
  const name = heartCookieName(classId);
  const token = readCookie(request, name);
  if (token && VOTER_TOKEN_PATTERN.test(token)) {
    return { voterKey: await voterKeyFor(classId, token), cookie: null };
  }
  // 저장 요청은 쿠키가 없을 때 새 식별자를 만들지 않습니다. 목록 조회가 먼저 쿠키를 발급합니다.
  if (options.requireExisting) {
    throw new HttpError(403, "좋아요 표시를 위해 목록을 새로 고친 뒤 다시 시도해 주세요.");
  }
  const issued = randomToken(32);
  return {
    voterKey: await voterKeyFor(classId, issued),
    cookie: `${name}=${encodeURIComponent(issued)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
  };
}

export async function getHeartStates(
  classId: string,
  observationIds: string[],
  voterKey: string,
): Promise<Record<string, HeartState>> {
  const ids = [...new Set(observationIds)].filter((id) => OBSERVATION_ID_PATTERN.test(id));
  const states: Record<string, HeartState> = {};
  for (const id of ids) states[id] = { heartCount: 0, hearted: false };
  if (ids.length === 0) return states;

  const db = getEnv().DB;
  for (let index = 0; index < ids.length; index += COUNT_BATCH_SIZE) {
    const batch = ids.slice(index, index + COUNT_BATCH_SIZE);
    const rows = await db
      .prepare(
        `SELECT observation_id, COUNT(*) AS heart_count,
                MAX(CASE WHEN voter_key = ? THEN 1 ELSE 0 END) AS hearted
           FROM observation_hearts
          WHERE class_id = ? AND observation_id IN (${batch.map(() => "?").join(", ")})
          GROUP BY observation_id`,
      )
      .bind(voterKey, classId, ...batch)
      .all<HeartCountRow>();
    for (const row of rows.results || []) {
      if (!row.observation_id) continue;
      states[row.observation_id] = {
        heartCount: Number(row.heart_count) || 0,
        hearted: Number(row.hearted) === 1,
      };
    }
  }
  return states;
}

export async function setHeart(
  classId: string,
  observationId: string,
  voterKey: string,
  hearted: boolean,
): Promise<HeartState & { inserted: boolean }> {
  const db = getEnv().DB;
  const statement = hearted
    ? // 수업이 삭제되는 중이면 하트를 남기지 않습니다(존재하는 수업만 저장).
      db
        .prepare(
          `INSERT OR IGNORE INTO observation_hearts (class_id, observation_id, voter_key, created_at)
           SELECT ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM teacher_connections WHERE id = ?)`,
        )
        .bind(classId, observationId, voterKey, new Date().toISOString(), classId)
    : db
        .prepare(
          "DELETE FROM observation_hearts WHERE class_id = ? AND observation_id = ? AND voter_key = ?",
        )
        .bind(classId, observationId, voterKey);
  const result = await statement.run();

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS heart_count, MAX(CASE WHEN voter_key = ? THEN 1 ELSE 0 END) AS hearted
         FROM observation_hearts
        WHERE class_id = ? AND observation_id = ?`,
    )
    .bind(voterKey, classId, observationId)
    .first<HeartCountRow>();
  return {
    heartCount: Number(row?.heart_count) || 0,
    hearted: Number(row?.hearted) === 1,
    // 같은 INSERT OR IGNORE 문이 실제로 행을 넣었을 때만 true입니다(삭제·중복 요청은 false).
    inserted: hearted && result.meta.changes > 0,
  };
}

export async function deleteObservationHearts(classId: string, observationId: string) {
  await getEnv().DB.prepare(
    "DELETE FROM observation_hearts WHERE class_id = ? AND observation_id = ?",
  )
    .bind(classId, observationId)
    .run();
}

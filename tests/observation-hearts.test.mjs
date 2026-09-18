import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// 좋아요는 실제 drizzle 마이그레이션 SQL과 실제 lib/hearts.ts·라우트 코드를
// 인메모리 SQLite 위에서 실행해 확인합니다. 실제 Drive·Sheets·D1은 쓰지 않습니다.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function transpile(relativePath) {
  return ts.transpileModule(readFileSync(join(root, relativePath), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

const MODULES = {
  crypto: transpile('lib/crypto.ts'),
  http: transpile('lib/http.ts'),
  hearts: transpile('lib/hearts.ts'),
  tenant: transpile('lib/tenant.ts'),
  route: transpile('app/api/observations/[id]/heart/route.ts'),
};
const MIGRATIONS = readdirSync(join(root, 'drizzle'))
  .filter((name) => name.endsWith('.sql'))
  .sort();

// vm 안에서 만들어진 객체는 프로토타입이 달라 깊은 비교가 실패하므로 값을 복사해 씁니다.
const plain = (value) => JSON.parse(JSON.stringify(value));

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of MIGRATIONS) {
    const script = readFileSync(join(root, 'drizzle', name), 'utf8');
    for (const statement of script.split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  return sqlite;
}

// D1Database가 쓰는 prepare().bind().first()/all()/run()/batch()만 흉내 냅니다.
function d1(sqlite) {
  const execute = (sql, params) => {
    if (/^\s*(select|with)\b/i.test(sql)) {
      return { results: sqlite.prepare(sql).all(...params), success: true, meta: {} };
    }
    const info = sqlite.prepare(sql).run(...params);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  };
  const statement = (sql, params) => ({
    bind: (...next) => statement(sql, next),
    first: async () => execute(sql, params).results[0] ?? null,
    all: async () => execute(sql, params),
    run: async () => execute(sql, params),
  });
  return {
    prepare: (sql) => statement(sql, []),
    // 실제 D1처럼 문장을 순서대로 실행합니다(동기 실행이라 끼어들지 않습니다).
    batch: async (statements) => Promise.all(statements.map((item) => item.run())),
  };
}

function loadModule(code, requires) {
  const exports = {};
  runInNewContext(code, {
    exports,
    require: (id) => {
      if (!(id in requires)) throw new Error(`unexpected require: ${id}`);
      return requires[id];
    },
    crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, URL, Request, Response, Headers,
    console: { warn() {}, error() {}, log() {} },
  });
  return exports;
}

function heartsEnv(sqlite = database()) {
  const runtime = { SESSION_SECRET: 'test-secret', DB: d1(sqlite) };
  const runtimeModule = { getEnv: () => runtime };
  const cryptoModule = loadModule(MODULES.crypto, { './runtime': runtimeModule });
  const httpModule = loadModule(MODULES.http, {});
  const hearts = loadModule(MODULES.hearts, {
    './crypto': cryptoModule,
    './runtime': runtimeModule,
    './http': httpModule,
  });
  return { sqlite, runtime, http: httpModule, hearts };
}

const COLUMNS = [
  'id', 'google_permission_id', 'google_email', 'google_display_name', 'refresh_token_ciphertext',
  'root_folder_id', 'photos_folder_id', 'spreadsheet_id', 'sheet_id', 'sheet_title',
  'invite_token_hash', 'invite_token_ciphertext', 'class_label', 'created_at', 'updated_at',
];

function addClass(sqlite, id, accountId = 'account-1') {
  const values = [id, `perm-${id}`, `${id}@example.invalid`, id, 'cipher', 'root', 'photos', 'sheet', 1, '기록', `hash-${id}`, 'cipher', '시험 반', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'];
  sqlite.prepare(`INSERT INTO teacher_connections (${COLUMNS.join(', ')}, account_id) VALUES (${COLUMNS.map(() => '?').join(', ')}, ?)`).run(...values, accountId);
}

function addAccount(sqlite, id) {
  sqlite.prepare(
    'INSERT INTO teacher_accounts (id, google_permission_id, google_email, google_display_name, refresh_token_ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, `perm-${id}`, `${id}@example.invalid`, id, 'cipher', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
}

const CLASS_A = 'class-a';
const CLASS_B = 'class-b';
const OBSERVATION_1 = '11111111-1111-4111-8111-111111111111';
const OBSERVATION_2 = '22222222-2222-4222-8222-222222222222';
const VOTER_A = 'voter-token-aaaaaaaaaaaaaaaaaaaa';
const VOTER_B = 'voter-token-bbbbbbbbbbbbbbbbbbbb';

function heartRequest(cookie) {
  return new Request('https://app.invalid/api/observations', cookie ? { headers: { cookie } } : {});
}

function heartCookie(classId, token) {
  return `moon_heart_${classId}=${token}`;
}

function cookieToken(setCookie) {
  return decodeURIComponent(setCookie.split(';')[0].split('=')[1]);
}

function countHearts(sqlite, classId, observationId) {
  return sqlite.prepare(
    'SELECT COUNT(*) AS count FROM observation_hearts WHERE class_id = ? AND observation_id = ?',
  ).get(classId, observationId).count;
}

function totalHearts(sqlite) {
  return sqlite.prepare('SELECT COUNT(*) AS count FROM observation_hearts').get().count;
}

test('목록 조회가 수업별 쿠키를 만들고 저장 요청은 만들어진 쿠키 없이는 거부됩니다', async () => {
  const { hearts } = heartsEnv();
  const issued = await hearts.getHeartViewer(heartRequest(), CLASS_A);
  assert.match(issued.cookie, /^moon_heart_class-a=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
  assert.deepEqual(plain(await hearts.getHeartStates(CLASS_A, [OBSERVATION_1], issued.voterKey)), {
    [OBSERVATION_1]: { heartCount: 0, hearted: false },
  });

  const token = cookieToken(issued.cookie);
  const returning = await hearts.getHeartViewer(heartRequest(heartCookie(CLASS_A, token)), CLASS_A);
  assert.equal(returning.cookie, null);
  assert.equal(returning.voterKey, issued.voterKey);

  await assert.rejects(
    () => hearts.getHeartViewer(heartRequest(), CLASS_A, { requireExisting: true }),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () => hearts.getHeartViewer(heartRequest(heartCookie(CLASS_B, token)), CLASS_A, { requireExisting: true }),
    (error) => error.status === 403,
  );
});

test('같은 브라우저가 동시에 눌러도 좋아요는 한 번만 저장됩니다', async () => {
  const { sqlite, hearts } = heartsEnv();
  addClass(sqlite, CLASS_A);
  const [first, second] = await Promise.all([
    hearts.getHeartViewer(heartRequest(heartCookie(CLASS_A, VOTER_A)), CLASS_A),
    hearts.getHeartViewer(heartRequest(heartCookie(CLASS_A, VOTER_A)), CLASS_A),
  ]);
  assert.equal(first.voterKey, second.voterKey);

  const states = await Promise.all(
    [first, second, first, second].map((viewer) => hearts.setHeart(CLASS_A, OBSERVATION_1, viewer.voterKey, true)),
  );
  assert.deepEqual(states.map((state) => state.inserted).sort(), [false, false, false, true]);
  for (const state of states) {
    assert.equal(state.heartCount, 1);
    assert.equal(state.hearted, true);
  }
  assert.equal(countHearts(sqlite, CLASS_A, OBSERVATION_1), 1);
  assert.deepEqual(plain(await hearts.getHeartStates(CLASS_A, [OBSERVATION_1], first.voterKey)), {
    [OBSERVATION_1]: { heartCount: 1, hearted: true },
  });
});

test('좋아요 취소는 여러 번 보내도 안전하고 다른 브라우저의 좋아요를 지우지 않습니다', async () => {
  const { sqlite, hearts } = heartsEnv();
  addClass(sqlite, CLASS_A);
  const one = await hearts.getHeartViewer(heartRequest(heartCookie(CLASS_A, VOTER_A)), CLASS_A);
  const two = await hearts.getHeartViewer(heartRequest(heartCookie(CLASS_A, VOTER_B)), CLASS_A);
  await hearts.setHeart(CLASS_A, OBSERVATION_1, one.voterKey, true);
  await hearts.setHeart(CLASS_A, OBSERVATION_1, two.voterKey, true);

  const removed = await Promise.all([
    hearts.setHeart(CLASS_A, OBSERVATION_1, one.voterKey, false),
    hearts.setHeart(CLASS_A, OBSERVATION_1, one.voterKey, false),
  ]);
  for (const state of removed) assert.deepEqual(plain(state), { heartCount: 1, hearted: false, inserted: false });
  assert.deepEqual(plain(await hearts.getHeartStates(CLASS_A, [OBSERVATION_1], two.voterKey)), {
    [OBSERVATION_1]: { heartCount: 1, hearted: true },
  });
});

test('좋아요는 수업과 기록 단위로 분리됩니다', async () => {
  const { sqlite, hearts } = heartsEnv();
  addClass(sqlite, CLASS_A);
  addClass(sqlite, CLASS_B);
  const a = await hearts.getHeartViewer(heartRequest(heartCookie(CLASS_A, VOTER_A)), CLASS_A);
  const b = await hearts.getHeartViewer(heartRequest(heartCookie(CLASS_B, VOTER_A)), CLASS_B);
  assert.notEqual(a.voterKey, b.voterKey);

  await hearts.setHeart(CLASS_A, OBSERVATION_1, a.voterKey, true);
  assert.deepEqual(plain(await hearts.getHeartStates(CLASS_B, [OBSERVATION_1], b.voterKey)), {
    [OBSERVATION_1]: { heartCount: 0, hearted: false },
  });
  assert.deepEqual(plain(await hearts.getHeartStates(CLASS_A, [OBSERVATION_2], a.voterKey)), {
    [OBSERVATION_2]: { heartCount: 0, hearted: false },
  });

  await hearts.deleteObservationHearts(CLASS_B, OBSERVATION_1);
  assert.equal(countHearts(sqlite, CLASS_A, OBSERVATION_1), 1);
  await hearts.deleteObservationHearts(CLASS_A, OBSERVATION_1);
  assert.equal(countHearts(sqlite, CLASS_A, OBSERVATION_1), 0);
});

test('목록 집계는 30개씩 나눠 읽고 없는 기록은 0으로 채웁니다', async () => {
  const { sqlite, hearts } = heartsEnv();
  addClass(sqlite, CLASS_A);
  const viewer = await hearts.getHeartViewer(heartRequest(heartCookie(CLASS_A, VOTER_A)), CLASS_A);
  const ids = Array.from(
    { length: 45 },
    (_, index) => `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
  );
  await hearts.setHeart(CLASS_A, ids[44], viewer.voterKey, true);

  const states = plain(await hearts.getHeartStates(CLASS_A, [...ids, ids[0], 'not-an-observation-id'], viewer.voterKey));
  assert.equal(Object.keys(states).length, 45);
  assert.deepEqual(states[ids[44]], { heartCount: 1, hearted: true });
  assert.deepEqual(states[ids[0]], { heartCount: 0, hearted: false });
  assert.equal(states['not-an-observation-id'], undefined);
  assert.deepEqual(plain(await hearts.getHeartStates(CLASS_A, [], viewer.voterKey)), {});
});

test('삭제된 수업에는 좋아요가 남지 않습니다', async () => {
  const { sqlite, hearts } = heartsEnv();
  addClass(sqlite, CLASS_A);
  const viewer = await hearts.getHeartViewer(heartRequest(heartCookie(CLASS_A, VOTER_A)), CLASS_A);
  await hearts.setHeart(CLASS_A, OBSERVATION_1, viewer.voterKey, true);
  sqlite.prepare('DELETE FROM teacher_connections WHERE id = ?').run(CLASS_A);
  assert.equal(countHearts(sqlite, CLASS_A, OBSERVATION_1), 0);

  // 수업 삭제와 겹쳐 들어온 저장은 하트를 남기지 않습니다.
  assert.deepEqual(plain(await hearts.setHeart(CLASS_A, OBSERVATION_2, viewer.voterKey, true)), {
    heartCount: 0,
    hearted: false,
    inserted: false,
  });
  assert.equal(totalHearts(sqlite), 0);
});

test('반 삭제와 Drive 연결 해제가 저장된 좋아요를 함께 지웁니다', async () => {
  const env = heartsEnv();
  const runtimeModule = { getEnv: () => env.runtime };
  const tenant = loadModule(MODULES.tenant, {
    './crypto': loadModule(MODULES.crypto, { './runtime': runtimeModule }),
    './runtime': runtimeModule,
    './http': env.http,
  });
  addClass(env.sqlite, CLASS_A);
  addClass(env.sqlite, CLASS_B);
  addAccount(env.sqlite, 'account-1');
  for (const classId of [CLASS_A, CLASS_B]) {
    env.sqlite.prepare('INSERT INTO observation_hearts (class_id, observation_id, voter_key) VALUES (?, ?, ?)')
      .run(classId, OBSERVATION_1, VOTER_A);
  }

  await tenant.deleteTeacherClass(CLASS_A);
  assert.equal(countHearts(env.sqlite, CLASS_A, OBSERVATION_1), 0);
  assert.equal(countHearts(env.sqlite, CLASS_B, OBSERVATION_1), 1);

  await tenant.deleteTeacherAccount('account-1');
  assert.equal(totalHearts(env.sqlite), 0);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM teacher_connections').get().count, 0);
});

function routeHarness(options = {}) {
  const env = heartsEnv();
  addClass(env.sqlite, CLASS_A);
  const scripted = options.observations ? [...options.observations] : null;
  const session = options.session === undefined ? { teacherId: CLASS_A } : options.session;
  const route = loadModule(MODULES.route, {
    '../../../../../lib/auth': {
      getTeacherSession: async () => options.teacherSession ?? null,
      getStudentSession: async () => session,
    },
    '../../../../../lib/google-drive': {
      getTeacherAccessToken: async () => 'test-token',
      findObservationRow: async () => {
        const next = scripted ? scripted.shift() : { id: OBSERVATION_1, status: 'visible' };
        return typeof next === 'function' ? next(env.sqlite) : (next ?? null);
      },
    },
    '../../../../../lib/hearts': env.hearts,
    '../../../../../lib/http': env.http,
    '../../../../../lib/tenant': {
      getTeacherById: async () => (options.teacher === undefined ? { id: CLASS_A } : options.teacher),
    },
  });
  const put = (body, init = {}) => route.PUT(
    new Request(`https://app.invalid/api/observations/${OBSERVATION_1}/heart`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: OBSERVATION_1 }) },
  );
  return { sqlite: env.sqlite, put, hearts: env.hearts };
}

async function establishedCookie(hearts) {
  const issued = await hearts.getHeartViewer(heartRequest(), CLASS_A);
  return heartCookie(CLASS_A, cookieToken(issued.cookie));
}

test('좋아요 저장 요청은 인증·출처·요청 형식을 확인합니다', async () => {
  const harness = routeHarness();
  const unauthenticated = routeHarness({ session: null });
  assert.equal((await unauthenticated.put({ hearted: true })).status, 401);
  assert.equal((await harness.put({ hearted: true }, { headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await harness.put({ hearted: true })).status, 403);
  assert.equal((await harness.put({ hearted: 'yes' })).status, 400);
  assert.equal((await harness.put({ hearted: true, studentNumber: 7 })).status, 400);
  assert.equal((await harness.put('not json')).status, 400);
  assert.equal(totalHearts(harness.sqlite), 0);
});

test('좋아요 저장 요청은 이 수업의 쿠키를 요구하고 없는 기록·숨긴 기록을 거부합니다', async () => {
  const harness = routeHarness();
  const cookie = await establishedCookie(harness.hearts);
  assert.equal((await harness.put({ hearted: true }, { headers: { cookie: heartCookie(CLASS_B, VOTER_A) } })).status, 403);

  const hidden = routeHarness({ observations: [{ id: OBSERVATION_1, status: 'hidden' }] });
  const hiddenCookie = await establishedCookie(hidden.hearts);
  assert.equal((await hidden.put({ hearted: true }, { headers: { cookie: hiddenCookie } })).status, 404);
  assert.equal(totalHearts(hidden.sqlite), 0);

  const missing = routeHarness({ observations: [] });
  const missingCookie = await establishedCookie(missing.hearts);
  assert.equal((await missing.put({ hearted: true }, { headers: { cookie: missingCookie } })).status, 404);
  assert.equal(totalHearts(missing.sqlite), 0);

  // 교사는 자기 반의 숨긴 기록에도 좋아요를 남길 수 있습니다.
  const teacher = routeHarness({ teacherSession: { teacherId: CLASS_A }, observations: [{ id: OBSERVATION_1, status: 'hidden' }, { id: OBSERVATION_1, status: 'hidden' }] });
  const teacherCookie = await establishedCookie(teacher.hearts);
  const response = await teacher.put({ hearted: true }, { headers: { cookie: teacherCookie } });
  assert.deepEqual(await response.json(), { ok: true, heartCount: 1, hearted: true });

  // 쿠키가 있는 정상 저장은 기록 한 건을 남깁니다.
  const saved = await harness.put({ hearted: true }, { headers: { cookie } });
  assert.deepEqual(await saved.json(), { ok: true, heartCount: 1, hearted: true });
  assert.equal(countHearts(harness.sqlite, CLASS_A, OBSERVATION_1), 1);
});

async function seedOtherHeart(hearts, classId = CLASS_A) {
  const other = await hearts.getHeartViewer(heartRequest(heartCookie(classId, VOTER_B)), classId);
  await hearts.setHeart(classId, OBSERVATION_1, other.voterKey, true);
  return other.voterKey;
}

test('기록이 저장 중에 사라지면 남은 하트까지 정리하고 404를 돌려줍니다', async () => {
  const harness = routeHarness({ observations: [{ id: OBSERVATION_1, status: 'visible' }, null] });
  await seedOtherHeart(harness.hearts);
  assert.equal(countHearts(harness.sqlite, CLASS_A, OBSERVATION_1), 1);

  const cookie = await establishedCookie(harness.hearts);
  const response = await harness.put({ hearted: true }, { headers: { cookie } });
  assert.equal(response.status, 404);
  assert.equal(totalHearts(harness.sqlite), 0);

  // 사라진 기록에는 좋아요 취소 요청도 하트를 남기지 않습니다.
  const undo = routeHarness({ observations: [{ id: OBSERVATION_1, status: 'visible' }, null] });
  await seedOtherHeart(undo.hearts);
  const undoResponse = await undo.put({ hearted: false }, { headers: { cookie: await establishedCookie(undo.hearts) } });
  assert.equal(undoResponse.status, 404);
  assert.equal(totalHearts(undo.sqlite), 0);
});

test('저장 중에 학생에게 숨겨진 기록은 자기 하트만 되돌립니다', async () => {
  const harness = routeHarness({ observations: [{ id: OBSERVATION_1, status: 'visible' }, { id: OBSERVATION_1, status: 'hidden' }] });
  const otherKey = await seedOtherHeart(harness.hearts);
  const cookie = await establishedCookie(harness.hearts);
  const response = await harness.put({ hearted: true }, { headers: { cookie } });

  assert.equal(response.status, 404);
  assert.equal(countHearts(harness.sqlite, CLASS_A, OBSERVATION_1), 1);
  assert.deepEqual(plain(await harness.hearts.getHeartStates(CLASS_A, [OBSERVATION_1], otherKey)), {
    [OBSERVATION_1]: { heartCount: 1, hearted: true },
  });
});

test('저장 중에 숨겨진 기록이라도 이미 있던 하트는 지우지 않습니다', async () => {
  const harness = routeHarness({ observations: [{ id: OBSERVATION_1, status: 'visible' }, { id: OBSERVATION_1, status: 'hidden' }] });
  const cookie = await establishedCookie(harness.hearts);
  const viewer = await harness.hearts.getHeartViewer(heartRequest(cookie), CLASS_A);
  await harness.hearts.setHeart(CLASS_A, OBSERVATION_1, viewer.voterKey, true);
  const response = await harness.put({ hearted: true }, { headers: { cookie } });

  assert.equal(response.status, 404);
  assert.equal(countHearts(harness.sqlite, CLASS_A, OBSERVATION_1), 1);
  assert.deepEqual(plain(await harness.hearts.getHeartStates(CLASS_A, [OBSERVATION_1], viewer.voterKey)), {
    [OBSERVATION_1]: { heartCount: 1, hearted: true },
  });
});

test('수업이 저장 중에 삭제되면 하트를 남기지 않고 404를 돌려줍니다', async () => {
  // 저장 전 조회 직후 수업 행이 사라진 상황을 흉내 냅니다.
  const harness = routeHarness({
    observations: [
      (sqlite) => {
        sqlite.prepare('DELETE FROM teacher_connections WHERE id = ?').run(CLASS_A);
        return { id: OBSERVATION_1, status: 'visible' };
      },
      null,
    ],
  });
  const cookie = await establishedCookie(harness.hearts);
  const response = await harness.put({ hearted: true }, { headers: { cookie } });
  assert.equal(response.status, 404);
  assert.equal(totalHearts(harness.sqlite), 0);
  // 외래 키가 살아 있어야 삭제된 수업에 하트 행을 만들 수 없습니다.
  assert.throws(
    () => harness.sqlite.prepare('INSERT INTO observation_hearts (class_id, observation_id, voter_key) VALUES (?, ?, ?)')
      .run('missing-class', OBSERVATION_1, VOTER_A),
    /FOREIGN KEY constraint failed/,
  );
});

test('좋아요 저장은 반복해도 같은 결과를 돌려줍니다', async () => {
  const harness = routeHarness();
  const cookie = await establishedCookie(harness.hearts);
  const first = await harness.put({ hearted: true }, { headers: { cookie } });
  const second = await harness.put({ hearted: true }, { headers: { cookie } });
  assert.deepEqual(await first.json(), { ok: true, heartCount: 1, hearted: true });
  assert.deepEqual(await second.json(), { ok: true, heartCount: 1, hearted: true });
  const off = await harness.put({ hearted: false }, { headers: { cookie } });
  assert.deepEqual(await off.json(), { ok: true, heartCount: 0, hearted: false });
});

test('저장 후 기록 재확인이 실패하면 자신의 하트를 취소하고 다른 참여자의 하트는 유지합니다', async () => {
  const harness = routeHarness({ observations: [
    { id: OBSERVATION_1, status: 'visible' },
    () => { throw new Error('temporary Sheets verification failure'); },
  ] });
  const otherKey = await seedOtherHeart(harness.hearts);
  const cookie = await establishedCookie(harness.hearts);
  const response = await harness.put({ hearted: true }, { headers: { cookie } });
  assert.equal(response.status, 500);
  assert.equal(countHearts(harness.sqlite, CLASS_A, OBSERVATION_1), 1);
  assert.deepEqual(plain(await harness.hearts.getHeartStates(CLASS_A, [OBSERVATION_1], otherKey)), {
    [OBSERVATION_1]: { heartCount: 1, hearted: true },
  });
});

test("재확인 실패가 중복 저장 요청 전부터 있던 하트를 삭제하지 않습니다", async () => {
  const harness = routeHarness({ observations: [
    { id: OBSERVATION_1, status: "visible" },
    () => { throw new Error("temporary Sheets verification failure"); },
  ] });
  const cookie = await establishedCookie(harness.hearts);
  const viewer = await harness.hearts.getHeartViewer(heartRequest(cookie), CLASS_A);
  await harness.hearts.setHeart(CLASS_A, OBSERVATION_1, viewer.voterKey, true);
  const response = await harness.put({ hearted: true }, { headers: { cookie } });
  assert.equal(response.status, 500);
  assert.deepEqual(plain(await harness.hearts.getHeartStates(CLASS_A, [OBSERVATION_1], viewer.voterKey)), {
    [OBSERVATION_1]: { heartCount: 1, hearted: true },
  });
});

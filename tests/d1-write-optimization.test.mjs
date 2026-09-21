import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const instant = Date.parse('2026-09-21T06:00:00.000Z');
const timestamp = (offset = 0) => new Date(instant + offset).toISOString();
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return instant; }
}

function load(path, services = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(source, { exports, require: () => services, Date: FixedDate, crypto, console, Request, Response, Headers, URL });
  return exports;
}

function harness(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  sqlite.exec(`INSERT INTO teacher_accounts
    (id, google_permission_id, google_email, google_display_name, refresh_token_ciphertext, created_at, updated_at)
    VALUES ('account', 'permission', 'synthetic@example.invalid', '가상 교사', 'synthetic-ciphertext', 'before', 'before')`);
  for (const id of ['class-a', 'class-b']) {
    sqlite.prepare(`INSERT INTO teacher_connections
      (id, account_id, google_permission_id, google_email, google_display_name, refresh_token_ciphertext,
       root_folder_id, photos_folder_id, spreadsheet_id, sheet_id, sheet_title,
       invite_token_hash, invite_token_ciphertext, class_label, created_at, updated_at)
      VALUES (?, 'account', 'permission', 'synthetic@example.invalid', '가상 교사', 'legacy-ciphertext',
        ?, ?, ?, 0, '관찰', ?, ?, ?, 'before', 'before')`)
      .run(id, `${id}-root`, `${id}-photos`, `${id}-sheet`, `${id}-invite`, `${id}-ciphertext`, id);
  }
  const writes = [];
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { return stmt.get(...this.args) || null; },
        async run() {
          const { changes } = stmt.run(...this.args);
          writes.push({ sql, changes });
          return { success: true, meta: { changes } };
        },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const stmt of statements) results.push(await stmt.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const http = load('../lib/http.ts');
  const tenant = load('../lib/tenant.ts', { ...http, getEnv: () => ({ DB: db }) });
  const maintenance = load('../lib/d1-maintenance.ts');
  const receipt = (id, expires = timestamp(-1), teacher = 'class-a', status = 'completed') => {
    sqlite.prepare('INSERT INTO submission_receipts VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, teacher, `${id}-observation`, status, timestamp(-86400000), expires);
  };
  const event = (id, created = timestamp(-3600001), teacher = 'class-a', session = 'device') => {
    sqlite.prepare('INSERT INTO submission_events VALUES (?, ?, ?, ?, ?)')
      .run(id, teacher, session, created, new Date(Date.parse(created) + 3600000).toISOString());
  };
  const ticket = (id, expires = timestamp(-1), teacher = 'class-a', status = 'visible') => {
    sqlite.prepare('INSERT INTO image_tickets VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, teacher, `${id}-file`, 'image/jpeg', status, expires);
  };
  return { sqlite, db, tenant, maintenance, receipt, event, ticket, writes };
}

test('기존 완료 영수증과 다른 반의 요청은 보존하고 재업로드를 허용하지 않는다', async t => {
  const h = harness(t);
  h.receipt('existing', timestamp(1));
  const before = h.sqlite.prepare('SELECT * FROM submission_receipts').get();
  const existing = await h.tenant.reserveSubmission('existing', 'class-a');
  assert.equal(existing.newlyReserved, false);
  assert.equal(existing.observationId, 'existing-observation');
  await assert.rejects(h.tenant.reserveSubmission('existing', 'class-b'), error => error.status === 409);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM submission_receipts').get(), before);
  assert.equal(h.writes.length, 0);
});

for (const expired of [false, true]) {
  test(`${expired ? '만료된' : '새'} 요청이 동시에 도착해도 예약 소유자는 한 명이다`, async t => {
    const h = harness(t);
    if (expired) h.receipt('same');
    const results = await Promise.all([
      h.tenant.reserveSubmission('same', 'class-a'),
      h.tenant.reserveSubmission('same', 'class-a'),
    ]);
    assert.equal(results.filter(result => result.newlyReserved).length, 1);
    const saved = h.sqlite.prepare('SELECT * FROM submission_receipts').get();
    assert.equal(saved.status, 'processing');
    assert.equal(saved.observation_id, null);
    assert.equal(saved.expires_at, timestamp(86400000));
    assert.equal(h.writes.reduce((sum, write) => sum + write.changes, 0), 1);
  });
}

test('같은 요청 ID를 서로 다른 반이 동시에 예약하면 한 반만 소유한다', async t => {
  const h = harness(t);
  const results = await Promise.allSettled([
    h.tenant.reserveSubmission('same', 'class-a'),
    h.tenant.reserveSubmission('same', 'class-b'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.newlyReserved).length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
});

test('만료 경계의 영수증은 유효하고 정기 청소 없이도 만료된 요청은 재사용한다', async t => {
  const h = harness(t);
  h.receipt('boundary', timestamp());
  h.receipt('expired');
  assert.equal((await h.tenant.reserveSubmission('boundary', 'class-a')).newlyReserved, false);
  assert.equal((await h.tenant.reserveSubmission('expired', 'class-a')).newlyReserved, true);
  assert.equal(h.writes.some(write => /DELETE/.test(write.sql)), false);
});

test('청소가 지연되어도 오래된 이벤트는 횟수에 포함하지 않고 다른 반을 건드리지 않는다', async t => {
  const h = harness(t);
  for (let i = 0; i < 110; i += 1) h.event(`old-${i}`);
  for (let i = 0; i < 3; i += 1) h.event(`other-${i}`, timestamp(), 'class-b');
  await h.tenant.enforceSubmissionRateLimit('class-a', 'device');
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM submission_events').get().count, 114);
  assert.equal(h.writes.length, 1);
  assert.match(h.writes[0].sql, /INSERT INTO submission_events/);
});

test('브라우저 10분 3회 제한과 학급 1시간 100회 제한은 경계에서도 유지한다', async t => {
  const h = harness(t);
  for (let i = 0; i < 3; i += 1) h.event(`device-${i}`, timestamp(-600000));
  await assert.rejects(h.tenant.enforceSubmissionRateLimit('class-a', 'device'), error => error.status === 429);
  for (let i = 0; i < 100; i += 1) h.event(`class-${i}`, timestamp(-3600000), 'class-b', `device-${i}`);
  await assert.rejects(h.tenant.enforceSubmissionRateLimit('class-b', 'new-device'), error => error.status === 429);
  assert.equal(h.writes.length, 0);
});

test('만료된 사진 전달표는 삭제 후 삽입 대신 한 번 갱신하고 유효한 동일 정보는 쓰지 않는다', async t => {
  const h = harness(t);
  h.ticket('photo');
  assert.equal(await h.tenant.getImageTicket('photo', 'class-a'), null);
  const item = { observationId: 'photo', fileId: 'photo-file', imageType: 'image/jpeg', status: 'visible' };
  await h.tenant.seedImageTickets('class-a', [item]);
  assert.equal(h.writes.reduce((sum, write) => sum + write.changes, 0), 1);
  assert.equal((await h.tenant.getImageTicket('photo', 'class-a')).fileId, 'photo-file');
  assert.equal(h.sqlite.prepare('SELECT expires_at FROM image_tickets').get().expires_at, timestamp(1800000));
  await h.tenant.seedImageTickets('class-a', [item]);
  assert.equal(h.writes.at(-1).changes, 0);
  assert.equal(h.writes.some(write => /DELETE/.test(write.sql)), false);
});

test('기존 사진 12개의 반복 목록 조회는 만료 전 쓰기 0건이며 다른 반의 만료 자료도 청소하지 않는다', async t => {
  const h = harness(t);
  const items = Array.from({ length: 12 }, (_, index) => {
    const id = `photo-${index}`;
    h.ticket(id, timestamp(1000));
    return { observationId: id, fileId: `${id}-file`, imageType: 'image/jpeg', status: 'visible' };
  });
  h.ticket('other-class', timestamp(-1), 'class-b');
  await h.tenant.seedImageTickets('class-a', items);
  await h.tenant.seedImageTickets('class-a', items);
  assert.equal(h.writes.reduce((sum, write) => sum + write.changes, 0), 0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM image_tickets').get().count, 13);
  assert.equal(h.writes.some(write => /DELETE/.test(write.sql)), false);
});

test('공개 상태 변경은 즉시 반영하고 같은 관찰 ID라도 다른 반의 전달표를 빼앗지 않는다', async t => {
  const h = harness(t);
  h.ticket('photo', timestamp(1000));
  for (const status of ['hidden', 'visible']) {
    await h.tenant.seedImageTickets('class-a', [{ observationId: 'photo', fileId: 'photo-file', imageType: 'image/jpeg', status }]);
    assert.equal((await h.tenant.getImageTicket('photo', 'class-a')).status, status);
  }
  await h.tenant.seedImageTickets('class-b', [{ observationId: 'photo', fileId: 'other-file', imageType: 'image/png', status: 'hidden' }]);
  assert.equal(await h.tenant.getImageTicket('photo', 'class-b'), null);
  assert.equal((await h.tenant.getImageTicket('photo', 'class-a')).fileId, 'photo-file');
  await h.tenant.deleteImageTicket('photo', 'class-b');
  assert.ok(await h.tenant.getImageTicket('photo', 'class-a'));
  await h.tenant.deleteImageTicket('photo', 'class-a');
  assert.equal(await h.tenant.getImageTicket('photo', 'class-a'), null);
});

for (const status of ['visible', 'hidden', 'missing']) {
  test(`기존 사진의 전달표가 만료되면 원본의 ${status} 상태를 확인하고 학생 접근을 결정한다`, async t => {
    const h = harness(t);
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    h.ticket(id);
    let sheetReads = 0;
    let downloads = 0;
    const route = load('../app/api/images/[id]/route.ts', {
      ...load('../lib/http.ts'), ...h.tenant,
      getTeacherSession: async () => null,
      getStudentSession: async () => ({ teacherId: 'class-a' }),
      getTeacherById: async () => ({ id: 'class-a', spreadsheetId: 'class-a-sheet' }),
      getTeacherAccessToken: async () => 'synthetic-token',
      findObservationRow: async (_token, teacher, observationId) => {
        assert.equal(teacher.spreadsheetId, 'class-a-sheet');
        assert.equal(observationId, id);
        sheetReads += 1;
        return status === 'missing' ? null : { id, imageFileId: `${id}-file`, imageType: 'image/jpeg', status };
      },
      downloadObservationImage: async () => { downloads += 1; return new Response('가상 사진'); },
    });
    const response = await route.GET(new Request(`https://test.invalid/api/images/${id}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, status === 'visible' ? 200 : 404);
    assert.equal(sheetReads, 1);
    assert.equal(downloads, status === 'visible' ? 1 : 0);
  });
}

test('정기 청소는 만료 임시자료만 지우고 반 연결·초대 링크·색인·잠금·하트를 보존한다', async t => {
  const h = harness(t);
  h.sqlite.exec(`INSERT INTO observation_row_index VALUES ('class-a', 'class-a-sheet', 'observation', 42, 'before');
    INSERT INTO sheet_write_locks VALUES ('class-a-sheet', 'class-a', 'owner', 'append', 'observation', NULL, 'version', 'uncertain', 'before');
    INSERT INTO observation_hearts VALUES ('class-a', 'observation', 'viewer', 'before');`);
  const preserved = ['teacher_accounts', 'teacher_connections', 'observation_row_index', 'sheet_write_locks', 'observation_hearts'];
  const before = preserved.map(table => h.sqlite.prepare(`SELECT * FROM ${table}`).all());
  for (const seed of [h.receipt, h.event, h.ticket]) {
    seed('expired');
    seed('boundary', timestamp());
    seed('valid', timestamp(3600000), 'class-b');
  }
  await h.maintenance.cleanupExpiredTransientData(h.db, new Date(instant));
  for (const table of ['submission_receipts', 'submission_events', 'image_tickets']) {
    assert.equal(h.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 2);
  }
  assert.deepEqual(preserved.map(table => h.sqlite.prepare(`SELECT * FROM ${table}`).all()), before);
  assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('만료 자료가 많아도 한 번에 테이블별 500건만 정리하고 다음 실행에서 이어간다', async t => {
  const h = harness(t);
  for (let i = 0; i < 501; i += 1) {
    h.receipt(`receipt-${i}`);
    h.event(`event-${i}`);
    h.ticket(`ticket-${i}`);
  }
  await h.maintenance.cleanupExpiredTransientData(h.db, new Date(instant));
  for (const write of h.writes) assert.equal(write.changes, 500);
  await h.maintenance.cleanupExpiredTransientData(h.db, new Date(instant));
  for (const table of ['submission_receipts', 'submission_events', 'image_tickets']) {
    assert.equal(h.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  }
});

test('Worker의 예약 작업은 완료까지 기다리고 실패를 스케줄러에 전달한다', async () => {
  let finish;
  let receivedDB;
  const db = {};
  const pending = new Promise(resolve => { finish = resolve; });
  const worker = load('../worker/index.ts', { cleanupExpiredTransientData: supplied => { receivedDB = supplied; return pending; } }).default;
  let done = false;
  const work = worker.scheduled({}, { DB: db }).then(() => { done = true; });
  await new Promise(setImmediate);
  assert.equal(done, false);
  assert.equal(receivedDB, db);
  finish();
  await work;
  const broken = load('../worker/index.ts', { cleanupExpiredTransientData: async () => { throw new Error('합성 청소 실패'); } }).default;
  await assert.rejects(broken.scheduled({}, { DB: db }), /합성 청소 실패/);
});

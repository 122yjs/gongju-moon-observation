import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(relativePath, services = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(source, {
    exports, require: () => services, Request, Response, Headers, URL, URLSearchParams,
    crypto, TextEncoder, console: { error() {}, warn() {} }, ...globals,
  });
  return exports;
}

function harness({ authenticated = true, sheetFailure = false, initialRowNumber = 2 } = {}) {
  const http = load('../lib/http.ts');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const teacher = { id: 'class-a', accountId: 'account-a', spreadsheetId: 'sheet-a', sheetTitle: '관찰', sheetId: 0, summarySheetId: 99, sheetSchemaVersion: 2 };
  const row = [id, 'request', '가상 학급', 7, '합성 이름', '2026-09-18T20:00', '', 'photo', 'image/jpeg', 100, 'visible', '2026-09-18T11:00:00Z', '', '', '', '', ''];
  let stored = '';
  let writes = 0;
  let sheetRows = Array.from({ length: initialRowNumber - 1 }, () => []);
  sheetRows[initialRowNumber - 2] = [...row, stored, '2026-09-18T11:00:00Z'];
  const index = new Map();
  let lock = null;
  const readRanges = [];
  const db = {
    prepare(sql) {
      const statement = {
        bind(...args) {
          return { ...statement, args };
        },
        async run() {
          if (sql.includes('INSERT INTO sheet_write_locks')) {
            if (!lock) {
              const [spreadsheetId, teacherId, ownerToken, operation, observationId, expectedVersion, intendedVersion] = this.args;
              lock = { spreadsheet_id: spreadsheetId, teacher_id: teacherId, owner_token: ownerToken, operation, observation_id: observationId, expected_version: expectedVersion, intended_version: intendedVersion, state: 'active' };
            }
          } else if (sql.includes("SET state = 'uncertain'")) {
            if (lock) lock.state = 'uncertain';
          } else if (sql.includes('SET expected_version = ?')) {
            if (lock) [lock.expected_version, lock.intended_version] = this.args;
          } else if (sql.includes('DELETE FROM sheet_write_locks')) {
            const [spreadsheetId, ownerToken] = this.args;
            if (lock?.spreadsheet_id === spreadsheetId && lock?.owner_token === ownerToken) lock = null;
          } else if (sql.includes('INSERT INTO observation_row_index')) {
            const [teacherId, , observationId, rowNumber] = this.args;
            index.set(`${teacherId}:${observationId}`, Number(rowNumber));
          } else if (sql.includes('DELETE FROM observation_row_index WHERE teacher_id = ? AND observation_id = ?')) {
            const [teacherId, observationId] = this.args;
            index.delete(`${teacherId}:${observationId}`);
          } else if (sql.includes('DELETE FROM observation_row_index WHERE teacher_id = ?')) {
            const [teacherId] = this.args;
            for (const key of [...index.keys()]) {
              if (key.startsWith(`${teacherId}:`)) index.delete(key);
            }
          }
          return { success: true };
        },
        async first() {
          if (sql.includes('FROM sheet_write_locks')) return lock || undefined;
          if (sql.includes('SELECT row_number')) {
            const [teacherId, observationId] = this.args;
            const rowNumber = index.get(`${teacherId}:${observationId}`);
            return rowNumber ? { row_number: rowNumber } : undefined;
          }
          return undefined;
        },
      };
      return statement;
    },
  };
  const drive = load('../lib/google-drive.ts', { ...http, getEnv: () => ({ DB: db }) }, {
    fetch: async (url, init = {}) => {
      const u = new URL(url);
      const range = decodeURIComponent(u.pathname.split('/values/')[1] || '');
      if (init.method === 'PUT' || init.method === 'POST') {
        if (sheetFailure) return Response.json({ error: { message: 'synthetic Sheets failure' } }, { status: 503 });
        const body = JSON.parse(init.body);
        if (range.endsWith('R2:S2')) {
          assert.equal(u.searchParams.get('valueInputOption'), 'RAW', 'feedback must remain literal text in Sheets');
          stored = body.values[0][0];
          sheetRows[0][17] = stored;
          sheetRows[0][18] = body.values[0][1];
          writes += 1;
        }
        if (range.includes(':append')) {
          sheetRows = [[...row, stored, '2026-09-18T11:00:00Z']];
          return Response.json({ updates: { updatedRange: `'관찰'!A2:S2` } });
        }
        return Response.json({});
      }
      readRanges.push(range);
      if (range === "'관찰'!A2:A") return Response.json({ values: sheetRows.map((item) => [item[0]]) });
      if (range.includes('A2:S2001')) return Response.json({ values: sheetRows });
      if (/A\d+:S\d+/.test(range)) {
        const match = /A(\d+):S(\d+)/.exec(range);
        const rowNumber = Number(match[1]);
        const item = sheetRows[rowNumber - 2];
        return Response.json({ values: item ? [item] : [] });
      }
      return Response.json({ values: range.includes('A1:') ? [[]] : [[...row, stored]] });
    },
  });
  const route = load('../app/api/admin/observations/[id]/route.ts', {
    ...http, ...drive,
    getTeacherSession: async () => authenticated ? { teacherId: teacher.id } : null,
    getTeacherById: async () => teacher,
    getTeacherAccessToken: async () => 'synthetic-token',
  });
  const adminListRoute = load('../app/api/admin/observations/route.ts', {
    ...http, ...drive,
    getTeacherSession: async () => authenticated ? { teacherId: teacher.id } : null,
    getTeacherById: async () => teacher,
    getTeacherAccessToken: async () => 'synthetic-token',
    getHeartViewer: async () => ({ voterKey: 'viewer', cookie: null }),
    getHeartStates: async () => ({}),
    seedImageTickets: async () => {},
    decodeCursor: () => null,
    encodeCursor: () => 'cursor',
  });
  return {
    writes: () => writes,
    stored: () => stored,
    setIndexedRow: (rowNumber) => index.set(`${teacher.id}:${id}`, rowNumber),
    read: () => drive.findObservationRow('synthetic-token', teacher, id),
    patch: (payload, origin = 'https://test.invalid') => route.PATCH(new Request(`https://test.invalid/api/admin/observations/${id}`, {
      method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), { params: Promise.resolve({ id }) }),
    remove: () => route.DELETE(new Request('https://test.invalid/api/admin/observations/' + id, {
      method: 'DELETE', headers: { Origin: 'https://test.invalid' },
    }), { params: Promise.resolve({ id }) }),
    __sheetRows: () => sheetRows,
    drive,
    teacher,
    lock: () => lock,
    replaceRowId: (nextId) => { sheetRows[initialRowNumber - 2][0] = nextId; },
    readRanges: () => [...readRanges],
    clearReadRanges: () => { readRanges.length = 0; },
    adminGet: () => adminListRoute.GET(new Request('https://test.invalid/api/admin/observations')),
  };
}

test('teacher feedback persists as literal text, replaces the single value, and can be cleared', async () => {
  const h = harness();
  assert.equal((await h.read()).teacherFeedback, '');
  for (const text of ['=HYPERLINK("https://invalid.example", "text")', '<img src=x onerror=alert(1)>\n다음 관찰도 기대해요', '']) {
    const response = await h.patch({ teacherFeedback: text });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.teacherFeedback, text);
    const reread = await h.read();
    assert.equal(reread.teacherFeedback, text);
    assert.equal(body.observation.updatedAt, reread.updatedAt);
    assert.equal(body.observation.version, await h.drive.observationVersion(reread));
  }
});

test('a current-schema admin list performs exactly one Sheets read and includes a string version', async () => {
  const h = harness();
  const response = await h.adminGet();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(h.readRanges().filter(Boolean).length, 1);
  assert.equal(h.readRanges()[0], "'관찰'!A2:S2001");
  assert.equal(typeof body.items[0].version, 'string');
  assert.equal(body.items[0].studentName, '합성 이름');
  assert.equal(body.items[0].imageUrl, '/api/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

test('student/anonymous and cross-origin requests cannot write teacher feedback', async () => {
  const denied = harness({ authenticated: false });
  assert.equal((await denied.patch({ teacherFeedback: 'unauthorized' })).status, 401);
  assert.equal(denied.writes(), 0);
  const crossOrigin = harness();
  assert.equal((await crossOrigin.patch({ teacherFeedback: 'unauthorized' }, 'https://other.invalid')).status, 403);
  assert.equal(crossOrigin.writes(), 0);
});

test('feedback accepts 500 Unicode characters and rejects oversize or nontext without replacing saved content', async () => {
  const h = harness();
  const boundary = '\u{1F319}'.repeat(500);
  assert.equal((await h.patch({ teacherFeedback: boundary })).status, 200);
  for (const bad of [boundary + 'x', 1, null]) {
    assert.equal((await h.patch({ teacherFeedback: bad })).status, 400);
    assert.equal(h.stored(), boundary);
  }
});

test('a Sheets write failure does not report feedback as saved', async () => {
  const h = harness({ sheetFailure: true });
  assert.equal((await h.patch({ teacherFeedback: '저장 실패' })).status, 503);
  assert.equal(h.stored(), '');
});

test('stale observation index falls back to the full sheet and rebuilds', async () => {
  const h = harness();
  h.setIndexedRow(5);
  assert.equal((await h.read()).rowNumber, 2);
});

test('a valid observation index reads only the indexed A:S row', async () => {
  const h = harness();
  await h.read();
  h.clearReadRanges();
  assert.equal((await h.read()).rowNumber, 2);
  assert.deepEqual(h.readRanges(), ["'관찰'!A2:S2"]);
});

test('single-row lookup recovers an observation beyond the 2,000-row list cap', async () => {
  const h = harness({ initialRowNumber: 2002 });
  assert.equal((await h.read()).rowNumber, 2002);
});

test('a moved row with another observation id is never updated', async () => {
  const h = harness();
  h.setIndexedRow(2);
  h.replaceRowId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal((await h.patch({ teacherFeedback: '잘못된 학생' })).status, 404);
  assert.equal(h.writes(), 0);
});

test('a stale client version returns 409 with the current observation and no write', async () => {
  const h = harness();
  const response = await h.patch({ teacherFeedback: '충돌', version: 'stale-version' });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.observation.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(typeof body.observation.version, 'string');
  assert.equal(h.writes(), 0);
});

test('manual recovery cannot release an in-flight writer', async () => {
  const h = harness();
  let finish;
  const writing = h.drive.withSheetWriteLock(h.teacher, { operation: 'append' }, async (guard) => {
    await guard.writeGoogle(() => new Promise((resolve) => { finish = resolve; }));
  });
  await new Promise(setImmediate);
  await assert.rejects(
    h.drive.withSheetWriteLock(h.teacher, { operation: 'update-feedback' }, async () => {}),
    (error) => error.status === 409,
  );
  await assert.rejects(
    h.drive.recoverSheetWriteLock('synthetic-token', h.teacher),
    (error) => error.status === 409,
  );
  assert.equal(h.lock().state, 'active');
  finish();
  await writing;
  assert.equal(h.lock(), null);
});

test('append recovery verifies the normalized persisted version before releasing an uncertain lock', async () => {
  const h = harness();
  const current = await h.read();
  const appendShape = { ...current, originalObservedAt: undefined, rowNumber: 0 };
  const intendedVersion = await h.drive.observationVersion(appendShape);
  assert.equal(intendedVersion, await h.drive.observationVersion(current));
  await assert.rejects(
    h.drive.withSheetWriteLock(
      h.teacher,
      { operation: 'append', observationId: current.id, intendedVersion },
      async (guard) => {
        await guard.setVersions(null, intendedVersion);
        await guard.writeGoogle(async () => { throw new Error('response lost'); });
      },
    ),
    (error) => h.drive.isSheetWriteUncertainError(error),
  );
  assert.equal(h.lock().state, 'uncertain');
  const recovery = await h.drive.recoverSheetWriteLock('synthetic-token', h.teacher);
  assert.equal(recovery.outcome, 'applied');
  assert.equal(h.lock(), null);
});

test('uncertain recovery stays fail-closed until the intended version is visible', async () => {
  const h = harness();
  const current = await h.read();
  await assert.rejects(h.drive.withSheetWriteLock(
    h.teacher,
    { operation: 'update-feedback', observationId: current.id },
    async (guard) => {
      await guard.setVersions(await h.drive.observationVersion(current), 'not-visible-yet');
      await guard.writeGoogle(async () => { throw new Error('response lost'); });
    },
  ));
  await assert.rejects(
    h.drive.recoverSheetWriteLock('synthetic-token', h.teacher),
    (error) => error.status === 409,
  );
  assert.equal(h.lock().state, 'uncertain');
});

test('retrying a partially completed record deletion removes only that class heart data', async () => {
  const http = load('../lib/http.ts');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let recordExists = true;
  const retainedHearts = new Set(['class-a:' + id, 'class-b:' + id]);
  const route = load('../app/api/admin/observations/[id]/route.ts', {
    ...http,
    getTeacherSession: async () => ({ teacherId: 'class-a' }),
    getTeacherById: async () => ({ id: 'class-a' }),
    getTeacherAccessToken: async () => 'synthetic-token',
    withSheetWriteLock: async (_teacher, _intent, action) => action({ setVersions: async () => {} }),
    observationVersion: async () => 'synthetic-version',
    findObservationRow: async () => recordExists ? { id } : null,
    deleteObservation: async () => { recordExists = false; throw new Error('D1 cleanup unavailable'); },
    deleteObservationHearts: async (classId, observationId) => { retainedHearts.delete(classId + ':' + observationId); },
    deleteImageTicket: async () => {},
  });
  const remove = () => route.DELETE(new Request('https://test.invalid/api/admin/observations/' + id, {
    method: 'DELETE', headers: { Origin: 'https://test.invalid' },
  }), { params: Promise.resolve({ id }) });
  assert.equal((await remove()).status, 500);
  assert.equal((await remove()).status, 200);
  assert.equal(retainedHearts.has('class-a:' + id), false);
  assert.equal(retainedHearts.has('class-b:' + id), true);
});

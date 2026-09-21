import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(path, services = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(source, {
    exports, require: () => services, Request, Response, Headers, URL, URLSearchParams,
    crypto, TextEncoder, console: { warn() {}, error() {} }, ...globals,
  });
  return exports;
}

function harness({ googleStatus = 200, transportFailure = false, verificationFailure = false,
  insertResponseLost = false, receiptFailure = false, requireColumnA = false,
  updatedRange = "'관찰'!A2:S2" } = {}) {
  const http = load('../lib/http.ts');
  const teacher = { id: 'class-a', spreadsheetId: 'sheet-a', sheetTitle: '관찰' };
  const observation = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestId: 'request-a', classLabel: '합성 학급',
    studentNumber: 7, studentName: '합성 이름', observedAt: '2026-09-20T20:00', memo: '',
    teacherFeedback: '', imageFileId: 'file-a', imageType: 'image/jpeg', imageBytes: 100,
    status: 'visible', createdAt: '2026-09-20T11:00:00Z', updatedAt: '2026-09-20T11:00:00Z', imageWebViewUrl: '',
  };
  let lock = null;
  let stored = [];
  let googleWrites = 0;
  let repairedReceipt = null;
  const db = { prepare(sql) {
    const statement = {
      bind(...args) { return { ...statement, args }; },
      async run() {
        const args = this.args || [];
        if (sql.includes('INSERT INTO sheet_write_locks')) {
          if (!lock) {
            const [spreadsheet_id, teacher_id, owner_token, operation, observation_id,
              expected_version, intended_version, created_at] = args;
            lock = { spreadsheet_id, teacher_id, owner_token, operation, observation_id,
              expected_version, intended_version, created_at, state: 'active' };
          }
          if (insertResponseLost) throw new Error('insert response lost');
        } else if (sql.includes('DELETE FROM sheet_write_locks')) {
          if (lock?.spreadsheet_id === args[0] && lock?.owner_token === args[1]) lock = null;
        } else if (sql.includes("SET state = 'uncertain'")) {
          if (lock?.spreadsheet_id === args[0] && lock?.owner_token === args[1]) lock.state = 'uncertain';
        } else if (sql.includes('SET expected_version = ?')) {
          [lock.expected_version, lock.intended_version] = args;
        } else if (sql.includes('UPDATE submission_receipts')) {
          assert.match(sql, /request_id = \? AND teacher_id = \? AND status = 'processing'/);
          if (receiptFailure) throw new Error('receipt repair unavailable');
          repairedReceipt = args;
        }
        return { success: true };
      },
      async first() {
        if (sql.includes('FROM sheet_write_locks')) {
          if (verificationFailure) throw new Error('lock verification unavailable');
          return lock;
        }
        return null;
      },
    };
    return statement;
  } };
  const drive = load('../lib/google-drive.ts', { ...http, getEnv: () => ({ DB: db }) }, {
    fetch: async (url, init = {}) => {
      if (init.method === 'POST' || init.method === 'PUT') {
        googleWrites += 1;
        if (transportFailure) throw new Error('response lost');
        if (googleStatus !== 200) return Response.json({ error: { message: 'synthetic Google rejection' } }, { status: googleStatus });
        const body = JSON.parse(init.body);
        if (String(url).includes(':append')) {
          // 오른쪽 선택 항목에 값이 있어도 표 탐색은 관찰 ID 열에서만 시작해야 합니다.
          if (requireColumnA) {
            assert.equal(decodeURIComponent(new URL(url).pathname.split('/values/')[1]), "'관찰'!A:A:append");
            assert.equal(body.values[0].length, 19);
          }
          stored = body.values;
        }
        return Response.json({ updates: { updatedRange } });
      }
      const range = decodeURIComponent(new URL(url).pathname.split('/values/')[1] || '');
      return Response.json({ values: range.endsWith('!A2:A') ? stored.map((row) => [row[0]]) : stored });
    },
  });
  const seedConfirmed = async (overrides = {}) => {
    await drive.appendObservationRow('synthetic-token', teacher, observation);
    lock = {
      spreadsheet_id: teacher.spreadsheetId, teacher_id: teacher.id, owner_token: 'original-owner',
      operation: 'append', observation_id: observation.id, expected_version: null,
      intended_version: await drive.observationVersion({ ...observation, rowNumber: 2 }),
      state: 'active', created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), ...overrides,
    };
  };
  return {
    drive, teacher, observation, seedConfirmed,
    lock: () => lock, setLock: (value) => { lock = value; },
    clearStored: () => { stored = []; },
    googleWrites: () => googleWrites, repairedReceipt: () => repairedReceipt,
    append: () => drive.appendObservationRow('synthetic-token', teacher, observation),
    recover: () => drive.recoverSheetWriteLock('synthetic-token', teacher),
  };
}

test('새 관찰은 A열을 기준으로 찾고 19개 열을 모두 저장한다', async () => {
  const h = harness({ requireColumnA: true });
  await h.append();
  assert.equal(h.lock(), null);
});

test('Google이 Q열부터 저장했다고 응답하면 성공 처리하거나 잠금을 풀지 않는다', async () => {
  const h = harness({ updatedRange: "'관찰'!Q2:AI2" });
  await assert.rejects(h.append(), error => h.drive.isSheetWriteUncertainError(error));
  assert.equal(h.lock().state, 'uncertain');
  assert.equal(h.googleWrites(), 1);
});

for (const googleStatus of [400, 401, 403, 404, 413, 429]) {
  test(`an explicitly rejected append (${googleStatus}) releases its lock without retrying`, async () => {
    const h = harness({ googleStatus });
    await assert.rejects(h.append(), (error) => error.status === googleStatus && !h.drive.isSheetWriteUncertainError(error));
    assert.equal(h.lock(), null);
    assert.equal(h.googleWrites(), 1);
  });
}

for (const options of [{ googleStatus: 503 }, { transportFailure: true }]) {
  test(`an ambiguous append (${JSON.stringify(options)}) keeps its uncertainty lock`, async () => {
    const h = harness(options);
    await assert.rejects(h.append(), (error) => h.drive.isSheetWriteUncertainError(error));
    assert.equal(h.lock().state, 'uncertain');
    assert.equal(h.googleWrites(), 1);
  });
}

for (const options of [{ verificationFailure: true }, { insertResponseLost: true }]) {
  test(`failure before a Google write cleans up only its own reservation (${JSON.stringify(options)})`, async () => {
    const h = harness(options);
    await assert.rejects(h.append());
    assert.equal(h.lock(), null);
    assert.equal(h.googleWrites(), 0);
  });
}

test('an acquisition failure never removes another request owner token', async () => {
  const h = harness({ verificationFailure: true });
  h.setLock({ spreadsheet_id: h.teacher.spreadsheetId, owner_token: 'other-owner', state: 'active' });
  await assert.rejects(h.append());
  assert.equal(h.lock().owner_token, 'other-owner');
  assert.equal(h.googleWrites(), 0);
});

test('the single-append rejection exception is not applied to a multi-step writer', async () => {
  const h = harness({ googleStatus: 429 });
  await assert.rejects(h.drive.withSheetWriteLock(h.teacher, { operation: 'delete-observation' }, async (guard) => {
    await guard.writeGoogle(async () => {});
    await guard.writeGoogle(() => h.drive.deleteDriveFile('synthetic-token', 'file-a'));
    await h.drive.updateObservationFeedback('synthetic-token', h.teacher, { ...h.observation, rowNumber: 2 }, '', guard);
  }), (error) => h.drive.isSheetWriteUncertainError(error));
  assert.equal(h.lock().state, 'uncertain');
});

test('a stale active append is released only after verifying saved content and repairing its scoped receipt', async () => {
  const h = harness();
  await h.seedConfirmed();
  const result = await h.recover();
  assert.equal(result.outcome, 'applied');
  assert.equal(h.lock(), null);
  assert.deepEqual(h.repairedReceipt(), [h.observation.id, h.observation.requestId, h.teacher.id]);
  assert.equal(h.googleWrites(), 1, 'recovery must not re-append');
});

for (const overrides of [
  { created_at: new Date().toISOString() },
  { created_at: 'invalid' },
  { operation: 'update-feedback' },
  { teacher_id: 'class-b' },
  { intended_version: 'mismatched' },
]) {
  test(`active lock recovery stays closed for ${JSON.stringify(overrides)}`, async () => {
    const h = harness();
    await h.seedConfirmed(overrides);
    await assert.rejects(h.recover(), (error) => error.status === 409);
    assert.equal(h.lock().owner_token, 'original-owner');
    assert.equal(h.repairedReceipt(), null);
  });
}

test('age alone never releases an active append whose row is absent', async () => {
  const h = harness();
  await h.seedConfirmed();
  h.clearStored();
  await assert.rejects(h.recover(), (error) => error.status === 409);
  assert.equal(h.lock().owner_token, 'original-owner');
  assert.equal(h.repairedReceipt(), null);
});

test('receipt repair failure retains a confirmed append lock for another safe inspection', async () => {
  const h = harness({ receiptFailure: true });
  await h.seedConfirmed();
  await assert.rejects(h.recover(), /receipt repair/);
  assert.equal(h.lock().owner_token, 'original-owner');
});

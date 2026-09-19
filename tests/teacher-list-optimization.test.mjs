import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(relativePath, services) {
  const source = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(source, {
    exports, require: () => services, Request, Response, Headers, URL, URLSearchParams,
    crypto, TextEncoder, console: { error() {}, warn() {} },
  });
  return exports;
}

function listHarness({ migrationFailure = false } = {}) {
  const http = load('../lib/http.ts', {});
  let schemaVersion = 0;
  let ensureCalls = 0;
  let listCalls = 0;
  const teacher = () => ({
    id: 'class-a', accountId: 'account-a', spreadsheetId: 'sheet-a', sheetId: 0,
    sheetTitle: schemaVersion ? '실제 이름' : '예전 이름',
    summarySheetId: schemaVersion ? 99 : null,
    sheetSchemaVersion: schemaVersion,
  });
  const services = {
    ...http,
    getTeacherSession: async () => ({ teacherId: 'class-a' }),
    getTeacherById: async () => teacher(),
    getTeacherAccessToken: async () => 'token',
    SHEET_SCHEMA_VERSION: 2,
    ensureTeacherSummarySheet: async () => {
      ensureCalls += 1;
      if (migrationFailure) throw new http.HttpError(502, 'migration failed');
      schemaVersion = 2;
      return 99;
    },
    listObservationRows: async () => {
      listCalls += 1;
      return { items: [], total: 0, hasMore: false, nextCursor: null };
    },
    getHeartViewer: async () => ({ voterKey: 'viewer', cookie: null }),
    getHeartStates: async () => ({}),
    seedImageTickets: async () => {},
    decodeCursor: () => null,
    encodeCursor: () => 'cursor',
    observationVersion: async () => 'version',
  };
  const route = load('../app/api/admin/observations/route.ts', services);
  return {
    get: () => route.GET(new Request('https://test.invalid/api/admin/observations')),
    schemaVersion: () => schemaVersion,
    ensureCalls: () => ensureCalls,
    listCalls: () => listCalls,
  };
}

test('an old sheet schema migrates once before the first list read', async () => {
  const h = listHarness();
  assert.equal((await h.get()).status, 200);
  assert.equal(h.ensureCalls(), 1);
  assert.equal(h.listCalls(), 1);
  assert.equal(h.schemaVersion(), 2);
});

test('a failed sheet migration does not record the new version or read observations', async () => {
  const h = listHarness({ migrationFailure: true });
  assert.equal((await h.get()).status, 502);
  assert.equal(h.ensureCalls(), 1);
  assert.equal(h.listCalls(), 0);
  assert.equal(h.schemaVersion(), 0);
});

function spreadsheetHarness({ authenticated = true } = {}) {
  const http = load('../lib/http.ts', {});
  let ensureCalls = 0;
  let recoverCalls = 0;
  const teacher = { id: 'class-a', spreadsheetId: 'sheet-a', summarySheetId: 99 };
  const services = {
    ...http,
    getTeacherSession: async () => authenticated ? { teacherId: teacher.id } : null,
    getTeacherById: async () => teacher,
    getTeacherAccessToken: async () => 'token',
    recoverSheetWriteLock: async () => { recoverCalls += 1; return { recovered: false }; },
    ensureTeacherSummarySheet: async () => { ensureCalls += 1; return 99; },
    SHEET_SCHEMA_VERSION: 2,
  };
  const route = load('../app/api/admin/spreadsheet/route.ts', services);
  return {
    post: (origin = 'https://test.invalid') => route.POST(new Request('https://test.invalid/api/admin/spreadsheet', {
      method: 'POST', headers: { Origin: origin },
    })),
    ensureCalls: () => ensureCalls,
    recoverCalls: () => recoverCalls,
  };
}

test('manual sheet inspection requires teacher auth and same-origin POST', async () => {
  const denied = spreadsheetHarness({ authenticated: false });
  assert.equal((await denied.post()).status, 401);
  assert.equal(denied.ensureCalls(), 0);

  const crossOrigin = spreadsheetHarness();
  assert.equal((await crossOrigin.post('https://other.invalid')).status, 403);
  assert.equal(crossOrigin.ensureCalls(), 0);

  const allowed = spreadsheetHarness();
  const response = await allowed.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sheetSchemaVersion, 2);
  assert.equal(allowed.recoverCalls(), 1);
  assert.equal(allowed.ensureCalls(), 1);
});

test('saved cards merge by request version without reloading the list or image', () => {
  const page = readFileSync(new URL('../app/admin/page.tsx', import.meta.url), 'utf8');
  const applyStart = page.indexOf('function applyObservation');
  const applyEnd = page.indexOf('function checkSpreadsheet', applyStart);
  const applySource = page.slice(applyStart, applyEnd);
  assert.match(applySource, /entry\.version !== expectedVersion/);
  assert.doesNotMatch(applySource, /version\s*</);
  assert.doesNotMatch(applySource, /loadData|imageUrl\s*:/);
  assert.match(applySource, /return \{ \.\.\.entry, memo, teacherFeedback/);
});

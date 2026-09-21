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
    crypto, TextEncoder, console: { error() {}, warn() {} }, ...globals,
  });
  return exports;
}

const http = load('../lib/http.ts');
const teacher = { id: 'class-a', spreadsheetId: 'synthetic-sheet', sheetTitle: '관찰', sheetSchemaVersion: 2, summarySheetId: 99 };
const rows = Array.from({ length: 50 }, (_, index) => [
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`, `request-${index}`,
  '합성 학급', (index % 30) + 1, '합성 이름', '2026-09-20T20:00', '', `file-${index}`,
  'image/jpeg', 100, 'visible', new Date(Date.UTC(2026, 8, 20, 11, index)).toISOString(),
  '', '', '', '', '', '', '',
]);

function driveHarness({ indexUnavailable = false } = {}) {
  let reads = 0;
  const drive = load('../lib/google-drive.ts', {
    ...http,
    getEnv: () => ({ DB: { prepare() {
      return { bind() { return this; },
        async first() { if (indexUnavailable) throw new Error('index read unavailable'); return null; },
        async run() { if (indexUnavailable) throw new Error('index write unavailable'); return { success: true }; },
      };
    } } }),
  }, {
    fetch: async (url) => {
      reads += 1;
      const range = decodeURIComponent(new URL(url).pathname.split('/values/')[1] || '');
      if (range.endsWith('!A2:A')) return Response.json({ values: rows.map((row) => [row[0]]) });
      if (range.endsWith('!A2:S2001')) return Response.json({ values: rows });
      const match = /!A(\d+):S\d+$/.exec(range);
      assert.ok(match, 'unexpected Sheets request');
      return Response.json({ values: [rows[Number(match[1]) - 2]] });
    },
  });
  return { drive, reads: () => reads };
}

test('50 saved photos paginate beyond 20 with newest photos first and no duplicates', async () => {
  const { drive } = driveHarness();
  let cursor = null;
  const ids = [];
  do {
    const page = await drive.listObservationRows('synthetic-token', teacher, { limit: 12, cursor, includeHidden: false });
    assert.equal(page.total, 50);
    assert.ok(page.items.length <= 12);
    ids.push(...page.items.map((item) => item.id));
    assert.equal(page.hasMore, Boolean(page.nextCursor));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids[0], rows[49][0]);
  assert.equal(ids.length, 50);
  assert.equal(new Set(ids).size, 50);
  assert.deepEqual(ids, rows.toReversed().map((row) => row[0]));
});

for (const admin of [false, true]) {
  test(`${admin ? 'teacher' : 'student'} gallery remains readable when preview ticket writes fail`, async () => {
    const { drive } = driveHarness();
    const route = load(admin ? '../app/api/admin/observations/route.ts' : '../app/api/observations/route.ts', {
      ...http, ...drive,
      getTeacherSession: async () => admin ? { teacherId: teacher.id } : null,
      getStudentSession: async () => ({ teacherId: teacher.id }),
      getTeacherById: async () => teacher,
      getTeacherAccessToken: async () => 'synthetic-token',
      decodeCursor: () => null,
      encodeCursor: (_createdAt, id) => id,
      maskStudentName: () => '합*름',
      seedImageTickets: async () => { throw new Error('preview cache write quota'); },
      getHeartViewer: async () => ({ voterKey: 'synthetic-viewer', cookie: null }),
      getHeartStates: async () => ({}),
    });
    const response = await route.GET(new Request(`https://test.invalid/api/${admin ? 'admin/' : ''}observations`));
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.total, 50);
    assert.equal(page.items[0].id, rows[49][0]);
    assert.equal(page.hasMore, true);
    assert.match(response.headers.get('cache-control'), /no-store/);
    if (!admin) assert.equal(page.items[0].studentName, undefined);
  });
}

test('single photo lookup falls back to the scoped Sheet when index reads and repairs fail', async () => {
  const { drive, reads } = driveHarness({ indexUnavailable: true });
  const observation = await drive.findObservationRow('synthetic-token', teacher, rows[24][0]);
  assert.equal(observation.id, rows[24][0]);
  assert.equal(observation.rowNumber, 26);
  assert.equal(reads(), 2);
});

for (const status of ['visible', 'hidden', 'missing']) {
  test(`image cache failure preserves authorization for a ${status} observation`, async () => {
    let downloaded = false;
    const route = load('../app/api/images/[id]/route.ts', {
      ...http,
      getTeacherSession: async () => null,
      getStudentSession: async () => ({ teacherId: teacher.id }),
      getTeacherById: async () => teacher,
      getTeacherAccessToken: async () => 'synthetic-token',
      getImageTicket: async () => { throw new Error('cache unavailable'); },
      findObservationRow: async (_token, scopedTeacher, id) => {
        assert.equal(scopedTeacher.id, teacher.id);
        assert.equal(id, rows[24][0]);
        return status === 'missing' ? null : { id, imageFileId: 'file-24', imageType: 'image/jpeg', status };
      },
      seedImageTickets: async () => { throw new Error('cache write unavailable'); },
      downloadObservationImage: async () => { downloaded = true; return new Response('synthetic-image'); },
    });
    const response = await route.GET(new Request(`https://test.invalid/api/images/${rows[24][0]}`), {
      params: Promise.resolve({ id: rows[24][0] }),
    });
    assert.equal(response.status, status === 'visible' ? 200 : 404);
    assert.equal(downloaded, status === 'visible');
  });
}

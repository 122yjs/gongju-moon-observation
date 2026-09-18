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
    crypto, console: { error() {}, warn() {} }, ...globals,
  });
  return exports;
}

function harness({ authenticated = true, sheetFailure = false } = {}) {
  const http = load('../lib/http.ts');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const teacher = { id: 'class-a', spreadsheetId: 'sheet-a', sheetTitle: '관찰', sheetId: 0 };
  const row = [id, 'request', '가상 학급', 7, '합성 이름', '2026-09-18T20:00', '', 'photo', 'image/jpeg', 100, 'visible', '2026-09-18T11:00:00Z', '', '', '', '', ''];
  let stored = '';
  let writes = 0;
  const drive = load('../lib/google-drive.ts', http, {
    fetch: async (url, init = {}) => {
      const u = new URL(url);
      const range = decodeURIComponent(u.pathname.split('/values/')[1] || '');
      if (init.method === 'PUT') {
        if (sheetFailure) return Response.json({ error: { message: 'synthetic Sheets failure' } }, { status: 503 });
        const body = JSON.parse(init.body);
        if (range.endsWith('R2')) {
          assert.equal(u.searchParams.get('valueInputOption'), 'RAW', 'feedback must remain literal text in Sheets');
          stored = body.values[0][0];
          writes += 1;
        }
        return Response.json({});
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
  return {
    writes: () => writes,
    stored: () => stored,
    read: () => drive.findObservationRow('synthetic-token', teacher, id),
    patch: (payload, origin = 'https://test.invalid') => route.PATCH(new Request(`https://test.invalid/api/admin/observations/${id}`, {
      method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), { params: Promise.resolve({ id }) }),
  };
}

test('teacher feedback persists as literal text, replaces the single value, and can be cleared', async () => {
  const h = harness();
  assert.equal((await h.read()).teacherFeedback, '');
  for (const text of ['=HYPERLINK("https://invalid.example", "text")', '<img src=x onerror=alert(1)>\n다음 관찰도 기대해요', '']) {
    const response = await h.patch({ teacherFeedback: text });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).teacherFeedback, text);
    assert.equal((await h.read()).teacherFeedback, text);
  }
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
  assert.equal((await h.patch({ teacherFeedback: '저장 실패' })).status, 502);
  assert.equal(h.stored(), '');
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

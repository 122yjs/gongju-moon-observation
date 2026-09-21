import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual TypeScript route with isolated services, never production
// Drive, Sheets, D1, credentials, or a student's photo.
const route = ts.transpileModule(readFileSync(new URL('../app/api/observations/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function harness(overrides = {}) {
  const calls = [];
  const input = {
    requestId: 'test-request', studentNumber: 7, studentName: '합성 학생', observedAt: '2026-09-15T20:00', memo: '',
    photo: new File(['synthetic'], 'moon.jpg', { type: 'image/jpeg' }),
  };
  const services = {
    getStudentSession: async () => ({ teacherId: 'class-a', sid: 'test-session' }),
    getTeacherById: async () => ({ id: 'class-a', classLabel: '시험 반' }),
    assertSameOrigin() {}, HttpError,
    json: (body, init) => Response.json(body, init),
    errorResponse: (error) => Response.json({ message: error.message }, { status: error.status || 500 }),
    validateObservationForm: () => input,
    reserveSubmission: async () => ({ newlyReserved: true, status: 'processing' }),
    releaseSubmission: async (id) => { calls.push(['release', id]); },
    enforceSubmissionRateLimit: async () => { calls.push(['rate']); },
    detectImageType: () => ({ contentType: 'image/jpeg', extension: 'jpg' }),
    stripImageMetadata: (bytes) => bytes,
    getTeacherAccessToken: async () => 'synthetic-test-token',
    uploadObservationPhoto: async () => { calls.push(['upload']); return { id: 'test-file', webViewLink: 'test-link' }; },
    appendObservationRow: async () => { calls.push(['append']); },
    isSheetWriteUncertainError: (error) => error?.sheetWriteUncertain === true,
    deleteDriveFile: async (_token, id) => { calls.push(['delete', id]); },
    completeSubmission: async () => { calls.push(['complete']); },
    seedImageTickets: async () => { calls.push(['tickets']); },
    ...overrides,
  };
  const exports = {};
  runInNewContext(route, { exports, require: () => services, crypto, console: { warn() {}, error() {} }, Uint8Array, URL, Request, Response });
  const request = () => new Request('https://test.invalid/api/observations', { method: 'POST', body: new FormData() });
  return { post: () => exports.POST(request()), calls, services, input };
}

test('a duplicate processing request returns 409 without releasing another request reservation', async () => {
  const h = harness({ reserveSubmission: async () => ({ newlyReserved: false, status: 'processing' }) });
  assert.equal((await h.post()).status, 409);
  assert.deepEqual(h.calls, []);
});

test('cross-class and failed reservation attempts never release an unowned reservation', async () => {
  for (const error of [new HttpError(409, 'other class'), new Error('reservation unavailable')]) {
    const h = harness({ reserveSubmission: async () => { throw error; } });
    assert.equal((await h.post()).status, error.status || 500);
    assert.deepEqual(h.calls, []);
  }
});

test('a completed request returns the original receipt without another upload or rate charge', async () => {
  const h = harness({ reserveSubmission: async () => ({ newlyReserved: false, status: 'completed', observationId: 'original-id' }) });
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, 'original-id');
  assert.deepEqual(h.calls, []);
});

test('a rate rejection releases exactly the reservation acquired by this request', async () => {
  const h = harness({ enforceSubmissionRateLimit: async () => { throw new HttpError(429, 'quota'); } });
  assert.equal((await h.post()).status, 429);
  assert.deepEqual(h.calls, [['release', 'test-request']]);
});

test('a pre-upload failure releases the owned reservation for a safe manual retry', async () => {
  const h = harness({ getTeacherAccessToken: async () => { throw Error('token unavailable'); } });
  assert.equal((await h.post()).status, 500);
  assert.deepEqual(h.calls, [['rate'], ['release', 'test-request']]);
});

test('a failed preview ticket does not turn a saved Drive and Sheets submission into an error', async () => {
  const h = harness({ seedImageTickets: async () => { throw Error('optional ticket failed'); } });
  const response = await h.post();
  assert.equal(response.status, 201);
  assert.equal((await response.json()).ok, true);
  assert.deepEqual(h.calls, [['rate'], ['upload'], ['append'], ['complete']]);
});

test('a failed completion receipt does not delete an already saved photo', async () => {
  const h = harness({ completeSubmission: async () => { throw Error('receipt unavailable'); } });
  assert.equal((await h.post()).status, 201);
  assert.equal(h.calls.some(([name]) => name === 'delete' || name === 'release'), false);
});

test('a failed Sheets append retains the existing cleanup of the newly uploaded file', async () => {
  const h = harness({ appendObservationRow: async () => { throw Error('append failed'); } });
  assert.equal((await h.post()).status, 500);
  assert.deepEqual(h.calls, [['rate'], ['upload'], ['delete', 'test-file'], ['release', 'test-request']]);
});

test('a lock release failure after append never deletes an already saved photo', async () => {
  const uncertain = Object.assign(new Error('lock release failed'), { sheetWriteUncertain: true });
  const h = harness({ appendObservationRow: async () => { h.calls.push(['append']); throw uncertain; } });
  assert.equal((await h.post()).status, 500);
  assert.deepEqual(h.calls, [['rate'], ['upload'], ['append']]);
});

test('a new submission passes the available photo capture time into the teacher Sheet record', async () => {
  let savedObservation;
  const h = harness({
    appendObservationRow: async (_token, _teacher, observation) => {
      savedObservation = observation;
      h.calls.push(['append']);
    },
  });
  h.input.photoCapturedAt = '2026-09-15T19:42';
  assert.equal((await h.post()).status, 201);
  assert.equal(savedObservation?.photoCapturedAt, '2026-09-15T19:42');
});

test('a concurrent duplicate cannot remove the first request lock while its Drive upload is pending', async () => {
  let reserved = false;
  let finishUpload;
  const h = harness({
    reserveSubmission: async () => {
      const newlyReserved = !reserved;
      reserved = true;
      return { newlyReserved, status: 'processing' };
    },
    releaseSubmission: async () => { reserved = false; },
    uploadObservationPhoto: () => new Promise((resolve) => { finishUpload = resolve; }),
  });
  const first = h.post();
  await new Promise(setImmediate);
  assert.equal((await h.post()).status, 409);
  assert.equal(reserved, true);
  finishUpload({ id: 'test-file', webViewLink: 'test-link' });
  assert.equal((await first).status, 201);
});

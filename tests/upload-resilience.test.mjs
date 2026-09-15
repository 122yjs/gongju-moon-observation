import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const script = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
function page(fetch) {
  const elements = new Map();
  const stored = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let resetCount = 0;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', textContent: '', disabled: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      removeAttribute(name) { delete this[name]; },
      reset() { resetCount += 1; },
    });
    return elements.get(id);
  };
  const context = {
    Blob, FormData, crypto, AbortController, TypeError, console,
    document: { addEventListener() {}, getElementById: element },
    URL: { createObjectURL: () => 'blob:photo', revokeObjectURL() {} },
    sessionStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch,
  };
  runInNewContext(script + `
    draftScope = 'test-class'; hasClassSession = true;
    globalThis.api = { submitObservation, attachPhoto, state: () => ({ pendingRequestId, compressedImageBlob, submissionBusy }) };
  `, context);
  element('studentNumber').value = '7';
  element('studentName').value = '테스트 학생';
  element('observedAt').value = '2026-09-15T20:00';
  element('memo').value = '달 관찰';
  context.api.attachPhoto(new Blob(['test-only-photo'], { type: 'image/jpeg' }));
  return { context, element, stored, timers, resetCount: () => resetCount,
    submit: () => context.api.submitObservation({ preventDefault() {} }),
    timeout() { for (const [id, timer] of timers) if (timer.ms === 90000) { timers.delete(id); timer.fn(); } },
  };
}

test('an upload timeout unlocks the form, aborts the request, and keeps the same photo and request ID', async () => {
  const attempts = [];
  const p = page(async (_url, options) => { attempts.push(options); return new Promise(() => {}); });
  const first = p.submit();
  await new Promise(setImmediate);
  const id = p.context.api.state().pendingRequestId;
  p.timeout();
  await first;
  assert.equal(attempts[0].signal.aborted, true);
  assert.equal(p.context.api.state().submissionBusy, false);
  assert.equal(p.element('submitButton').disabled, false);
  assert.ok(p.context.api.state().compressedImageBlob);
  assert.equal(p.context.api.state().pendingRequestId, id);
  assert.equal(p.resetCount(), 0);
  assert.ok(p.stored.has('moon-observation-draft-v1'));
  assert.match(p.element('submitStatus').textContent, /전송 결과를 확인하지 못했어요/);
  p.context.fetch = async (_url, options) => {
    attempts.push(options);
    return { ok: true, status: 200, json: async () => ({ ok: true, id: 'saved-id' }) };
  };
  await p.submit();
  assert.equal(attempts[0].body.get('requestId'), attempts[1].body.get('requestId'));
  assert.equal(p.resetCount(), 1);
  assert.equal(p.context.api.state().compressedImageBlob, null);
  assert.equal(p.stored.has('moon-observation-draft-v1'), false);
});

test('a response body that never finishes is covered by the same upload deadline', async () => {
  const p = page(async () => ({ ok: true, status: 201, json: () => new Promise(() => {}) }));
  const pending = p.submit();
  await new Promise(setImmediate);
  p.timeout();
  await pending;
  assert.equal(p.resetCount(), 0);
  assert.equal(p.context.api.state().submissionBusy, false);
  assert.ok(p.context.api.state().compressedImageBlob);
});

test('HTTP 200 HTML or an invalid receipt cannot clear a student submission', async () => {
  for (const json of [async () => { throw Error('HTML, not JSON'); }, async () => ({}), async () => ({ ok: true }), async () => ({ ok: false, id: 'not-saved' })]) {
    const p = page(async () => ({ ok: true, status: 200, json }));
    await p.submit();
    assert.equal(p.resetCount(), 0);
    assert.ok(p.context.api.state().compressedImageBlob);
    assert.match(p.element('submitStatus').textContent, /제출 확인/);
  }
});

test('network, pending-conflict, and quota failures retain the photo without automatic retries', async () => {
  for (const status of [0, 409, 429, 500]) {
    let calls = 0;
    const p = page(async () => {
      calls += 1;
      if (!status) throw new TypeError('network failed');
      return { ok: false, status, json: async () => ({ message: `test-${status}` }) };
    });
    await p.submit();
    assert.equal(calls, 1);
    assert.equal(p.resetCount(), 0);
    assert.ok(p.context.api.state().compressedImageBlob);
    assert.ok(p.context.api.state().pendingRequestId);
    assert.equal(p.element('submitButton').disabled, false);
  }
});

test('a late success after the deadline cannot reset a new or retained form', async () => {
  let finish;
  const p = page(() => new Promise((resolve) => { finish = resolve; }));
  const pending = p.submit();
  await new Promise(setImmediate);
  p.timeout();
  await pending;
  finish({ ok: true, status: 201, json: async () => ({ ok: true, id: 'late' }) });
  await new Promise(setImmediate);
  assert.equal(p.resetCount(), 0);
  assert.ok(p.context.api.state().compressedImageBlob);
});

test('double submission creates only one in-flight network request', async () => {
  let calls = 0;
  let finish;
  const p = page(() => { calls += 1; return new Promise((resolve) => { finish = resolve; }); });
  const first = p.submit();
  await p.submit();
  assert.equal(calls, 1);
  finish({ ok: true, status: 201, json: async () => ({ ok: true, id: 'saved' }) });
  await first;
  assert.equal(p.resetCount(), 1);
});

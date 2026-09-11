import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const fields = ['studentNumber', 'studentName', 'observedAt', 'memo'];
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
async function page(saved, scope = 'class-a') {
  const elements = new Map();
  const events = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, value: '', textContent: '', className: '', dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener: (name, fn) => events.set(`${id}:${name}`, fn),
      setAttribute() {}, removeAttribute(name) { delete this[name]; },
    });
    return elements.get(id);
  };
  const context = {
    Blob, FormData, crypto,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    sessionStorage: saved, console, setTimeout: () => 0, clearTimeout() {},
    document: { addEventListener: (name, fn) => events.set(name, fn),
      getElementById: element, querySelectorAll: () => [] },
    window: { addEventListener: (name, fn) => events.set(name, fn), scrollTo() {} },
    fetch: async () => ({ ok: true, json: async () => ({ authenticated: true, draftScope: scope }) }),
  };
  element('observationForm').reset = () => fields.forEach((id) => { element(id).value = ''; });
  runInNewContext(script + `
    renderToday = () => {}; renderCalendar = () => {};
    globalThis.api = {
      checkSession, submitObservation, attachPhoto, prepareExternalCamera, previewPhoto,
    };
  `, context);
  events.get('DOMContentLoaded')();
  await new Promise((resolve) => setImmediate(resolve));
  return { element, events, context };
}

test('typed fields survive page recreation after opening the photo picker', async () => {
  const saved = storage();
  const first = await page(saved);
  const values = ['7', '김학생', '2026-09-08T20:15', '서쪽 하늘의 달'];
  fields.forEach((id, index) => { first.element(id).value = values[index]; });
  first.events.get('observationForm:input')?.({ target: first.element('memo') });
  // A killed renderer cannot run pagehide, so persistence must happen on input.
  const restored = await page(saved);
  assert.deepEqual(fields.map((id) => restored.element(id).value), values);
});

test('drafts do not cross classroom boundaries and expire after 24 hours', async () => {
  const saved = storage();
  const first = await page(saved);
  first.element('studentName').value = '김학생';
  first.events.get('observationForm:input')?.({ target: first.element('studentName') });
  assert.equal((await page(saved, 'class-b')).element('studentName').value, '');
  const originalNow = Date.now;
  // Change the stored timestamp without depending on the browser clock implementation.
  const key = 'moon-observation-draft-v1';
  const draft = JSON.parse(saved.getItem(key));
  assert.ok(draft, 'an input draft should be stored');
  draft.savedAt = originalNow() - 25 * 60 * 60 * 1000;
  saved.setItem(key, JSON.stringify(draft));
  assert.equal((await page(saved)).element('studentName').value, '');
});

test('corrupt or unavailable tab storage does not break session initialization', async () => {
  const saved = storage();
  saved.setItem('moon-observation-draft-v1', '{broken');
  assert.equal((await page(saved)).element('studentName').value, '');
  const unavailable = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }, removeItem() {} };
  const first = await page(unavailable);
  assert.equal(first.element('submitClassLabel').textContent, '우리 반');
  assert.doesNotThrow(() => first.events.get('observationForm:input')?.({ target: first.element('memo') }));
});

test('successful submission clears the draft without resurrecting it on pagehide', async () => {
  const saved = storage();
  const first = await page(saved);
  first.element('studentName').value = '김학생';
  first.events.get('observationForm:input')({ target: first.element('studentName') });
  first.context.api.attachPhoto(new Blob(['photo'], { type: 'image/jpeg' }));
  first.context.fetch = async () => ({ ok: true, status: 201, json: async () => ({ ok: true }) });
  await first.context.api.submitObservation({ preventDefault() {} });
  first.events.get('pagehide')();
  assert.equal(saved.getItem('moon-observation-draft-v1'), null);
  assert.equal((await page(saved)).element('studentName').value, '');
});

test('failed submission retains the draft for a reload and retry', async () => {
  const saved = storage();
  const first = await page(saved);
  first.element('studentName').value = '김학생';
  first.events.get('observationForm:input')({ target: first.element('studentName') });
  first.context.api.attachPhoto(new Blob(['photo'], { type: 'image/jpeg' }));
  first.context.fetch = async () => { throw Error('offline'); };
  await first.context.api.submitObservation({ preventDefault() {} });
  assert.equal((await page(saved)).element('studentName').value, '김학생');
});

test('external camera preparation force-saves fields and records pending state', async () => {
  const saved = storage();
  const first = await page(saved);
  const values = ['7', '김학생', '2026-09-09T20:15', '남쪽 하늘'];
  fields.forEach((id, index) => { first.element(id).value = values[index]; });
  first.context.api.attachPhoto(new Blob(['old photo'], { type: 'image/jpeg' }));

  first.context.api.prepareExternalCamera();

  const draft = JSON.parse(saved.getItem('moon-observation-draft-v1'));
  assert.deepEqual(fields.map((id) => draft.fields[id]), values);
  const pending = JSON.parse(saved.getItem('moon-camera-pending-v1'));
  assert.equal(pending.scope, 'class-a');
  assert.equal(typeof pending.startedAt, 'number');
  assert.equal(typeof pending.pageId, 'string');
  assert.equal(first.element('photoPreview').src, undefined);
});

test('a recreated document restores fields and shows a one-time retake notice', async () => {
  const saved = storage();
  const first = await page(saved);
  const values = ['5', '복원 학생', '2026-09-09T20:30', '카메라 전환 직전'];
  fields.forEach((id, index) => { first.element(id).value = values[index]; });
  first.context.api.prepareExternalCamera();

  const recreated = await page(saved);

  assert.deepEqual(fields.map((id) => recreated.element(id).value), values);
  assert.match(recreated.element('photoStatus').textContent, /다시 시작|다시 눌러/);
  assert.equal(saved.getItem('moon-camera-pending-v1'), null);
});

test('same-document return and camera cancellation clear pending state without recreation notice', async () => {
  const saved = storage();
  const first = await page(saved);
  first.context.api.prepareExternalCamera();
  await first.context.api.checkSession();
  assert.doesNotMatch(first.element('photoStatus').textContent, /다시 시작/);

  first.events.get('captureInput:cancel')();
  assert.equal(saved.getItem('moon-camera-pending-v1'), null);

  first.context.api.prepareExternalCamera();
  await first.context.api.previewPhoto({ target: { files: [], value: 'cancelled' } }, 'capture');
  assert.equal(saved.getItem('moon-camera-pending-v1'), null);
});

test('invalid, expired, and cross-class pending markers are removed without recovery', async () => {
  const cases = [
    { value: '{broken', scope: 'class-a' },
    { value: JSON.stringify({ scope: 'class-a', startedAt: Date.now() - 31 * 60 * 1000, pageId: 'old' }), scope: 'class-a' },
    { value: JSON.stringify({ scope: 'class-a', startedAt: Date.now(), pageId: 'old' }), scope: 'class-b' },
  ];

  for (const item of cases) {
    const saved = storage({ 'moon-camera-pending-v1': item.value });
    const current = await page(saved, item.scope);
    assert.equal(saved.getItem('moon-camera-pending-v1'), null);
    assert.doesNotMatch(current.element('photoStatus').textContent, /다시 시작/);
  }
});

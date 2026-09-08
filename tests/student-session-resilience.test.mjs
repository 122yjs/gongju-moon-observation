import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function page(fetch, sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} }) {
  const elements = new Map();
  const listeners = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', textContent: '', className: '', disabled: false, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, setAttribute() {}, removeAttribute() {},
    });
    return elements.get(id);
  };
  const context = {
    console, fetch, sessionStorage,
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
    document: {
      visibilityState: 'hidden',
      addEventListener: (name, fn) => listeners.set(name, fn),
      getElementById: getElement,
      querySelectorAll: () => [],
    },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), scrollTo() {} },
  };
  runInNewContext(`${script}
    renderToday = () => {}; renderCalendar = () => {};
    globalThis.api = { checkSession, initObservationDraft, sessionState: () => hasClassSession };
  `, context);
  context.api.initObservationDraft();
  return { context, getElement, listeners, api: context.api };
}

const response = (authenticated) => ({ ok: true, json: async () => authenticated
  ? { authenticated: true, draftScope: 'class-a', classLabel: '테스트 반' }
  : { authenticated: false } });

test('camera-backgrounded session check failure waits and retries when the page is visible', async () => {
  let calls = 0;
  const p = page(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('Failed to fetch');
    return response(true);
  });
  await p.api.checkSession();
  assert.equal(p.api.sessionState(), false);
  assert.doesNotMatch(p.getElement('sessionBanner').textContent, /QR로 입장/);
  assert.match(p.getElement('sessionBanner').textContent, /다시 확인/);
  p.context.document.visibilityState = 'visible';
  p.listeners.get('visibilitychange')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(p.api.sessionState(), true);
  assert.match(p.getElement('sessionBanner').textContent, /수업 참여가 확인/);
});

test('a transient check failure cannot revoke an already confirmed class session', async () => {
  let fail = false;
  const p = page(async () => fail ? Promise.reject(new TypeError('camera suspended request')) : response(true));
  await p.api.checkSession();
  fail = true;
  await p.api.checkSession();
  assert.equal(p.api.sessionState(), true);
  assert.match(p.getElement('sessionBanner').textContent, /수업 참여가 확인/);
  assert.doesNotMatch(p.getElement('sessionBanner').textContent, /QR로 입장/);
});

test('an explicit authenticated false response still requires the class QR', async () => {
  const p = page(async () => response(false));
  await p.api.checkSession();
  assert.equal(p.api.sessionState(), false);
  assert.match(p.getElement('sessionBanner').textContent, /QR로 입장/);
});

test('a short-lived tab resume token restores a cookie lost during system-camera recreation', async () => {
  const resumeToken = 'signed-resume-token-0000000000000000';
  const refreshedToken = 'refreshed-resume-token-000000000000';
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const entered = page(async () => ({
    ok: true,
    json: async () => ({ authenticated: true, draftScope: 'class-a', classLabel: '테스트 반', resumeToken }),
  }), storage);
  await entered.api.checkSession();
  assert.equal(storage.getItem('moon-class-resume-v1'), resumeToken);

  const requests = [];
  const recreated = page(async (url, options = {}) => {
    requests.push({ url, options });
    if (!options.method) return response(false);
    return {
      ok: true,
      json: async () => ({ authenticated: true, draftScope: 'class-a', classLabel: '테스트 반', resumeToken: refreshedToken }),
    };
  }, storage);
  await recreated.api.checkSession();
  assert.equal(recreated.api.sessionState(), true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/api/session');
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), { resumeToken });
  assert.equal(storage.getItem('moon-class-resume-v1'), refreshedToken);
});

test('an invalid resume token is removed and falls back to QR entry', async () => {
  const values = new Map([['moon-class-resume-v1', 'expired-resume']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const p = page(async (_url, options = {}) => options.method
    ? { ok: false, status: 401, json: async () => ({ message: 'expired' }) }
    : response(false), storage);
  await p.api.checkSession();
  assert.equal(p.api.sessionState(), false);
  assert.equal(storage.getItem('moon-class-resume-v1'), null);
  assert.match(p.getElement('sessionBanner').textContent, /QR로 입장/);
});

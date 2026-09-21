import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function harness() {
  let finish;
  let fail;
  let calls = 0;
  const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const source = ts.transpileModule(readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(source, {
    exports, URL, Request, Response, Headers,
    require: () => ({ default: { fetch: () => { calls += 1; return pending; } } }),
  });
  const protectedWork = [];
  const ctx = { waitUntil: (promise) => protectedWork.push(promise) };
  return { finish, fail, protectedWork, calls: () => calls,
    fetch: (method) => exports.default.fetch(new Request('https://test.invalid/api/observations', { method }), {}, ctx),
  };
}

for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
  test(`${method} protects the same awaited mutation rather than returning early or issuing a duplicate`, async () => {
    const h = harness();
    let settled = false;
    const result = h.fetch(method).then((response) => { settled = true; return response; });
    await new Promise(setImmediate);
    assert.equal(h.protectedWork.length, 1);
    assert.equal(h.calls(), 1);
    assert.equal(settled, false);
    h.finish(Response.json({ ok: true }, { status: 201 }));
    assert.equal((await result).status, 201);
    await Promise.all(h.protectedWork);
  });
}

test('read-only requests do not register extra protected work', async () => {
  const h = harness();
  const result = h.fetch('GET');
  h.finish(Response.json({ items: [] }));
  assert.equal((await result).status, 200);
  assert.equal(h.protectedWork.length, 0);
});

test('a rejected mutation is still rejected to the caller', async () => {
  const h = harness();
  const result = h.fetch('POST');
  const rejected = assert.rejects(result, /synthetic failure/);
  h.fail(new Error('synthetic failure'));
  await rejected;
  await Promise.all(h.protectedWork);
});

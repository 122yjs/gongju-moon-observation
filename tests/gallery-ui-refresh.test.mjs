import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function functionSource(source, fileName, names, scriptKind) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  return file.statements
    .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
    .map((node) => node.getText(file))
    .join("\n");
}

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    toggle(name, force) {
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    },
    contains(name) { return values.has(name); },
  };
}

function studentGalleryHarness(responses) {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((value) => value.includes("function loadGalleryPage"));
  assert.ok(script, "student gallery script should exist");

  const source = functionSource(
    script,
    "student-gallery.js",
    new Set(["showView", "refreshGallery", "loadGalleryPage"]),
    ts.ScriptKind.JS,
  );
  const elements = new Map();
  let renderedItems = Array.from({ length: 26 }, (_, index) => ({ id: `old-${index}` }));
  let fetchCalls = 0;
  const requests = [];
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        classList: createClassList(id === "loadMoreButton" ? [] : ["hidden"]),
        textContent: id === "galleryCount" ? "(26개)" : "",
        disabled: false,
        replaceChildren() {
          if (id === "photoGallery") renderedItems = [];
        },
      });
    }
    return elements.get(id);
  };
  const context = {
    AbortController,
    URLSearchParams,
    document: {
      getElementById: getElement,
      querySelectorAll: () => [],
    },
    window: { scrollTo() {} },
    stopCamera() {},
    closeCompass() {},
    showToast() {},
    renderCalendar() {},
    renderSubmitObservationSupport() {},
    maybeShowLateNightDialog() {},
    renderGalleryItems(items) { renderedItems.push(...items); },
    checkSession: async () => {},
    fetch: async (url) => {
      fetchCalls += 1;
      requests.push(url);
      const response = responses.shift();
      assert.ok(response, "unexpected gallery request");
      return response;
    },
  };
  runInNewContext(
    `"use strict";
     let hasClassSession = true;
     let galleryLoaded = true;
     let galleryCursor = "old-cursor";
     let galleryRequestController = null;
     let galleryObservedDate = "";
     let galleryStudentNumber = "";
     let galleryActiveObservedDate = "";
     let galleryActiveStudentNumber = "";
     const PAGE_SIZE = 12;
     ${source}
     globalThis.galleryApi = { showView, refreshGallery, loadGalleryPage };`,
    context,
  );
  return {
    api: context.galleryApi,
    fetchCalls: () => fetchCalls,
    requests: () => requests,
    count: () => getElement("galleryCount").textContent,
    renderedCount: () => renderedItems.length,
    moreButton: () => getElement("loadMoreButton"),
  };
}

function response({ ok = true, status = 200, body }) {
  return { ok, status, async json() { return body; } };
}

test("reopening the student gallery refreshes the first page", async () => {
  const harness = studentGalleryHarness([
    response({ body: { items: [{ id: "new" }], total: 27, hasMore: true, nextCursor: "new-cursor" } }),
  ]);

  harness.api.showView("gallery");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.fetchCalls(), 1);
  assert.deepEqual(harness.requests(), ["/api/observations?limit=12"]);
  assert.equal(harness.count(), "(27개)");
  assert.equal(harness.renderedCount(), 1);
});

test("a failed student refresh keeps the visible gallery and retry controls", async () => {
  const harness = studentGalleryHarness([
    response({ ok: false, status: 503, body: { message: "합성 조회 실패" } }),
  ]);

  await harness.api.refreshGallery();

  assert.equal(harness.count(), "(26개)");
  assert.equal(harness.renderedCount(), 26);
  assert.equal(harness.moreButton().classList.contains("hidden"), false);
  assert.equal(harness.moreButton().disabled, false);
});

test("학생 갤러리는 늦게 도착한 이전 응답을 무시합니다", async () => {
  let finishOldResponse;
  const oldResponse = {
    ok: true, status: 200,
    json: () => new Promise((resolve) => { finishOldResponse = resolve; }),
  };
  const harness = studentGalleryHarness([
    oldResponse,
    response({ body: { items: [{ id: "new" }], total: 27, hasMore: true, nextCursor: "new-cursor" } }),
  ]);
  const oldRequest = harness.api.refreshGallery();
  await new Promise((resolve) => setImmediate(resolve));
  await harness.api.refreshGallery();
  finishOldResponse({ items: [{ id: "old" }], total: 26, hasMore: false, nextCursor: null });
  await oldRequest;
  assert.equal(harness.count(), "(27개)");
  assert.equal(harness.moreButton().classList.contains("hidden"), false);
});

test("학생 갤러리는 더 보기 실패 후 같은 위치에서 재시도합니다", async () => {
  const harness = studentGalleryHarness([
    response({ ok: false, status: 503, body: { message: "합성 조회 실패" } }),
    response({ body: { items: [{ id: "new" }], total: 27, hasMore: false, nextCursor: null } }),
  ]);
  await harness.api.loadGalleryPage(false);
  assert.equal(harness.renderedCount(), 26);
  assert.equal(harness.moreButton().classList.contains("hidden"), false);
  await harness.api.loadGalleryPage(false);
  assert.equal(harness.renderedCount(), 27);
  assert.deepEqual(harness.requests(), [
    "/api/observations?limit=12&cursor=old-cursor",
    "/api/observations?limit=12&cursor=old-cursor",
  ]);
});

function adminLoadDataSource() {
  const source = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("admin-page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "loadData") {
      initializer = node.initializer?.arguments?.[0]?.getText(file) || null;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(initializer, "admin loadData callback should exist");
  return ts.transpileModule(`globalThis.loadData = ${initializer}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function adminHarness(fetch) {
  const state = { items: Array.from({ length: 26 }, (_, id) => ({ id })), message: "", loading: false };
  const context = { fetch, loadRequestId: { current: 0 } };
  for (const name of [
    "Loading", "Authenticated", "Items", "Cursor", "HasMore", "Invite", "ClassLabel", "RegionLabel",
    "RegionShortLabel", "ObservationLat", "ObservationLon", "GeocodeItems", "RegionSearchStatus", "QrClassId", "Message",
  ]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = (value) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    };
  }
  runInNewContext(adminLoadDataSource(), context);
  return { loadData: context.loadData, state };
}

test("the admin page applies a successful record list even when invite metadata fails", async () => {
  const harness = adminHarness(async (url) => url.startsWith("/api/admin/observations")
    ? response({ body: { items: Array.from({ length: 27 }, (_, id) => ({ id })), total: 27, hasMore: false, nextCursor: null } })
    : Promise.reject(new Error("합성 수업 링크 오류")));

  await harness.loadData();

  assert.equal(harness.state.items.length, 27);
  assert.equal(harness.state.message, "수업 링크를 불러오지 못했습니다.");
});

test("an older admin request cannot overwrite a newer record list", async () => {
  const pending = [];
  const harness = adminHarness((url) => new Promise((resolve) => pending.push({ url, resolve })));
  const oldRequest = harness.loadData();
  const newRequest = harness.loadData();
  assert.equal(pending.length, 4);

  pending[2].resolve(response({ body: { items: [{ id: "new" }], total: 1, hasMore: false, nextCursor: null } }));
  pending[3].resolve(response({ body: { classes: [], activeClassId: null, classLabel: "새 반", regionLabel: "공주", regionShortLabel: "공주", observationLat: 36.5, observationLon: 127.5 } }));
  await newRequest;
  pending[0].resolve(response({ body: { items: [{ id: "old" }], total: 1, hasMore: false, nextCursor: null } }));
  pending[1].resolve(response({ body: { classes: [], activeClassId: null, classLabel: "이전 반", regionLabel: "공주", regionShortLabel: "공주", observationLat: 36.5, observationLon: 127.5 } }));
  await oldRequest;

  assert.equal(harness.state.items[0].id, "new");
});

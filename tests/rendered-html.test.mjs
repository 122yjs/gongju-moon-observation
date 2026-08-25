import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

function createClassList() {
  const values = new Set();
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, force) {
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    },
  };
}

function createElement(properties = {}) {
  return {
    classList: createClassList(),
    className: "",
    textContent: "",
    value: "",
    disabled: false,
    removeAttribute(name) {
      delete this[name];
    },
    ...properties,
  };
}

test("builds the moon observation app without external runtime CSS", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../dist/client/app.css", import.meta.url), "utf8");
  assert.match(html, /<title>공주 달 관찰 탐험대<\/title>/);
  assert.match(html, /href="\/app\.css"/);
  assert.ok(css.length > 20_000, "compiled Tailwind CSS should be present");
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|fonts\.googleapis\.com|google\.script\.run/);
});

test("requests only the non-sensitive drive.file OAuth scope", async () => {
  const google = await readFile(new URL("../lib/google-drive.ts", import.meta.url), "utf8");
  assert.match(google, /DRIVE_FILE_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/drive\.file"/);
  assert.match(google, /url\.searchParams\.set\("scope", DRIVE_FILE_SCOPE\)/);
  assert.doesNotMatch(google, /auth\/drive["']/);
  assert.doesNotMatch(google, /auth\/spreadsheets["']|openid|auth\/userinfo|gmail/);
});

test("stores new student submissions only in teacher Drive and Sheets", async () => {
  const route = await readFile(new URL("../app/api/observations/route.ts", import.meta.url), "utf8");
  const drive = await readFile(new URL("../lib/google-drive.ts", import.meta.url), "utf8");
  assert.match(route, /uploadObservationPhoto\(/);
  assert.match(route, /appendObservationRow\(/);
  assert.match(drive, /www\.googleapis\.com\/upload\/drive\/v3/);
  assert.match(drive, /sheets\.googleapis\.com\/v4/);
  assert.doesNotMatch(route, /BUCKET\.put|INSERT INTO observations|db\.add\(/);
});

test("keeps student PII out of long-lived central D1 tables", async () => {
  const migration = await readFile(new URL("../drizzle/0001_drive_oauth.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE `teacher_connections`/);
  assert.match(migration, /CREATE TABLE `submission_receipts`/);
  assert.match(migration, /CREATE TABLE `image_tickets`/);
  assert.doesNotMatch(migration, /student_name|student_number|observed_at|\bmemo\b|image_bytes/);
});

test("uses the Android system photo chooser for camera and gallery", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<input[^>]*id="photoInput"[^>]*type="file"[^>]*>/);
  assert.match(html, /<input[^>]*id="photoInput"[^>]*accept="image\/\*"[^>]*>/);
  assert.match(html, /<input[^>]*id="photoInput"[^>]*onchange="previewPhoto\(event\)"[^>]*>/);
  assert.doesNotMatch(html, /<input[^>]*id="photoInput"[^>]*capture=/);
  assert.doesNotMatch(html, /id="photoInput(?:Camera|Gallery)"/);
});

test("keeps a MIME-less Android camera JPEG attached through submission", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "student page script should exist");

  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  getElement("studentNumber").value = "7";
  getElement("studentName").value = "홍길동";
  getElement("observedAt").value = "2026-08-26T20:30";
  getElement("memo").value = "안드로이드 카메라 촬영";
  getElement("observationForm").reset = () => {};
  const requests = [];
  const context = {
    Blob,
    File,
    FormData,
    URL: {
      createObjectURL: () => "blob:test",
      revokeObjectURL() {},
    },
    clearTimeout() {},
    crypto,
    document: {
      addEventListener() {},
      getElementById: getElement,
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 201,
        async json() {
          return { ok: true, message: "제출 완료" };
        },
      };
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
  };

  runInNewContext(
    `${script}
compressImage = async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
globalThis.__photoFlow = { previewPhoto, submitObservation };`,
    context,
  );

  const cameraInput = createElement({
    files: [new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "camera.jpg", { type: "" })],
    value: "camera.jpg",
  });
  await context.__photoFlow.previewPhoto({ target: cameraInput });
  await context.__photoFlow.submitObservation({ preventDefault() {} });

  assert.equal(requests.length, 1, "camera photo should reach the observation API");
  assert.equal(requests[0].url, "/api/observations");
  assert.equal(requests[0].options.credentials, "same-origin");
  const photo = requests[0].options.body.get("photo");
  assert.ok(photo instanceof File, "multipart photo should be a File");
  assert.ok(photo.size > 0, "multipart photo should retain image bytes");
});

test("protects OAuth and class sessions and keeps the student session for 60 days", async () => {
  const auth = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
  const start = await readFile(new URL("../app/api/google/start/route.ts", import.meta.url), "utf8");
  const callback = await readFile(new URL("../app/api/google/callback/route.ts", import.meta.url), "utf8");
  assert.match(auth, /STUDENT_SESSION_MAX_AGE = 60 \* 24 \* 60 \* 60/);
  assert.match(auth, /HttpOnly; Secure; SameSite=/);
  assert.match(start, /createOAuthStateCookie/);
  assert.match(callback, /safeSecretEqual\(expectedState, state\)/);
});

test("supports operator-controlled deletion of legacy D1 and R2 student data", async () => {
  const legacy = await readFile(new URL("../lib/legacy.ts", import.meta.url), "utf8");
  const operator = await readFile(new URL("../app/api/operator/legacy-data/route.ts", import.meta.url), "utf8");
  assert.match(legacy, /DELETE FROM observations/);
  assert.match(legacy, /BUCKET\.delete/);
  assert.match(operator, /getOperatorSession/);
  assert.match(operator, /assertSameOrigin/);
});

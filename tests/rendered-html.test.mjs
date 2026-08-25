import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("exposes separate camera and gallery photo inputs for students", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<input[^>]*id="photoInputCamera"[^>]*>/);
  assert.match(html, /<input[^>]*id="photoInputGallery"[^>]*>/);
  assert.match(html, /<input[^>]*id="photoInputCamera"[^>]*capture="environment"[^>]*>/);
  assert.doesNotMatch(html, /<input[^>]*id="photoInputGallery"[^>]*capture=/);
  assert.match(html, /<input[^>]*id="photoInputCamera"[^>]*onchange="previewPhoto\(event\)"[^>]*>/);
  assert.match(html, /<input[^>]*id="photoInputGallery"[^>]*onchange="previewPhoto\(event\)"[^>]*>/);
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

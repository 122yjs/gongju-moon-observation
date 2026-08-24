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

test("keeps restricted routes behind server-side session checks", async () => {
  const observations = await readFile(new URL("../app/api/observations/route.ts", import.meta.url), "utf8");
  const images = await readFile(new URL("../app/api/images/[id]/route.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(observations, /getStudentSession\(request\)/);
  assert.match(observations, /throw new HttpError\(401/);
  assert.match(images, /getViewerSession|getAdminSession/);
  assert.match(images, /status !== "visible"/);
  assert.match(worker, /X-Robots-Tag/);
  assert.match(worker, /Referrer-Policy/);
  assert.match(worker, /Content-Security-Policy/);
});

test("uses Blob multipart upload and lazy gallery loading", async () => {
  const source = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /canvas\.toBlob\(/);
  assert.match(source, /new FormData\(\)/);
  assert.match(source, /formData\.append\('photo', compressedImageBlob/);
  assert.match(source, /imageUrl/);
  assert.doesNotMatch(source, /toDataURL\(|imageData|google\.script\.run/);
  assert.doesNotMatch(source, /renderCalendar\(\);\s*refreshGallery\(\);/);
});

test("keeps student QR sessions available for the full observation period", async () => {
  const auth = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
  const admin = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(auth, /STUDENT_SESSION_MAX_AGE = 60 \* 24 \* 60 \* 60/);
  assert.match(admin, /60일 동안 제출과 갤러리를 이용/);
});

test("ships D1 and R2 bindings with a migration", async () => {
  const hosting = JSON.parse(await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
  const migration = await readFile(new URL("../drizzle/0000_glossy_nomad.sql", import.meta.url), "utf8");
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "BUCKET");
  assert.match(migration, /CREATE TABLE `observations`/);
  assert.match(migration, /UNIQUE INDEX `observations_request_id_unique`/);
});

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
    contains(name) {
      return values.has(name);
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
  const migration = [
    await readFile(new URL("../drizzle/0001_drive_oauth.sql", import.meta.url), "utf8"),
    await readFile(new URL("../drizzle/0002_teacher_accounts_classes.sql", import.meta.url), "utf8"),
  ].join("\n");
  assert.match(migration, /CREATE TABLE `teacher_connections`/);
  assert.match(migration, /CREATE TABLE `teacher_accounts`/);
  assert.match(migration, /CREATE TABLE `submission_receipts`/);
  assert.match(migration, /CREATE TABLE `image_tickets`/);
  assert.doesNotMatch(migration, /student_name|student_number|observed_at|\bmemo\b|image_bytes/);
});

test("preserves existing class folders while splitting Google accounts from classes", async () => {
  const migration = await readFile(new URL("../drizzle/0002_teacher_accounts_classes.sql", import.meta.url), "utf8");
  const tenant = await readFile(new URL("../lib/tenant.ts", import.meta.url), "utf8");
  const callback = await readFile(new URL("../app/api/google/callback/route.ts", import.meta.url), "utf8");
  const classesRoute = await readFile(new URL("../app/api/admin/classes/route.ts", import.meta.url), "utf8");
  assert.match(migration, /INSERT INTO `teacher_accounts`[\s\S]*FROM `teacher_connections`/);
  assert.match(migration, /UPDATE `teacher_connections` SET `account_id` = `id`/);
  assert.match(migration, /DROP INDEX `teacher_connections_google_permission_unique`/);
  assert.match(tenant, /function getTeacherAccountByGooglePermissionId/);
  assert.match(tenant, /function listTeacherClasses/);
  assert.match(tenant, /function createTeacherClass/);
  assert.match(tenant, /function deleteTeacherClass/);
  assert.match(callback, /getTeacherAccountByGooglePermissionId/);
  assert.match(callback, /getFirstTeacherByAccountId/);
  assert.match(classesRoute, /createClassRootFolder/);
  assert.match(classesRoute, /createTeacherCookie\(created\.id\)/);
  assert.match(classesRoute, /export async function DELETE/);
  assert.match(classesRoute, /listObservationRows\(accessToken, target/);
  assert.match(classesRoute, /deleteDriveFile\(accessToken, item\.imageFileId\)/);
  assert.match(classesRoute, /deleteDriveFile\(accessToken, target\.spreadsheetId\)/);
  assert.match(classesRoute, /deleteDriveFile\(accessToken, target\.photosFolderId\)/);
  assert.match(classesRoute, /deleteDriveFile\(accessToken, target\.rootFolderId\)/);
  assert.match(classesRoute, /deleteTeacherClass\(target\.id\)/);
  assert.match(classesRoute, /마지막 반은 삭제할 수 없습니다/);
});

test("lets the admin choose and regenerate QR codes per class", async () => {
  const inviteRoute = await readFile(new URL("../app/api/admin/invite/route.ts", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(inviteRoute, /classes: visibleClasses/);
  assert.match(inviteRoute, /joinUrl: `\$\{origin\}\/join\?t=/);
  assert.match(inviteRoute, /rotateInviteToken\(target\.id/);
  assert.match(adminPage, /const \[qrClassId, setQrClassId\]/);
  assert.match(adminPage, /학생용 QR/);
  assert.match(adminPage, /주소 복사/);
  assert.match(adminPage, /navigator\.clipboard\.writeText/);
  assert.match(adminPage, /window\.prompt/);
  assert.match(adminPage, /function deleteClass/);
  assert.match(adminPage, /method: "DELETE"/);
  assert.match(adminPage, /Drive 폴더, 사진 파일, 제출 목록도 함께 삭제됩니다/);
  assert.match(adminPage, /되돌리기 어렵습니다/);
  assert.match(adminPage, /aria-label=\{`\$\{teacherClass\.classLabel\} 반 삭제`\}/);
  assert.match(adminPage, />\s*×\s*</);
  assert.match(adminPage, /선택한 반 새 QR 만들기/);
  assert.match(adminPage, /기존 QR 주소로는 새로 입장할 수 없지만/);
  assert.match(adminPage, /이미 입장한 기기의 60일 학생 세션은 유지됩니다/);
});

test("clarifies admin sign-out and Drive disconnect actions with short help text", async () => {
  const adminPage = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(adminPage, /onMouseEnter=\{\(\) => setOpen\(true\)\}/);
  assert.match(adminPage, /aria-expanded=\{open\}/);
  assert.match(adminPage, /Google Drive 연결하기/);
  assert.match(adminPage, /교사 Google 계정을 이 서비스에 연결합니다/);
  assert.match(adminPage, /이 브라우저의 교사 화면 세션만 종료합니다/);
  assert.match(adminPage, /같은 계정으로 다시 연결하면 기존 반 목록으로 돌아옵니다/);
  assert.match(adminPage, /Google Drive 생성\/관리 권한을 해제합니다/);
  assert.match(adminPage, /업로드된 파일과 반별 폴더·제출 목록은 Google Drive에 그대로 남습니다/);
  assert.match(adminPage, /현재 관리 중인 반과 다른 반의 QR도 선택해서 볼 수 있습니다/);
  assert.match(adminPage, /새 Drive 폴더, 사진 폴더, 제출 목록, 학생용 QR을 가진 별도 반을 추가합니다\./);
  assert.doesNotMatch(adminPage, /현재 반 이름을 바꾸는 기능이 아닙니다/);
  assert.match(adminPage, /학급명 변경/);
  assert.match(adminPage, /현재 선택한 반의 화면 표시 이름만 바꿉니다/);
  assert.match(adminPage, /Drive 폴더, 제출 목록, 학생용 QR 주소는 그대로 유지됩니다/);
});

test("offers external high-quality capture, in-page camera fallback, and gallery separately", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<input[^>]*id="captureInput"[^>]*type="file"[^>]*>/);
  assert.match(html, /<input[^>]*id="captureInput"[^>]*accept="image\/\*"[^>]*>/);
  assert.match(html, /<input[^>]*id="captureInput"[^>]*capture="environment"[^>]*>/);
  assert.match(html, /<input[^>]*id="captureInput"[^>]*onchange="previewPhoto\(event, 'capture'\)"[^>]*>/);
  assert.match(html, /고화질 촬영/);
  assert.match(html, /<input[^>]*id="photoInput"[^>]*type="file"[^>]*>/);
  assert.match(html, /<input[^>]*id="photoInput"[^>]*accept="image\/\*"[^>]*>/);
  assert.match(html, /<input[^>]*id="photoInput"[^>]*onchange="previewPhoto\(event, 'gallery'\)"[^>]*>/);
  assert.doesNotMatch(html, /<input[^>]*id="photoInput"[^>]*capture=/);
  assert.match(html, /<details[^>]*id="cameraFallback"[^>]*>/);
  assert.match(html, /촬영이 안 될 때/);
  assert.match(html, /페이지 안 카메라 열기/);
  assert.doesNotMatch(html, /<button[^>]*onclick="startCamera\(\)"[^>]*>[\s\S]*?카메라로 촬영[\s\S]*?<\/button>/);
  assert.match(html, /<button[^>]*type="button"[^>]*onclick="startCamera\(\)"[^>]*>/);
  assert.match(html, /<video[^>]*id="cameraPreview"[^>]*autoplay[^>]*playsinline[^>]*>/);
  assert.match(html, /<button[^>]*type="button"[^>]*onclick="captureCameraPhoto\(\)"[^>]*>/);
  assert.match(html, /navigator\.mediaDevices\.getUserMedia/);
});

test("allows larger compressed photos for high-quality camera uploads", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const observations = await readFile(new URL("../lib/observations.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/observations/route.ts", import.meta.url), "utf8");
  assert.match(html, /const MAX_SOURCE_BYTES = 20 \* 1024 \* 1024/);
  assert.match(html, /const MAX_OUTPUT_BYTES = 6 \* 1024 \* 1024/);
  assert.match(html, /const IMAGE_MAX_SIDE = 2560/);
  assert.match(html, /const IMAGE_QUALITY = 0\.9/);
  assert.match(observations, /photo\.size > 6 \* 1024 \* 1024/);
  assert.match(route, /contentLength > 8 \* 1024 \* 1024/);
});

test("keeps an Android gallery JPEG with a nonstandard MIME attached through submission", async () => {
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
  getElement("memo").value = "안드로이드 갤러리 선택";
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

  const galleryInput = createElement({
    files: [new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "gallery.jpg", { type: "application/octet-stream" })],
    value: "gallery.jpg",
  });
  await context.__photoFlow.previewPhoto({ target: galleryInput }, "gallery");
  await context.__photoFlow.submitObservation({ preventDefault() {} });

  assert.equal(requests.length, 1, "gallery photo should reach the observation API");
  assert.equal(requests[0].url, "/api/observations");
  assert.equal(requests[0].options.credentials, "same-origin");
  const photo = requests[0].options.body.get("photo");
  assert.ok(photo instanceof File, "multipart photo should be a File");
  assert.ok(photo.size > 0, "multipart photo should retain image bytes");
});

test("attaches a frame from the in-page camera without leaving the page", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "student page script should exist");

  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  getElement("cameraPreview").videoWidth = 1600;
  getElement("cameraPreview").videoHeight = 900;
  getElement("cameraPanel").classList.add("hidden");
  getElement("photoPreviewWrap").classList.add("hidden");
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const context = {
    Blob,
    URL: {
      createObjectURL: () => "blob:camera-frame",
      revokeObjectURL() {},
    },
    document: {
      addEventListener() {},
      createElement(tagName) {
        assert.equal(tagName, "canvas");
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          toBlob(callback) {
            callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }));
          },
        };
      },
      getElementById: getElement,
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => stream,
      },
    },
  };

  runInNewContext(
    `${script}\nglobalThis.__cameraFlow = { startCamera, captureCameraPhoto };`,
    context,
  );

  await context.__cameraFlow.startCamera();
  assert.equal(getElement("cameraPreview").srcObject, stream);
  assert.equal(getElement("cameraPanel").classList.contains("hidden"), false);

  context.__cameraFlow.captureCameraPhoto();
  assert.equal(track.stopped, true);
  assert.equal(getElement("cameraPanel").classList.contains("hidden"), true);
  assert.equal(getElement("photoPreview").src, "blob:camera-frame");
  assert.equal(getElement("photoPreviewWrap").classList.contains("hidden"), false);
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

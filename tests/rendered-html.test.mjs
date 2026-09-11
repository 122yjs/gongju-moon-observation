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
  assert.match(html, /<title>달 관찰 탐험대<\/title>/);
  assert.match(html, /href="\/app\.css"/);
  assert.ok(css.length > 20_000, "compiled Tailwind CSS should be present");
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|fonts\.googleapis\.com|google\.script\.run/);
});

test("labels the class gallery and filters it by observation date and attendance number", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/observations/route.ts", import.meta.url), "utf8");
  const drive = await readFile(new URL("../lib/google-drive.ts", import.meta.url), "utf8");
  assert.match(html, /data-view="gallery"[^>]*>우리반 달사진 보기<\/button>/);
  assert.match(html, /id="galleryHeading"[^>]*>우리반 달사진 보기/);
  assert.match(html, /id="galleryObservedDateFilter"[^>]*type="date"/);
  assert.match(html, /id="galleryStudentNumberFilter"[^>]*type="number"[^>]*min="1"[^>]*max="50"/);
  assert.match(route, /url\.searchParams\.get\("observedDate"\)/);
  assert.match(route, /url\.searchParams\.get\("studentNumber"\)/);
  assert.match(drive, /row\.observedAt\.startsWith\(`\$\{options\.observedDate\}T`\)/);
  assert.match(drive, /row\.studentNumber === options\.studentNumber/);
});

test("sends the selected gallery filters with the first page request", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "student page script should exist");

  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  getElement("galleryObservedDateFilter").value = "2026-08-25";
  getElement("galleryStudentNumberFilter").value = "7";
  getElement("photoGallery").replaceChildren = () => {};
  const requests = [];
  const context = {
    AbortController,
    URLSearchParams,
    document: {
      addEventListener() {},
      getElementById: getElement,
    },
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return { items: [], total: 0, hasMore: false, nextCursor: null };
        },
      };
    },
  };

  runInNewContext(
    `${script}\nglobalThis.__galleryFilters = { applyGalleryFilters };`,
    context,
  );
  await context.__galleryFilters.applyGalleryFilters({ preventDefault() {} });

  assert.deepEqual(requests, ["/api/observations?limit=12&observedDate=2026-08-25&studentNumber=7"]);
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

test("opens a protected Korean-time summary while preserving the raw observation sheet", async () => {
  const drive = await readFile(new URL("../lib/google-drive.ts", import.meta.url), "utf8");
  const spreadsheetRoute = await readFile(
    new URL("../app/api/admin/spreadsheet/route.ts", import.meta.url),
    "utf8",
  );
  const inviteRoute = await readFile(new URL("../app/api/admin/invite/route.ts", import.meta.url), "utf8");
  const classesRoute = await readFile(new URL("../app/api/admin/classes/route.ts", import.meta.url), "utf8");
  const settingsRoute = await readFile(new URL("../app/api/admin/settings/route.ts", import.meta.url), "utf8");

  assert.match(drive, /const SUMMARY_SHEET_TITLE = "제출 목록"/);
  assert.match(drive, /properties: \{ timeZone: "Asia\/Seoul" \}/);
  assert.match(drive, /properties: \{ sheetId: teacher\.sheetId, hidden: true \}/);
  assert.match(drive, /\[\["이름", "출석번호", "관찰 시각 \(한국 시간\)", "설명", "사진 용량", "사진 원본 링크"\]\]/);
  assert.match(drive, /HYPERLINK\(\$\{raw\}!M2:M\$\{endRow\},"사진 열기"\)/);
  assert.match(drive, /\$\{raw\}!K2:K\$\{endRow\}="visible"/);
  assert.match(drive, /warningOnly: true/);
  assert.match(drive, /await ensureTeacherSummarySheet\(accessToken/);

  assert.match(drive, /const range = `\$\{quoteSheetTitle\(teacher\.sheetTitle\)\}!A:M`/);
  assert.match(drive, /sheetId: teacher\.sheetId/);
  assert.match(drive, /sheetTitle,\s*\n\s*};/);

  assert.match(spreadsheetRoute, /ensureTeacherSummarySheet\(accessToken, target\)/);
  assert.match(spreadsheetRoute, /\/preview`/);
  assert.match(spreadsheetRoute, /previewUrl\.searchParams\.set\("gid", String\(summarySheetId\)\)/);
  assert.match(inviteRoute, /\/api\/admin\/spreadsheet\?classId=/);
  assert.match(classesRoute, /\/api\/admin\/spreadsheet\?classId=/);
  assert.match(settingsRoute, /\/api\/admin\/spreadsheet\?classId=/);
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

test("stores account-level observation region settings for the student UI", async () => {
  const migration = await readFile(new URL("../drizzle/0003_teacher_account_region_settings.sql", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const tenant = await readFile(new URL("../lib/tenant.ts", import.meta.url), "utf8");
  const centers = await readFile(new URL("../lib/korean-region-centers.ts", import.meta.url), "utf8");
  const geocode = await readFile(new URL("../lib/region-geocode.ts", import.meta.url), "utf8");
  const geocodeRoute = await readFile(new URL("../app/api/admin/geocode/route.ts", import.meta.url), "utf8");
  const settingsRoute = await readFile(new URL("../app/api/admin/settings/route.ts", import.meta.url), "utf8");
  const inviteRoute = await readFile(new URL("../app/api/admin/invite/route.ts", import.meta.url), "utf8");
  const sessionRoute = await readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE `teacher_accounts` ADD `region_label`/);
  assert.match(migration, /ALTER TABLE `teacher_accounts` ADD `region_short_label`/);
  assert.match(migration, /ALTER TABLE `teacher_accounts` ADD `observation_lat` real/);
  assert.match(migration, /ALTER TABLE `teacher_accounts` ADD `observation_lon` real/);
  assert.match(schema, /regionLabel: text\("region_label"\)/);
  assert.match(schema, /observationLat: real\("observation_lat"\)/);
  assert.match(centers, /KOSTAT 2013 행정구역 경계 데이터/);
  assert.match(centers, /name: "공주시"/);
  assert.match(centers, /shortName: "공주"/);
  assert.match(geocode, /function scoreRegion/);
  assert.match(geocode, /SINGLE_CITY_SIDOS/);
  assert.match(geocode, /region\.level === "sigungu" && SINGLE_CITY_SIDOS\.has\(region\.sido\)/);
  assert.match(geocode, /searchKoreanRegions/);
  assert.match(geocodeRoute, /await requireTeacher\(request\)/);
  assert.match(geocodeRoute, /searchKoreanRegions\(normalized\)/);
  assert.match(tenant, /function hasAccountRegionColumns/);
  assert.match(tenant, /NULL AS account_region_label/);
  assert.match(tenant, /function updateAccountRegionSettings/);
  assert.match(tenant, /지역 설정 DB 마이그레이션이 아직 적용되지 않았습니다/);
  assert.match(settingsRoute, /updateAccountRegionSettings\(teacher\.accountId/);
  assert.match(inviteRoute, /regionSettingsRequired: !teacher\.regionSettingsCompletedAt/);
  assert.match(sessionRoute, /regionLabel: teacher\.regionLabel/);
  assert.match(sessionRoute, /observationLat: teacher\.observationLat/);
  assert.match(workflow, /npx wrangler d1 migrations apply DB --remote/);
  assert.match(workflow, /continue-on-error: true/);
});

test("lets the admin choose and regenerate QR codes per class", async () => {
  const inviteRoute = await readFile(new URL("../app/api/admin/invite/route.ts", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(inviteRoute, /classes: visibleClasses/);
  assert.match(inviteRoute, /joinUrl: `\$\{origin\}\/join\?t=/);
  assert.match(inviteRoute, /rotateInviteToken\(target\.id/);
  assert.match(adminPage, /const \[qrClassId, setQrClassId\]/);
  assert.match(adminPage, /학생용 QR/);
  assert.match(adminPage, /학생용 주소 · 누르면 복사됩니다/);
  assert.match(adminPage, /readOnly/);
  assert.match(adminPage, /onClick=\{copyQrUrl\}/);
  assert.match(adminPage, /navigator\.clipboard\.writeText/);
  assert.match(adminPage, /window\.prompt/);
  assert.match(adminPage, /function deleteClass/);
  assert.match(adminPage, /method: "DELETE"/);
  assert.match(adminPage, /Drive 폴더, 사진 파일, 제출 목록도 함께 삭제됩니다/);
  assert.match(adminPage, /되돌리기 어렵습니다/);
  assert.match(adminPage, /aria-label=\{`\$\{teacherClass\.classLabel\} 반 삭제`\}/);
  assert.match(adminPage, />\s*×\s*</);
  assert.match(adminPage, /기존 QR코드 바꾸기/);
  assert.match(adminPage, /기존 QR 주소로는 새로 입장할 수 없지만/);
  assert.match(adminPage, /이미 입장한 기기의 60일 학생 세션은 유지됩니다/);
});

test("renders the student-facing class name from the active session", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const sessionRoute = await readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8");
  assert.match(html, /id="studentClassHeaderLabel"[^>]*>📍 관찰 지역 기준 · 수업 참여 전</);
  assert.match(html, /id="submitClassLabel"[^>]*>우리 반</);
  assert.match(html, /const DEFAULT_CLASS_LABEL = '우리 반'/);
  assert.match(html, /function setClassroomContext\(context\)/);
  assert.match(html, /`\uD83D\uDCCD \$\{currentRegionShortLabel\} 기준 · \$\{currentClassLabel\}`/);
  assert.match(html, /`\u203B \$\{currentRegionShortLabel\} 기준 좌표/);
  assert.match(html, /setClassroomContext\(lastSessionContext\)/);
  assert.match(html, /badge\.textContent = currentClassLabel/);
  assert.match(sessionRoute, /classLabel: teacher\.classLabel/);
  assert.doesNotMatch(html, /초등 4학년 1반|<strong>4학년 1반<\/strong>|badge\.textContent = '4학년 1반'/);
});

test("keeps Korean place names out of static student and policy pages", async () => {
  const files = [
    "../dist/client/index.html",
    "../public/tenant-label.js",
    "../app/layout.tsx",
    "../app/page.tsx",
    "../app/join/page.tsx",
    "../app/privacy/page.tsx",
    "../app/terms/page.tsx",
    "../app/data-deletion/page.tsx",
  ];
  const contents = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  for (const content of contents) {
    assert.doesNotMatch(content, /공주시|공주 달 관찰 탐험대|공주 하늘 달력|GONGJU_/);
  }
  const html = contents[0];
  assert.match(html, /regionLabel/);
  assert.match(html, /currentObservationLat/);
  assert.match(html, /formatLatitude/);
});

test("clarifies admin sign-out and Drive disconnect actions with short help text", async () => {
  const adminPage = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(adminPage, /onMouseEnter=\{\(\) => setOpen\(true\)\}/);
  assert.match(adminPage, /aria-expanded=\{open\}/);
  assert.match(adminPage, /Google Drive 연결하기/);
  assert.match(adminPage, /Google Drive를 처음 연결한 뒤 학생 화면에 표시할 지역명과 달 계산 기준 좌표를 설정합니다/);
  assert.match(adminPage, /관찰 지역 설정/);
  assert.match(adminPage, /\/api\/admin\/geocode\?q=/);
  assert.match(adminPage, /지역명을 입력하면 공개 행정구역 데이터에서 중심 좌표를 찾아 위도·경도를 채웁니다/);
  assert.match(adminPage, /function deriveStudentRegionLabel/);
  assert.match(adminPage, /확인과 저장은 기준 지역명으로 하고, 학생 화면에는/);
  assert.doesNotMatch(adminPage, /짧은 지역명/);
  assert.match(adminPage, /같은 이름의 지역이 여러 개입니다/);
  assert.match(adminPage, /같은 Google 계정의 모든 반에 적용됩니다/);
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
  assert.match(html, /const CAMERA_PENDING_KEY = ['"]moon-camera-pending-v1['"]/);
  assert.match(html, /function prepareExternalCamera\(\)/);
  assert.match(html, /captureInput\.addEventListener\(['"]cancel['"], clearCameraPending\)/);
  assert.match(html, /촬영 중 화면이 다시 시작됐어요/);
  assert.doesNotMatch(html, /페이지 안 고화질 촬영/);
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
  assert.match(auth, /STUDENT_RESUME_MAX_AGE = 6 \* 60 \* 60/);
  assert.match(auth, /createStudentResumeToken/);
  assert.match(auth, /getStudentResumeSession/);
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

test("ships student moon guidance copy in the built page", async () => {
  const built = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(built, /달이 뜨는 때/);
  assert.match(built, /가장 높을 때/);
  assert.match(built, /달이 지는 때/);
  assert.match(built, /id="observationGuidanceCard"/);
  assert.match(built, /나침반 열기/);
  assert.match(built, /지금은 너무 늦었어요/);
  assert.match(built, /오늘은 달을 관찰하기 어려운 날이에요/);
  assert.match(built, /async function openCompass/);
  assert.doesNotMatch(built, /안 보여요/);
});

test("integrates safe high-resolution photo pipeline and worker into the student upload flow", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<script src="\/photo-pipeline\.js"><\/script>/);
  assert.match(html, /MoonPhotoPipeline\.compress/);
  assert.match(html, /workerUrl:\s*['"]\/photo-worker\.js['"]/);
  assert.match(html, /suspendPhotoPreviewForProcessing/);
  assert.match(html, /restorePhotoPreviewAfterProcessingError/);
  assert.match(html, /고화질 촬영/);
  assert.match(html, /formData\.append\(['"]photo['"],\s*compressedImageBlob,\s*['"]moon\.jpg['"]\)/);
  assert.match(html, /fetch\(['"]\/api\/observations['"]/);
});

# External Camera Memory and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing external Android camera flow against page-owned memory pressure and recover typed student input after the web document is recreated.

**Architecture:** Keep the `origin/main` external camera UI and existing draft/session code. Add a synchronous `captureInput` preparation hook that force-saves the draft, records a small tab-scoped pending marker, and releases page-owned photo resources before the native picker opens. On the next document instance, validate the marker against class scope, age, and page instance, restore the existing draft, and show a one-time retake notice.

**Tech Stack:** Static student page in `public/index.html`, browser `sessionStorage`, Node's built-in `node:test`, Vinext/Cloudflare Workers deployment.

---

## Files and responsibilities

- Modify: `public/index.html` — camera preparation, pending-marker storage, recreation recovery, and submission cleanup.
- Modify: `tests/student-draft.test.mjs` — VM tests for force-saving, pending-state lifecycle, and document recreation.
- Modify: `tests/rendered-html.test.mjs` — preserve the external-camera HTML contract and guard against the reverted in-page-primary PR.
- Existing: `docs/superpowers/specs/2026-09-09-external-camera-memory-recovery-design.md` — approved design and non-goals.

## Task 1: Add failing tests

**Files:**
- Modify: `tests/student-draft.test.mjs`

- [ ] **Step 1: Expose the new browser functions from the existing VM fixture.**

In the `runInNewContext` suffix, extend the API object from:

~~~js
globalThis.api = { checkSession, submitObservation, attachPhoto };
~~~

to:

~~~js
globalThis.api = {
  checkSession, submitObservation, attachPhoto, prepareExternalCamera, previewPhoto,
};
~~~

- [ ] **Step 2: Add tests for the new behavior before implementation.**

Append these tests to `tests/student-draft.test.mjs`:

~~~js
test('external camera preparation force-saves fields and records pending state', async () => {
  const saved = storage();
  const first = await page(saved);
  const values = ['7', '김학생', '2026-09-09T20:15', '남쪽 하늘'];
  fields.forEach((id, index) => { first.element(id).value = values[index]; });

  first.api.prepareExternalCamera();

  const draft = JSON.parse(saved.getItem('moon-observation-draft-v1'));
  assert.deepEqual(fields.map((id) => draft.fields[id]), values);
  const pending = JSON.parse(saved.getItem('moon-camera-pending-v1'));
  assert.equal(pending.scope, 'class-a');
  assert.equal(typeof pending.startedAt, 'number');
  assert.equal(typeof pending.pageId, 'string');
});

test('a recreated document restores fields and shows a one-time retake notice', async () => {
  const saved = storage();
  const first = await page(saved);
  const values = ['5', '복원 학생', '2026-09-09T20:30', '카메라 전환 직전'];
  fields.forEach((id, index) => { first.element(id).value = values[index]; });
  first.api.prepareExternalCamera();

  const recreated = await page(saved);

  assert.deepEqual(fields.map((id) => recreated.element(id).value), values);
  assert.match(recreated.element('photoStatus').textContent, /다시 시작|다시 눌러/);
  assert.equal(saved.getItem('moon-camera-pending-v1'), null);
});

test('same-document return and camera cancellation clear pending state without recreation notice', async () => {
  const saved = storage();
  const first = await page(saved);
  first.api.prepareExternalCamera();
  await first.api.checkSession();
  assert.doesNotMatch(first.element('photoStatus').textContent, /다시 시작/);

  first.events.get('captureInput:cancel')();
  assert.equal(saved.getItem('moon-camera-pending-v1'), null);

  first.api.prepareExternalCamera();
  await first.api.previewPhoto({ target: { files: [], value: 'cancelled' } }, 'capture');
  assert.equal(saved.getItem('moon-camera-pending-v1'), null);
});

test('invalid, expired, and cross-class pending markers are removed without recovery', async () => {
  const cases = [
    '{broken',
    JSON.stringify({ scope: 'class-a', startedAt: Date.now() - 31 * 60 * 1000, pageId: 'old' }),
    JSON.stringify({ scope: 'class-a', startedAt: Date.now(), pageId: 'old' }),
  ];

  for (const value of cases) {
    const saved = storage({ 'moon-camera-pending-v1': value });
    const scope = value.includes('class-a') && value.includes('startedAt') && value.includes('old')
      ? 'class-b'
      : 'class-a';
    const current = await page(saved, scope);
    assert.equal(saved.getItem('moon-camera-pending-v1'), null);
    assert.doesNotMatch(current.element('photoStatus').textContent, /다시 시작/);
  }
});
~~~

The first and second tests must use the existing `storage()`, `page()`, and `fields` helpers, so they also verify compatibility with the already-tested draft/session behavior.

- [ ] **Step 3: Run the focused tests and confirm the red state.**

Run:

~~~powershell
$env:Path = 'C:\Program Files\Git\bin;' + $env:Path
node --test tests/student-draft.test.mjs
~~~

Expected: the existing tests pass, and the four new tests fail because `prepareExternalCamera` and the pending recovery behavior do not exist yet.

## Task 2: Implement synchronous preparation and pending-state storage

**Files:**
- Modify: `public/index.html:336-546, 984-1048`

- [ ] **Step 1: Add constants and a per-document identifier.**

Immediately after the existing draft constants, add:

~~~js
const CAMERA_PENDING_KEY = 'moon-camera-pending-v1';
const CAMERA_PENDING_MAX_AGE = 30 * 60 * 1000;
const PAGE_INSTANCE_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
~~~

- [ ] **Step 2: Make draft saving forceable and add pending helpers.**

Change `saveObservationDraft()` to accept `force = false`; use `(!draftHasEdits && !force)` in its guard. Keep its existing field serialization and exception handling. Because DOM callbacks pass an event object as their first argument, register the ordinary click and pagehide saves as `() => saveObservationDraft()` wrappers; only the camera-preparation path may pass `true`.

Add these functions immediately after it:

~~~js
function writeCameraPending() {
  if (!draftScope) return;
  try {
    sessionStorage.setItem(CAMERA_PENDING_KEY, JSON.stringify({
      scope: draftScope, startedAt: Date.now(), pageId: PAGE_INSTANCE_ID,
    }));
  } catch (_) {
    // Camera launch must continue when tab storage is unavailable.
  }
}

function clearCameraPending() {
  try { sessionStorage.removeItem(CAMERA_PENDING_KEY); } catch (_) { /* Storage may be disabled. */ }
}

function readCameraPending() {
  try {
    const pending = JSON.parse(sessionStorage.getItem(CAMERA_PENDING_KEY));
    if (!pending || typeof pending.scope !== 'string' || typeof pending.pageId !== 'string' ||
        !Number.isFinite(pending.startedAt)) {
      clearCameraPending();
      return null;
    }
    const age = Date.now() - pending.startedAt;
    if (age < 0 || age > CAMERA_PENDING_MAX_AGE) {
      clearCameraPending();
      return null;
    }
    return pending;
  } catch (_) {
    clearCameraPending();
    return null;
  }
}

function restoreCameraPending(context) {
  const pending = readCameraPending();
  const scope = context && typeof context.draftScope === 'string' ? context.draftScope : '';
  if (!pending) return;
  if (!scope || pending.scope !== scope) {
    clearCameraPending();
    return;
  }
  if (pending.pageId === PAGE_INSTANCE_ID) return;
  clearCameraPending();
  showView('submit');
  showPhotoStatus('촬영 중 화면이 다시 시작됐어요. 작성 내용을 복원했습니다. 고화질 촬영을 다시 눌러 주세요.', false);
}
~~~

Use a 30-minute age limit. Storage failures and malformed data must not prevent camera use or session initialization.

- [ ] **Step 3: Register the synchronous native-picker hooks.**

Inside `initObservationDraft()`, after the existing form listeners, add:

~~~js
const captureInput = document.getElementById('captureInput');
captureInput.addEventListener('click', prepareExternalCamera);
captureInput.addEventListener('cancel', clearCameraPending);
~~~

Add this function next to the photo handlers:

~~~js
function prepareExternalCamera() {
  if (photoProcessing || submissionBusy) return;
  saveObservationDraft(true);
  writeCameraPending();
  stopCamera();
  releasePhoto();
  const input = document.getElementById('captureInput');
  if (input) input.value = '';
}
~~~

The function must be synchronous; do not await cleanup before the browser opens the external camera.

- [ ] **Step 4: Clear pending state at the first external-camera callback.**

At the first executable line of `previewPhoto(event, source = 'gallery')`, add:

~~~js
if (source === 'capture') clearCameraPending();
~~~

This must run before busy checks and file validation, so an empty result or image-format error still proves that the callback survived.

- [ ] **Step 5: Run the focused draft tests.**

Run:

~~~powershell
$env:Path = 'C:\Program Files\Git\bin;' + $env:Path
node --test tests/student-draft.test.mjs
~~~

Expected: all draft tests, including the four new tests, pass.

## Task 3: Integrate recovery and protect the rendered contract

**Files:**
- Modify: `public/index.html:543-546, 651-673, 1230-1234`
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: Recover pending camera state after the class session and draft.**

Replace the existing session restoration line:

~~~js
if (hasClassSession) restoreObservationDraft(lastSessionContext);
~~~

with:

~~~js
if (hasClassSession) {
  restoreObservationDraft(lastSessionContext);
  restoreCameraPending(lastSessionContext);
}
~~~

This preserves restored field values and lets the camera-specific message replace the generic draft message.

- [ ] **Step 2: Clear the marker with the existing successful-submission cleanup.**

Call `clearCameraPending()` from `clearObservationDraft()` after removing `DRAFT_KEY`. Do not clear it from failed submission handling.

- [ ] **Step 3: Add static assertions for the production behavior.**

In the existing external-camera test in `tests/rendered-html.test.mjs`, add:

~~~js
assert.match(html, /const CAMERA_PENDING_KEY = ['"]moon-camera-pending-v1['"]/);
assert.match(html, /function prepareExternalCamera\(\)/);
assert.match(html, /captureInput\.addEventListener\(['"]cancel['"], clearCameraPending\)/);
assert.match(html, /촬영 중 화면이 다시 시작됐어요/);
assert.doesNotMatch(html, /페이지 안 고화질 촬영/);
~~~

The final assertion ensures the reverted in-page-primary PR is not reintroduced.

- [ ] **Step 4: Run focused regression tests.**

Run:

~~~powershell
$env:Path = 'C:\Program Files\Git\bin;' + $env:Path
node --test tests/student-draft.test.mjs tests/student-session-resilience.test.mjs tests/photo-memory.test.mjs tests/rendered-html.test.mjs
~~~

Expected: all focused tests pass and the external camera remains the primary UI.

## Task 4: Full verification and production delivery

**Files:**
- Modify: `public/index.html`
- Modify: `tests/student-draft.test.mjs`
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: Run the full build and test suite.**

Run:

~~~powershell
$env:Path = 'C:\Program Files\Git\bin;' + $env:Path
npm test
~~~

Expected: build completes and all tests pass; the total is the 40-test baseline plus the four new recovery tests.

- [ ] **Step 2: Inspect the diff and confirm only the approved scope changed.**

Run:

~~~powershell
git diff --check
git diff --stat origin/main...HEAD
git diff -- public/index.html tests/student-draft.test.mjs tests/rendered-html.test.mjs
~~~

Confirm there is no `highQualityCameraButton`, `ImageCapture`, or in-page high-resolution primary-capture change.

- [ ] **Step 3: Commit the implementation.**

Run:

~~~powershell
git add public/index.html tests/student-draft.test.mjs tests/rendered-html.test.mjs
git commit -m "fix: recover external camera submissions after page restart"
~~~

- [ ] **Step 4: Verify the branch still contains the latest remote main.**

Run:

~~~powershell
git fetch origin main --prune
git merge-base --is-ancestor origin/main HEAD
~~~

If the command exits nonzero, update from the latest `origin/main`, rerun the full suite, and create a new implementation commit.

- [ ] **Step 5: Integrate only this branch into remote main and deploy.**

Use the repository's accepted fast-forward/PR path. Do not push the reverted `fix/in-page-high-resolution-capture` branch or merge commit `a29ebae`.

If the main-push workflow is not used, run from the implementation worktree:

~~~powershell
$env:Path = 'C:\Program Files\Git\bin;' + $env:Path
npm run deploy
~~~

Then fetch `https://gongju-moon-observation.1226ijs.workers.dev/` and verify HTTP 200, the existing external `고화질 촬영` label, and the new pending-camera behavior in the served HTML. No database migration is expected.

- [ ] **Step 6: Report delivery and limitation.**

Report the implementation commit, production URL, test count, and that the change lowers page-owned memory and restores form text after recreation. State that Android LMKD can still kill the host process under extreme system memory pressure and a lost native camera file cannot be recovered automatically.

# External Camera Memory and Recovery Design

Date: 2026-09-09
Status: Approved for implementation review
Base: `origin/main` at `cd04eaf55ad7eef6c72fa122ea7095b7ff94db63`

## Context

Android Logcat shows that the Naver in-app browser process can be reclaimed by
LMKD while the external system camera is in the foreground. When that happens,
the original web document and its file-input callback disappear. The same
device and browser can also return a cancellation or JPEG successfully when the
document survives, so this is an intermittent lifecycle failure rather than a
fixed camera incompatibility.

The production `main` branch already:

- stores typed form fields in tab-scoped `sessionStorage`;
- restores a class session with a short-lived resume token;
- bounds image decoding and releases bitmap, image, canvas, and object-URL
  resources after processing;
- keeps the external system camera as the primary high-quality capture path and
  offers the existing in-page camera only as a fallback.

This change strengthens that existing production design. It does not include
the reverted in-page high-resolution capture PR.

## Goals

1. Reduce the student page's live memory immediately before Android opens the
   external camera.
2. Distinguish a normal return from a new document created while a camera request
   was pending.
3. Restore typed fields and give a precise retake instruction after document
   recreation.
4. Preserve the current production capture choices, class-session rules, image
   compression path, and submission API.

## Non-goals

- Preventing Android from reclaiming the Naver process in every low-memory
  condition.
- Recovering a camera result whose original file-input callback was destroyed.
- Making the in-page camera the primary capture experience.
- Changing HEIC support, image limits, Drive upload behavior, D1 data, or server
  APIs.

## Design

### 1. Synchronous pre-camera preparation

Register a `click` listener directly on `captureInput`. It runs synchronously
before the browser performs the file-input default action, so it does not await
work or consume the user activation required to open the system camera.

The handler will:

1. force-save all draft fields for the active class, including values that were
   initialized automatically and have not emitted an input event;
2. write a small camera-pending record;
3. stop any live in-page camera stream;
4. clear the preview image source;
5. revoke the preview object URL;
6. release the compressed photo Blob and pending submission request identifier;
7. reset the previous capture input value so selecting the same output can still
   produce a change event.

The existing `releasePhoto()` and `stopCamera()` helpers remain the single
resource-cleanup paths. No asynchronous cleanup is introduced before the picker
opens.

If a student already attached a photo and intentionally starts another capture,
the existing photo is released at launch. A cancelled retake therefore requires
selecting or capturing the photo again. This is the accepted tradeoff for
minimizing memory before the external app transition.

### 2. Camera-pending marker

Use a separate tab-scoped key, `moon-camera-pending-v1`, rather than changing the
existing draft schema. Its JSON value contains:

```json
{
  "scope": "server-provided-class-draft-scope",
  "startedAt": 1788920000000,
  "pageId": "unique-document-instance-id"
}
```

- `scope` prevents recovery from crossing classroom boundaries.
- `startedAt` permits expiry after 30 minutes.
- `pageId` distinguishes a return to the same document from a new document
  instance.

Storage failures are ignored so camera capture continues when storage is blocked
or full.

### 3. Normal return and cancellation

When `captureInput` emits `change`, clear the pending marker before validating or
processing the returned file. This proves that the original callback path still
exists even if image validation later fails.

Also listen for the file input's `cancel` event and clear the marker. Browsers
that do not expose `cancel` remain safe: the marker has a short expiry and is not
treated as a recreation while the same `pageId` is still running.

Successful form submission clears both the draft and any camera-pending marker.

### 4. Recovery after document recreation

Generate one `pageId` for each script execution. After the class session is
confirmed or restored, the existing draft restoration runs first. Then inspect
the camera-pending record.

A recovery notice is shown only when all conditions hold:

- the pending record is valid JSON;
- its scope matches the active class;
- its age is between zero and 30 minutes;
- its `pageId` differs from the current document's `pageId`.

The submit view remains open and the existing photo-status region displays:

> 촬영 중 화면이 다시 시작됐어요. 작성 내용은 복원했습니다. 고화질 촬영을 다시 눌러 주세요.

The pending marker is removed after showing the one-time notice. Invalid,
expired, or cross-class markers are removed without changing the view.

This recovery restores text fields only. It explicitly does not claim that the
lost camera file can be recovered.

## Error handling and compatibility

- The camera still opens if draft or pending-state storage throws.
- Damaged JSON never blocks class entry or form use.
- Existing session retry and resume-token behavior remains unchanged.
- Existing image-format and size errors remain unchanged.
- The main high-quality capture button, gallery button, and fallback camera UI
  remain as they are on `origin/main`.

## Verification

Add focused automated tests before production code changes:

1. external-camera click force-saves every draft field and records pending state;
2. the click releases an existing preview URL, Blob, request ID, and camera
   stream before launch;
3. a recreated page in the same class restores fields and shows the retake
   notice;
4. a same-document return does not show a recreation notice;
5. file result and explicit cancellation clear the pending marker;
6. expired, malformed, and cross-class pending records are ignored and removed;
7. unavailable storage does not prevent capture initialization;
8. successful submission clears pending state.

Then run the full production build and test suite. The clean `origin/main`
baseline is 40 passing tests.

## Delivery

Implementation starts from the isolated worktree branch
`fix/external-camera-memory-recovery`. After tests and review, integrate only
that branch's commits into the latest remote `main`, use the repository's
production Cloudflare deployment path, and verify the live page contains the
camera-pending behavior while still presenting the external high-quality camera
as the primary option.

Rollback is the inverse code commit and redeploy; there are no database or API
migrations.

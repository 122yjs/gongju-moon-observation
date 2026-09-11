# iOS high-resolution photo processing

## Evidence and scope

The user reported that 5222 x 6024 on iPhone fails, the same original on PC succeeds,
4015 x 4594 after cropping on iPhone succeeds, screenshots and tablet camera photos
succeed, and a 9 MB photo on PC succeeds. These are user-reported comparisons, not
an iPhone crash trace or a measured heap profile. The original image was not supplied.
This issue is separate from the previously recorded Android LMKD process kills.

Baseline: 1211482fa0eecfee29bd2d6e1bc1ee4beeb85717.
Student HTML blob: 4b6e914c41e51e6449100c5088bccf9e3cd57a95.

## Implementation

`photo-pipeline.js` is a dependency-free classic-script module. The student-page
adapter overrides the three existing global handlers after the original script
and before DOMContentLoaded. Existing inline input/form handlers resolve them at
invocation time. This avoids an unrelated rewrite of moon guidance and compass.
`prepare-ios-photo-integration.mjs` installs only two deferred script tags, and
refuses to modify any unreviewed or partially integrated student HTML blob.
The temporary branch-specific CI applies and commits this integration only after
build, repository tests and lint pass. It never deploys, touches main, migrates D1,
or reads/writes Google Drive/Sheets.

- iOS/iPadOS: use a Blob URL and HTMLImageElement even when createImageBitmap exists.
- No full-resolution canvas, data URL, original-size ImageData, or extra ImageBitmap.
- Draw directly into one output canvas, maximum 2048 per side and 3,000,000 pixels.
- Release the source before JPEG encoding; clear canvases and Blob URLs on every exit.
- Keep JPEG quality at 0.9 and API output limit at 6 MiB. Native decoder memory is
  NOT guaranteed by these canvas limits. This is not a reduced-IDCT/WASM decoder.
- Non-iOS keeps bitmap resizing; a rejection or ignored resize falls back after cleanup.
- JPEG up to the existing 64 MP ceiling uses the same path without bitmap support;
  PNG/WebP retain the existing 16 MP ceiling. Unknown formats are still rejected
  by the existing header parser. This change does not claim HEIC support.
- Null/too-large encoding gets one smaller-canvas retry, from the already downsized
  pixels. Never decode the original again just to change output quality.
- Async image-load and toBlob failures have explicit errors; source loading/encoding
  timeouts do not hang the submit controls. A synchronous browser/process crash is
  not catchable, so the last recorded stage is evidence of progress, not proof of cause.
- No automatic POST retry. Preserve the existing requestId and Blob on failed or
  uncertain submissions. FormData construction is now inside error handling.
- Failed photo replacement retains an already attached photo and its requestId.

## Diagnostics

Stages: header, decode, canvas, drawImage, toBlob, FormData, fetch, response, preview.
A small local-only ring records start/success/error, sanitized backend/error type,
numeric sizes/status and timings. It does not record file names, photos, EXIF,
form values, auth tokens, requestIds, request URLs, response bodies or raw exceptions.
A localStorage failure never blocks upload. Logs are bounded and expired on use.
The form exposes copy and JSON download controls; no remote telemetry is sent.
For the image-element path, onload can precede lazy native decoding during drawImage;
a completed decode/load event is not a measurement of decoder heap usage.

## Verification

- 44 Node tests cover branching, size limits, resource release, failure injection,
  same-photo retry state, HTTP errors, unknown responses, logging and privacy guards.
- 19 desktop Chromium native decoding/encoding scenarios use synthetic fixtures:
  both reported dimensions, screenshot PNG, tablet JPEG, missing ImageBitmap,
  desktop bitmap path, six total full-size iOS-path selections and EXIF 1-8.
  UA is overridden only to select the iOS code path; these are NOT Safari/iPhone tests.
- No actual iPhone original, device peak memory, camera intent or production
  Drive/Sheets E2E was tested locally. A passing mock is not proof of an iOS OOM fix.
- Real-device acceptance: original 5222 x 6024, crop, screenshot, repeated replacement,
  EXIF orientation and an isolated test-class upload. Inspect logs if failure persists.
  Keep production unchanged until the required build and device regression checks pass.

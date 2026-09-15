# 모바일 사진 업로드 점검·개선 — 2026-09-15

## 판정과 적용 범위

9월 11일 고해상도 JPEG 패치는 운영 사이트에 반영되어 있다. 그러나 이것이 모든 Android/iPhone 업로드 오류가 해결됐다는 뜻은 아니다. 이번 점검에서 남아 있는 파일 읽기·전송·중복 요청 처리 결함을 수정했다. 이번 추가 변경은 로컬 작업 트리에만 있으며, 커밋·푸시·운영 배포는 하지 않았다.

학생 데이터가 있는 운영 D1, Google Drive, Google Sheets에 테스트 기록을 쓰거나 기존 자료를 수정하지 않았다. 스키마, OAuth 권한, 저장소 구조를 변경하지 않았다. 기존 미커밋 작업을 보존했다.

## 운영 반영 확인 근거

- 저장소: `122yjs/gongju-moon-observation`
- 점검 당시 로컬/원격 main: `a10395d`
- 포함된 이전 패치: `e9665f8` — `fix: 고해상도 JPEG 안전 처리 파이프라인 (#6)`
- 운영 호스트: `gongju-moon-observation.1226ijs.workers.dev`
- 운영 HTML, 사진 파이프라인, Worker, 로컬 WASM 코덱을 GET으로 읽어 수정 전 로컬 파일과 바이트 단위 일치를 확인했다. 모두 HTTP 200이었다.
- `/api/health`는 `ok: true`, `mode: teacher-drive-oauth`, `oauthConfigured: true`였다. 이는 실제 학생 제출부터 Drive/Sheets 기록까지의 성공을 검증한 결과는 아니다.

수정 전 운영 파일 SHA-256:

| 경로 | SHA-256 |
| --- | --- |
| `/` | `74e55797cac2a20b2a30bc3d6b7d3d13230ea016e978033c6938945c77cd0dd6` |
| `/photo-pipeline.js` | `8b761fdec2fc20793731297c31aaf6c060fe308fc5fd9f4b466b97065afd6242` |
| `/photo-worker.js` | `7d8c2bc91c2c28398aa9923ade8c4c79714d86454c21ef63b2e61eace4b2ba25` |
| `/vendor/moon-jpeg-codec.js` | `1c51feb301e371218fb95cb6da39c878b80df219969a2ab67cf68616f443ad6f` |

## 원인 구분

사용자가 첨부한 `moon-camera-logcat-evidence.txt`는 Android 카메라 실행 중 Naver 본체 또는 Samsung Internet 렌더러가 lmkd로 종료되고 화면이 재생성되는 기록을 보여 준다. 일부 다른 왕복에서는 프로세스와 결과 콜백이 유지되지만, 이것만으로 파일 첨부 성공까지 확정할 수 없다. 이 로그는 iPhone 오류의 직접 증거가 아니다.

iPhone에서 보고됐던 5222×6024 원본 실패와 큰 크롭 사진 성공은 고해상도 처리 경로를 점검할 근거다. 이번에 추가로 언급된 사용자의 실제 실패 단계·파일 형식·브라우저 로그는 제공되지 않아 해당 건의 원인을 확정하지 않는다.

## 이번 수정

### 사진 준비: `public/photo-pipeline.js`, `public/index.html`

- 화면과 파이프라인이 따로 수행하던 해상도 검사를 한 곳으로 통합했다. 이전 화면의 256KiB 검사 한도 때문에 프레임 정보가 뒤에 있는 정상 JPEG가 거절되는 경로도 제거했다.
- 기본 디코더를 쓰는 사진은 헤더 최대 1MiB만 읽는다. 고해상도 JPEG는 Worker로 넘길 때만 전체 압축 파일을 한 번 읽는다. 원본 전체 픽셀을 무제한으로 펼치는 대체 경로는 추가하지 않았다.
- 파일 읽기에 30초 제한을 추가했다. 제한 뒤에 늦게 도착한 읽기 결과가 새 디코딩 작업을 시작하지 않도록 했다. 원본 파일 읽기 자체를 취소하는 기능은 아니다.
- 사진 교체 시 기존 미리보기의 이미지 src와 object URL을 해제한다. 이전 압축 Blob은 메모리에 보존해 새 사진 처리가 실패하면 다시 보여 준다. 실제 메모리 반환 시점은 브라우저가 결정한다.
- WebP VP8/VP8L 헤더도 지원한다. HEIC/HEIF는 JPEG로 내보내기 또는 페이지 안 카메라 사용을 안내한다. HEIC 변환 기능을 구현한 것은 아니다.
- 읽기·축소·JPEG 준비 단계를 한글로 표시하고, 이전 사진을 유지한 경우 이를 명시한다.
- 긴 변 최대 2560px, JPEG 품질 0.9, 출력 최대 6MiB를 유지했다. 최대값이므로 실제 출력 해상도는 축소 디코딩 배율에 따라 더 작을 수 있다.

### 전송: `public/index.html`

- POST 요청과 응답 본문 읽기를 합쳐 90초 제한을 둔다. 시간 초과 시 요청을 중단하고 폼을 다시 사용할 수 있게 한다.
- 네트워크 실패, 409, 429, 5xx, 시간 초과, 잘못된 성공 응답에서는 현재 페이지의 사진·입력 내용·요청 ID를 유지한다. 자동 반복 전송은 하지 않는다.
- HTTP 200만으로 성공 처리하지 않는다. `ok: true`와 비어 있지 않은 제출 ID를 받았을 때만 사진과 초안을 비운다.
- 시간 초과는 서버 저장 실패의 증거가 아니므로, 갤러리에서 제출 여부를 확인한 뒤 같은 사진으로 수동 재시도하도록 안내한다.

### 서버: `app/api/observations/route.ts`

- 기존 코드는 처리 중인 중복 요청을 409로 거절한 뒤에도 기존 요청의 중복 방지 예약을 삭제할 수 있었다. 해당 요청이 직접 획득한 예약만 해제하도록 수정했다.
- Drive와 Sheets에 이미 저장된 뒤 선택적인 갤러리 미리보기 준비가 실패해도 제출 실패로 잘못 응답하지 않는다. 갤러리 조회는 기존 방식대로 미리보기 전달표를 준비한다.
- 외부 저장소 사이의 원자적 트랜잭션을 새로 구현한 것은 아니다. 서버 강제 종료·모호한 Sheets 응답·완료 영수증 저장 실패까지 완전한 exactly-once 동작을 보장하지 않는다.

## 검증

- 전체 Node 회귀 테스트: **115개 통과**, 실패·건너뜀 없음. 이번에 24개 실패 경로 테스트를 추가했다.
- 정적 CSS 생성과 vinext 빌드: 통과. 로컬에 GNU timeout이 없어 기본 빌드 래퍼 대신 `npm run build:static && npx --no-install vinext build`를 사용했다.
- ESLint: 통과.
- 실제 WASM 코덱 검증: 통과. 합성 이미지 생성용 Pillow는 격리된 uv 실행 환경에서 사용했으며 프로젝트 의존성 파일을 변경하지 않았다.
- WebKit 26.6와 Chromium 153.0.8010.12, 390×844 터치 화면 설정: 두 엔진 모두 통과. 각 엔진당 브라우저 하나를 재사용한 뒤 종료했다.
- 실제 파일·Worker·WASM을 사용한 합성 이미지: 5222×6024 JPEG, 4015×4594 JPEG, 5222×6024 progressive JPEG, EXIF 회전 JPEG, 256KiB 뒤에 프레임 정보가 있는 JPEG.
- HEIC 안내와 이전 사진 복원, 서버 실패, HTTP 200 HTML 응답 거절, 정상 영수증 수신 뒤 초기화: 로컬 모의 API로 검증했다. 외부 네트워크 요청과 운영 저장소 쓰기는 없었다.
- 별도 `tsc --noEmit`는 실패한다. Cloudflare 타입 선언 누락 등 **16개 오류가 이번 서버 수정 전후 동일함**을 컴파일러 진단으로 대조했다. 전체 타입 검사가 통과했다고 보고하지 않는다.

주요 테스트 파일:

- `tests/photo-pipeline.test.mjs`, `tests/photo-memory.test.mjs`
- `tests/upload-resilience.test.mjs`
- `tests/submission-route-resilience.test.mjs`
- `tests/student-draft.test.mjs`, `tests/student-session-resilience.test.mjs`
- `scripts/verify-mobile-upload.mjs`

로컬 검증 결과는 `.wrangler/upload-20260915-*.log`와 `.wrangler/mobile-upload-qa/report.json`에 있다. 브라우저 검증 스크립트는 `MOON_PLAYWRIGHT_MODULE`로 설치된 Playwright 모듈을 지정할 수 있다.

## 남은 확인과 운영 적용 주의

실제 iPhone Safari·인앱 브라우저의 촬영/갤러리/iCloud 원본 선택, Android 외부 카메라 왕복과 OS 메모리 회수, 운영 Drive/Sheets까지의 실제 제출은 이번 검증에 포함되지 않는다. 데스크톱 WebKit 테스트는 실제 iPhone 시험을 대체하지 않는다.

브라우저 프로세스가 종료되기 전에 웹페이지가 전달받지 못한 사진은 복원할 수 없다. 기존 초안·수업 세션 복구는 유지하지만 사진 재선택이 필요할 수 있다. 새로고침 뒤에도 사진 Blob이나 요청 ID를 영구 복원하도록 변경하지 않았다.

운영 배포 전에는 이번 변경과 기존 미커밋 작업을 구분해 검토해야 한다. 현재 main 푸시는 자동 배포 워크플로를 실행하며, 그 워크플로에는 기존 D1 마이그레이션 단계도 있다. 이번 작업에서는 이를 실행하지 않았다.

# 기종 공통 고해상도 JPEG 안전 디코딩 설계

## 목적

학생 사진을 처리할 때 운영체제나 기종을 판별하지 않는다. 실제 파일 헤더에서
형식과 가로·세로 크기를 확인한 뒤, 16MP를 초과하는 JPEG는 원본 전체 해상도
픽셀 버퍼를 브라우저 메인 스레드에서 만들지 않는 Worker 축소 디코딩 경로로
처리한다. 이 경로는 iPhone과 Android 고화소 카메라 사진에 동일하게 적용된다.

## 범위

- 실제 JPEG·PNG·WebP 헤더에서 형식과 치수를 읽는다.
- 16MP 초과, 64MP 이하의 JPEG는 Worker 안의 reduced-IDCT JPEG 디코더로
  제출 크기에 가깝게 축소하여 디코딩한다.
- 16MP 이하 JPEG와 지원 PNG·WebP는 브라우저 네이티브 디코딩을 쓴다.
  `createImageBitmap` 실패는 HTML `Image` 디코더로 한 번만 대체한다.
- 최종 출력은 긴 변 2560px 이하 Canvas의 JPEG Blob(품질 0.9, 6MB 이하)이다.
- 사진 처리 실패 시 이전에 성공적으로 첨부한 사진 및 제출 requestId를 유지한다.
- 디코더·object URL·Worker·Canvas 자원은 성공과 실패 모두에서 해제한다.
- 사진 내용, 이름, 메모, 인증정보를 제외한 처리 단계·치수·바이트 수만
  브라우저 로컬 진단 기록에 남긴다.

## 비범위

- 기종 또는 운영체제별 분기
- HEIC/HEIF, 16MP 초과 PNG·WebP의 별도 축소 디코더
- 서버 API, Drive, Sheets, D1, OAuth, 제출 필드 변경
- Android LMKD 등 브라우저/호스트 앱 종료 자체를 방지하거나 잃어버린 카메라
  파일을 복원하는 기능

## 처리 흐름

```text
파일 헤더 검사
├─ JPEG, 16MP 초과(최대 64MP) ─→ Worker reduced-IDCT 축소 디코딩
│                                      └─ 실패 시 원본 브라우저 디코딩으로 대체하지 않음
└─ 그 밖의 지원 이미지(최대 16MP) ─→ createImageBitmap
                                       └─ 실패 시 HTML Image 한 번 대체
                                                    ↓
                                        제출 크기 Canvas
                                                    ↓
                                    JPEG Blob (0.9, 최대 6MB)
```

JPEG EXIF 방향은 Worker 및 네이티브 디코더가 적용한다. PNG/WebP의 메타데이터
방향은 실제 네이티브 디코딩 결과의 폭과 높이를 사용하므로 늘어나거나 찌그러지지
않는다.

## 구성 요소

- `public/photo-pipeline.js`: 헤더 메타데이터를 받아 경로를 선택하고, 네이티브
  fallback, Canvas 인코딩, 자원 해제와 비식별 진단을 담당한다.
- `public/photo-worker.js`: Worker에서 단일 JPEG 축소 디코드를 수행하고 결과
  RGBA 버퍼 또는 제한된 오류 코드를 돌려준다.
- `public/vendor/moon-jpeg-codec.js`: libjpeg-turbo로 빌드한 WASM 기반 코덱이다.
  라이선스·버전·소스 해시 고지를 함께 둔다.
- `public/index.html`: 기존 사진 선택과 제출 UX를 유지하면서 파이프라인을 연결한다.

## 오류와 안전성

16MP 초과 JPEG의 Worker 오류·시간 초과·메모리 한계는 명확한 오류로 끝낸다.
이 경우 `createImageBitmap`이나 `Image`에 원본을 전달하지 않아 고해상도 전체
디코딩이 뒤따르지 않는다. 지원하지 않는 형식, 확인할 수 없는 치수, 16MP 초과
비JPEG 및 64MP 초과 JPEG는 디코딩 전에 거절한다. 인코딩의 null 결과, 동기 예외,
시간 초과와 6MB 초과도 별도로 처리한다.

## 검증

테스트는 다음을 보장한다.

1. 16MP 이하 JPEG는 bitmap 경로를 사용하고 bitmap을 인코딩 전에 해제한다.
2. bitmap 실패 시 16MP 이하 이미지만 Image 경로로 대체한다.
3. 16MP 초과 JPEG는 기종 조건 없이 Worker만 사용한다.
4. Worker 실패 시 원본 크기 네이티브 디코더를 호출하지 않는다.
5. 큰 비JPEG를 디코딩 전에 거절하고, 출력 크기·형식·용량을 제한한다.
6. 성공과 오류에서 URL, Image/bitmap, Worker, Canvas가 해제된다.
7. 기존 사진 유지, 제출 FormData 및 fetch의 회귀를 확인한다.
8. 전체 프로젝트 build, lint, 기존 회귀 테스트를 실행한다.

## 배포 전 확인

WASM/Worker가 현재 CSP 및 Cloudflare 정적 자산 배포에서 same-origin으로 로드되는지
확인한다. 실제 iPhone과 Android에서 같은 고화소 JPEG를 선택해 방향, 출력 크기,
제출, 실패 복구를 확인한다. 이 작업은 로컬 통합과 자동 테스트만 포함하며 배포나
외부 데이터 변경은 포함하지 않는다.

# 공주 달 관찰 탐험대 — 교사 Google Drive형

공주시 초등 과학 수업용 달 관찰 중앙 서비스입니다. 교사는 별도 서버를 배포하지 않고 Google 계정을 한 번 연결합니다. 학생은 교사가 발급한 QR로 입장하여 로그인 없이 사진과 관찰 기록을 제출합니다.

## 저장 구조

```text
학생 브라우저
  └─ 중앙 Worker API
       ├─ 교사 Google Drive / 관찰 사진
       ├─ 교사 Google Sheets / 제출 목록
       └─ 중앙 D1 / 교사 연결정보와 짧은 임시 식별표만
```

새 제출의 학생 사진·번호·이름·관찰 시각·메모는 중앙 D1/R2에 장기 저장하지 않습니다. 제출 처리 중 서버 메모리를 통과한 뒤 교사 소유 Drive와 Sheets에만 기록됩니다.

중앙 D1에는 다음만 남습니다.

- 교사 Google 계정 표시정보
- AES-GCM으로 암호화한 refresh/access token
- 앱이 만든 Drive 폴더·사진 폴더·스프레드시트 ID
- 학급명과 학생 초대 토큰
- 학생 PII가 없는 24시간 중복 방지표
- 학생 PII가 없는 1시간 속도 제한표
- 학생 PII가 없는 30분 이미지 전달표

## Google 권한

요청하는 OAuth scope는 정확히 하나입니다.

```text
https://www.googleapis.com/auth/drive.file
```

Drive 전체 권한, Drive 읽기 전용 권한, Sheets 전체 권한, Gmail 권한, OpenID·프로필·이메일 scope를 요청하지 않습니다. 앱이 직접 만든 폴더·사진·스프레드시트만 관리합니다.

## 운영자 최초 설정

1. 배포 주소의 `/operator`에 기존 `ADMIN_PASSWORD_HASH`의 원문 비밀번호로 로그인합니다.
2. Google Cloud 프로젝트에서 Google Drive API와 Google Sheets API를 활성화합니다.
3. OAuth 동의 화면에 `drive.file`만 등록하고 개인정보처리방침 URL `/privacy`를 설정합니다.
4. OAuth 클라이언트 유형을 **웹 애플리케이션**으로 만듭니다.
5. `/operator`에 표시되는 `/api/google/callback` 전체 주소를 승인된 리디렉션 URI로 등록합니다.
6. 클라이언트 ID와 클라이언트 보안 비밀번호를 `/operator`에 저장합니다.
7. 전환 전 D1/R2 학생자료가 있다면 같은 화면에서 한 번 영구 삭제합니다.

OAuth 클라이언트 보안 비밀번호는 `SESSION_SECRET`에서 파생한 키로 암호화되어 D1에 저장됩니다. 실제 값은 GitHub에 커밋하지 않습니다.

## 교사 사용 순서

1. `/admin`에서 **Google Drive 연결하기**를 누릅니다.
2. Google 동의 화면에서 앱 전용 파일 권한을 승인합니다.
3. 교사 Drive에 다음 구조가 자동 생성됩니다.

```text
달 관찰 탐험대/
├─ 관찰 사진/
└─ 달 관찰 제출 기록 (Google Sheets)
```

4. 관리 화면에서 학급명을 입력하고 학생 QR을 인쇄합니다.
5. 제출 기록은 관리 화면 또는 교사 Drive/Sheets에서 확인합니다.
6. 연결 해제 시 중앙 토큰과 교사 설정은 삭제되며 Drive 자료는 교사에게 남습니다.

## 주요 경로

- `/` 학생 달 관찰 화면
- `/join?t=...` 학생 QR 입장
- `/admin` 교사 Google Drive 연결·QR·제출 관리
- `/operator` 중앙 서비스 OAuth 설정·이전 중앙자료 삭제
- `/privacy` 개인정보 처리 안내
- `/data-deletion` 연결 및 자료 삭제 안내
- `/api/health` D1 migration과 OAuth 설정 상태 확인

## 개발 명령

- `npm run build:static`: 학생 화면용 Tailwind CSS 생성
- `npm run lint`: 정적 검사
- `npm run build`: vinext/Cloudflare Worker 빌드
- `npm run deploy`: 로컬에서 Cloudflare Worker로 배포
- `npm test`: 빌드 후 Drive OAuth·중앙 비저장 회귀 검사
- `npm run db:generate`: Drizzle migration 생성

## 배포 환경

- 운영 주소: https://gongju-moon-observation.1226ijs.workers.dev
- 플랫폼: Cloudflare Workers (vinext)
- 자동 배포: `main` 푸시 시 GitHub Actions (`.github/workflows/deploy.yml`)

필수 바인딩·설정:

- D1 `DB` (`wrangler.jsonc`에 연결됨)
- `SESSION_SECRET`: 세션 서명과 OAuth 토큰 암호화용 32바이트 이상 무작위 값
- `ADMIN_PASSWORD_HASH`: `/operator` 로그인 비밀번호 SHA-256 해시

이전 중앙 자료 정리 기능 때문에 기존 R2 `BUCKET` 바인딩은 전환 기간에만 유지합니다. 새 제출 코드는 R2에 쓰지 않습니다.

### GitHub Actions 한 번만 설정

1. Cloudflare 대시보드 → **My Profile** → **API Tokens** → **Create Token**
2. 템플릿 **Edit Cloudflare Workers** 선택 후 토큰 발급
3. GitHub 저장소 → **Settings** → **Secrets and variables** → **Actions**
4. `CLOUDFLARE_API_TOKEN` 시크릿에 토큰 값 저장

이후 `main`에 푸시하면 빌드 후 Worker가 자동으로 갱신됩니다. 앱 시크릿(`SESSION_SECRET` 등)은 Cloudflare Worker에 이미 있으면 유지됩니다.

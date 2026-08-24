# 공주 달 관찰 탐험대

공주시 초등학교 4학년 과학 수업용 달 관찰 웹앱입니다. 학생은 계정을 만들지 않고 교사가 제공한 긴 수업 참여 링크(QR)로 입장하며, 달 모양과 관찰 가능 시간을 확인하고 사진·관찰 기록을 제출할 수 있습니다.

## 구성

- `public/index.html`: 기존 디자인을 유지한 학생용 정적 화면
- `app/join`: 수업 참여 토큰을 HttpOnly 세션 쿠키로 교환
- `app/admin`: 교사용 QR·관찰 기록 관리 화면
- `app/api`: 세션, 제출, 갤러리, 보호된 이미지, 교사용 관리 API
- D1 `DB`: 학생 번호·이름·관찰 시각·메모·상태 등 메타데이터
- R2 `BUCKET`: 이름이 포함되지 않은 UUID 경로의 사진 파일

## 개인정보·안전 설계

- 학생 계정 및 이메일 로그인 없음
- 제출·갤러리·사진 조회는 유효한 수업 세션 필요
- 학생 갤러리에는 마스킹 이름만 반환
- 사진은 비공개 R2에서 Worker를 통해서만 전달
- 업로드 MIME·매직바이트·크기·번호·이름·시각·메모를 서버에서 재검증
- 서버 저장 전 JPEG·PNG·WebP의 EXIF·위치·텍스트 메타데이터 제거
- 기기 세션당 10분 3회, 학급당 1시간 100회 제출 제한
- 요청 UUID 고유 제약으로 중복 저장 방지
- 검색엔진 차단, no-store, no-referrer, nosniff 보안 헤더 적용

## 환경 값

배포 환경에는 다음 값을 설정해야 합니다. 실제 값은 소스에 커밋하지 않습니다.

- `SESSION_SECRET`: 세션 서명용 32바이트 이상의 무작위 값
- `CLASS_INVITE_TOKEN`: 학생 참여 링크에 사용하는 128비트 이상의 무작위 값
- `ADMIN_PASSWORD_HASH`: 교사용 비밀번호의 SHA-256 해시
- `CLASS_ID`: 내부 학급 식별자(기본값 `gongju-4-1`)
- `CLASS_LABEL`: 화면 표시용 학급명(기본값 `4학년 1반`)

## 개발 명령

- `npm run build:static`: Tailwind Play CDN 없이 학생 화면용 `public/app.css` 생성
- `npm run db:generate`: D1 마이그레이션 생성
- `npm run lint`: 정적 검사
- `npm run build`: 정적 CSS와 Cloudflare Worker/Vinext 빌드
- `npm test`: 빌드 후 공개 화면·인증 차단·Blob 업로드 회귀 검사

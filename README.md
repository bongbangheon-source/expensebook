# 차곡 · 개인 가계부

HTML/CSS/JavaScript, Express, Neon PostgreSQL로 만든 개인용 가계부입니다. 데이터는 Neon에만 저장하며 localStorage를 사용하지 않습니다. 날짜별 검색, 월별 합계, 카테고리별 합계와 막대그래프, 지출 추가·수정·삭제를 제공합니다. 날짜 필터를 적용해도 요약과 그래프는 선택한 월 전체를 표시합니다. 금액은 정수 원 단위입니다.

## 로컬 실행

1. Node.js 22 이상을 설치합니다.
2. `npm install`을 실행합니다. PowerShell에서 실행 정책 오류가 나면 `npm.cmd install`을 사용합니다.
3. `.env.example`을 `.env`로 복사합니다.
4. Neon 콘솔에서 프로젝트를 만들고 Connect의 연결 문자열을 `.env`의 `DATABASE_URL`에 입력합니다. `sslmode=require`를 유지합니다. `APP_PASSWORD`에는 충분히 긴 임의의 비밀번호를 설정합니다.
5. `npm start` (PowerShell: `npm.cmd start`)로 실행하고 http://localhost:3000 에 접속합니다. 개발 중 자동 재시작은 `npm run dev`를 사용합니다.

최초 인증된 데이터 요청 때 `expenses` 테이블이 자동 생성됩니다. DB 역할에 해당 스키마의 테이블 생성 권한이 필요합니다. 실제 Neon 접속 정보가 있어야 저장·조회 기능을 사용할 수 있습니다. `.env.example`의 예시 값은 실제 접속 정보가 아닙니다.

## GitHub 및 Vercel 배포

1. 이 폴더를 Git 저장소로 만들고 GitHub의 새 비공개 저장소에 올립니다. `.env`와 `node_modules`는 올리지 않습니다. `package-lock.json`은 포함합니다.
2. Vercel에서 해당 GitHub 저장소를 Import합니다. Framework Preset은 **Other**, 프로젝트 루트는 이 폴더로 지정합니다. Build Command와 Output Directory의 사용자 지정은 비워 둡니다. Install Command는 `npm ci`를 사용할 수 있습니다.
3. Vercel 프로젝트 Settings → Environment Variables에서 `DATABASE_URL`과 `APP_PASSWORD`를 설정합니다. 필요한 Production/Preview 환경 각각에 설정하고 배포합니다. 이후 환경변수를 변경하면 재배포합니다.
4. `vercel.json`이 요청을 `api/index.js`의 Express 앱으로 전달합니다. 정적 파일도 Express에서 제공합니다. 프런트엔드에 DB 연결 문자열을 넣지 마세요.

## 인증과 보안

- 모든 지출 API와 통계는 인증이 필요합니다. 비밀번호는 서버 환경변수로만 읽습니다.
- 서명된 HttpOnly, SameSite=Strict 쿠키를 사용하며 12시간 후 만료됩니다. Vercel에서는 Secure 쿠키를 사용합니다. 비밀번호를 바꾸면 기존 세션도 무효화됩니다.
- 로그인에는 IP 기준 시도 제한이 있습니다. 서버리스 메모리 제한이므로 여러 인스턴스에 걸친 전역 차단을 보장하지는 않습니다. 공개 운영에서 강한 공격 방어가 필요하면 Vercel 방화벽이나 공유 저장소 기반 제한을 추가하세요.
- 입력 검증, 매개변수화 SQL, Helmet 보안 헤더, 교차 사이트 변경 요청 차단을 적용합니다. DB 오류 상세와 접속 정보는 응답에 포함하지 않습니다.
- 한 명이 사용하는 공용 비밀번호 방식입니다. 사용자별 계정·데이터 분리는 제공하지 않습니다. 쿠키 복제본은 만료나 비밀번호 변경 전까지 유효합니다.

## 검증

`npm test`는 실제 네트워크나 DB 없이 HTTP 인증, 쿠키 속성, 유효성 검사와 비밀 정보 비노출을 확인합니다. 실제 Neon CRUD 및 Vercel 배포 검증에는 해당 서비스 환경변수가 필요합니다.

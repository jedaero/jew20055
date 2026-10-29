# 동의대학교 라이프복지학과 웹 앱

기존 학과 소개와 대학 생활 갤러리에 ORBIT BREAKER 우주 게임을 통합한 정적 웹 앱입니다. 학과 홈페이지는 `/`, 갤러리는 `/campus.html`, 사진첩·질문과 답변은 `/community.html`, 게임은 `/game/`에서 열립니다. 사진첩과 질문·답변은 Firebase Realtime Database를 사용합니다.

## 사진첩 · 질문과 답변 (`community.html`)

- **사진 올리기**: 관리자(교수) 계정으로 로그인했을 때만 보입니다. 사진은 브라우저에서 먼저 줄인 뒤 저장합니다.
  - 큰 사진: 긴 변 1024px 이하, 약 90KB 이하 (WebP, 지원하지 않는 브라우저는 JPEG)
  - 썸네일: 긴 변 320px, 약 15KB 이하
  - 1GB 무료 용량 기준으로 약 7,000장까지 저장할 수 있습니다.
- **전송량 절약**: 목록에는 썸네일만 12장씩 불러오고, 큰 사진은 눌렀을 때만 불러옵니다. 질문은 10개씩 불러옵니다.
- **질문과 답변**: 누구나 질문을 남길 수 있고, 남긴 질문은 고치거나 지울 수 없습니다. 답변·수정·삭제는 관리자만 할 수 있습니다.
- **데이터 위치**: `gallery/meta`(사진 정보), `gallery/thumbs`(썸네일), `gallery/full`(큰 사진), `qna`(질문과 답변)
- **관리자 UID**: `database.rules.json`과 `community-src/firebase.js`에 적힌 UID가 같아야 합니다.

### 처음 한 번 설정할 것

1. Firebase Console → Authentication → 로그인 방법에서 **Google**을 사용 설정합니다.
2. Authentication → 설정 → **승인된 도메인**에 Vercel 주소(예: `xxx.vercel.app`)를 추가합니다.
3. Vercel 프로젝트 → Settings → Environment Variables에 `.env.example`의 `VITE_FIREBASE_…` 값을 입력하고 다시 배포합니다.
4. `database.rules.json`을 Firebase Console → Realtime Database → 규칙 탭에 붙여넣고 게시합니다.
5. 예전 게임 페이지용 `photos`, `questions` 데이터가 있으면 더 이상 쓰지 않으므로 Console에서 삭제해 용량을 비웁니다.

## 로컬 실행

Node.js와 pnpm을 설치한 뒤 저장소 루트에서 실행합니다.

```powershell
pnpm install
pnpm dev
```

Firebase 웹 설정은 로컬 `.env.local`에서 읽습니다. `.env.example`을 복사해 실제 Firebase 웹 앱 값과 관리자 UID를 입력하세요. `.env.local`은 Git에 올라가지 않도록 제외되어 있습니다.

## 빌드

```powershell
pnpm build
```

Vite가 홈페이지, 갤러리, 게임을 `dist/`로 빌드하고 `images/`의 기존 사진을 결과물에 복사합니다.

## Firebase Hosting 배포

기본 Firebase 프로젝트는 `project-1496496417088680513`입니다. Firebase CLI에 로그인한 뒤 빌드하고 Hosting만 배포합니다.

```powershell
pnpm dlx firebase-tools login
pnpm build
pnpm dlx firebase-tools deploy --only hosting
```

Firebase Realtime Database Rules는 `database.rules.json`에 있습니다. 사진첩·질문과 답변 기능을 추가하면서 Rules가 바뀌었으므로 다시 게시해야 합니다. Console 규칙 탭에 붙여넣거나 다음 명령을 사용하세요.

```powershell
pnpm dlx firebase-tools deploy --only database
```

Firebase Hosting 주소는 `https://project-1496496417088680513.web.app/` 형태로 제공됩니다. GitHub Pages의 기존 주소는 계속 유지되며, Firebase 배포는 별도의 Hosting 주소에서 서비스됩니다.

## GitHub Pages 참고

원본 HTML과 이미지 디렉터리는 유지됩니다. `https://jedaero.github.io/jew20055/` 경로에 게임까지 제공하려면 다음 명령으로 GitHub Pages 경로 기준 빌드를 만든 뒤 `dist/` 내용을 배포해야 합니다.

```powershell
pnpm build:github
```

Firebase Hosting에서는 기본 `pnpm build`를 사용합니다. 두 배포 대상은 경로 기준이 다르므로 빌드를 다시 실행한 뒤 각 호스팅 대상에 배포하세요.

## 사진 안내

갤러리의 일부 이미지는 AI 생성 참고 이미지이며 페이지에 별도로 표시합니다. 실제 행사 사진은 사용 허가를 확인한 뒤 게시하세요.

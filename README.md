# 동의대학교 라이프복지학과 웹 앱

기존 학과 소개와 대학 생활 갤러리에 ORBIT BREAKER 우주 게임을 통합한 정적 웹 앱입니다. 학과 홈페이지는 `/`, 갤러리는 `/campus.html`, 게임은 `/game/`에서 열립니다. 사진과 질문·답변은 Firebase Realtime Database를 사용합니다.

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

Firebase Realtime Database Rules는 `database.rules.json`에 있습니다. 이 프로젝트의 Rules는 이미 Firebase Console에 게시되어 있습니다. Rules를 바꾼 경우에만 다음 명령을 사용하세요.

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

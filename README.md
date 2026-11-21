# project_auto_qa

웹에서 구동되는 TV 앱을 Figma 디자인(GUI·UI/UX)과 비교하고, 리모컨 조작으로 동작을 검수해 불일치를 리포트하는 AI 기반 자동 QA 서비스입니다.

## 요구 사항

- Node.js 22 (`.nvmrc`)
- pnpm 10 (`corepack enable`로 사용 가능)
- Docker (PostgreSQL 실행용)

## 시작하기

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up      # PostgreSQL
pnpm check      # lint + format + typecheck + test
```

## 구조

```
apps/        실행 애플리케이션 (web, api, runner, figma-plugin) — 단계별로 추가
packages/    공유 라이브러리 (core 등)
fixtures/    정답 결함이 심어진 샘플 TV 앱, Figma 샘플 데이터
```

자세한 설계와 로드맵은 claude.ai 프로젝트 문서(`docs/01-설계.md`, `docs/03-로드맵.md`)를 참고하세요. 개발 규칙은 [CLAUDE.md](./CLAUDE.md)에 있습니다.

# project_auto_qa

웹 기술로 만든 TV 앱을 **실제 TV(webOS)**에서 리모컨으로 조작하며 검수하는 AI 기반 자동 QA 서비스입니다. 프로젝트의 TC 엑셀을 실행해 결과와 설명을 엑셀에 기록하고, 화면을 Figma 디자인(GUI)·화면설계서(UI/UX)와 비교해 불일치를 리포트합니다. 검수용 AI는 로컬 LLM만 씁니다.

## 요구 사항

- Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`)
- 실기기 검수: 개발자 모드를 켠 webOS TV, TV와 같은 네트워크의 PC, webOS CLI(`npm install -g @webos-tools/cli`)
- Docker (PostgreSQL 실행용, 서비스 단계부터)

## 시작하기

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm check            # lint + format + typecheck + test
```

실제 TV 연결은 [spikes/p0-6-device/README.md](./spikes/p0-6-device/README.md)를 따라 진행합니다.

## 구조

```
apps/        실행 애플리케이션 (agent, web, api, runner, figma-plugin) — 단계별로 추가
packages/
  core/          공통 타입·순수 함수 (기하, 리모컨 키, 드라이버 인터페이스, 페이지 스크립트 규칙)
  device-webos/  webOS 실기기 드라이버 (ares, SSAP, Web Inspector CDP)
  browser/       브라우저 시뮬레이터 드라이버 (Playwright)
  focus/         포커스 판별 어댑터·자동 탐지 (실기기·시뮬레이터 공용)
fixtures/    정답 결함이 심어진 샘플 TV 앱 (브라우저·TV 설치 모두 가능)
spikes/      기술 검증 스파이크 (P0-2 시뮬레이터, P0-6 실기기)
```

자세한 설계와 로드맵은 claude.ai 프로젝트 문서(`docs/01-설계.md`, `docs/03-로드맵.md`)를 참고하세요. 개발 규칙은 [CLAUDE.md](./CLAUDE.md)에 있습니다.

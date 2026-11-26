# CLAUDE.md

이 저장소는 **웹 기술로 만든 TV 앱(React+Java)을 실제 TV(webOS)에서 TC 엑셀·Figma(화면설계서·GUI) 기준으로 리모컨 조작하며 검수하는 AI 기반 자동 QA 서비스**다. 브라우저 실행은 TV 없이 개발·CI에 쓰는 시뮬레이터다 (D-020).

## 문서 (claude.ai 프로젝트에 있음)

작업 전에 관련 부분을 확인한다.

- `docs/01-설계.md` — 시스템 구조, 공통 모델, 핵심 설계
- `docs/02-개발지침.md` — 이 파일의 원본
- `docs/03-로드맵.md` — Phase별 작업과 완료 기준
- `docs/04-결정로그.md` — 결정(D-030~)과 미결 사항(Qxx). D-001~D-029는 `docs/04-결정로그-이전.md`
- `docs/05-Figma-분석.md`, `docs/06-대상앱-분석.md`, `docs/07-TC-분석.md` — 실제 입력 분석

## 기본 원칙

1. **판정은 결정적 코드가 한다.** AI는 매칭 보조, 시각 판단, 설명에만 쓴다. AI 결과에는 confidence와 근거를 붙인다.
2. **재현성이 최우선이다.** 같은 입력이면 같은 결과가 나와야 한다. 고정 sleep 대신 안정화 대기를 쓴다.
3. **정확도는 측정한다.** `fixtures/sample-tv-app`의 정답 결함 목록으로 검출률·오탐률을 측정한다.
4. **수치는 설정으로 뺀다.** 허용 오차, 탐색 예산, 심각도 가중치는 하드코딩하지 않는다.
5. **앱마다 다른 구현은 프로젝트 프로필 + 어댑터로 분리한다** (D-014). TC 엑셀 형식도 TC 프로필로 분리한다 (D-021).
6. **설계를 바꿀 땐 먼저 결정로그에 기록한다.**

## 명령어

```bash
pnpm install          # 의존성 설치
pnpm check            # lint + format + typecheck + test (커밋 전 필수)
pnpm test             # Vitest
pnpm typecheck        # 패키지별 tsc --noEmit
pnpm sample:verify    # 샘플 앱 정답 결함 재현 확인 (Chrome)
pnpm spike:focus      # P0-2 포커스 판별 (브라우저 시뮬레이터)
pnpm spike:device     # P0-6 실기기 연결 (spikes/p0-6-device/README.md)
pnpm spike:tc-run     # P0-8 TC 실행 → 사본 엑셀 맨 뒤 열 (spikes/p0-8-e2e/README.md)
pnpm db:up            # PostgreSQL 실행 (docker compose)
```

## 코드 구조 규칙

- `packages/core`는 외부 의존성 없이 타입과 순수 함수만 둔다 (리모컨 키, 드라이버 인터페이스, 페이지 스크립트 규칙 포함).
- 부수 효과(브라우저, TV, DB, 네트워크, 파일)는 패키지 경계에 모으고, 비교·매칭·검사 로직은 순수 함수로 작성한다.
- 의존 방향을 역행하지 않는다: `core` ← 기능 패키지 ← `explorer` ← `runner`/`api` ← `web`
- 실기기(`device-webos`)와 시뮬레이터(`browser`) 드라이버는 같은 `Driver` 인터페이스를 구현한다. 그 위의 패키지는 실행 환경을 모른다.
- **TV 안에서 실행되는 페이지 스크립트는 ES2017 문법만 쓴다** (webOS 5.x = Chromium 68. `?.`·`??`·객체 전개 금지). `pageExpression()`으로 감싸고, acorn으로 파싱하는 테스트를 둔다.
- 검사 규칙 하나 = 파일 하나. 각 규칙은 `id`, `category`, `defaultSeverity`, `check()`를 갖는다.
- 외부 서비스(Figma, LLM, TV)는 인터페이스 뒤에 두고, 테스트에서는 녹화된 응답(fixture)이나 가짜 서버(`@auto-qa/device-webos/testing`)를 쓴다.
- 파일 저장은 `BlobStore` 인터페이스를 통한다 (기본 구현: 로컬 파일 시스템, D-016).

## 테스트 규칙

- 테스트 파일은 같은 폴더에 `*.test.ts`로 둔다.
- 새 검사 규칙은 통과 케이스 + 실패 케이스를 반드시 포함한다.
- 새로 잡게 된 결함 유형은 `sample-tv-app`에도 결함으로 추가하고 정답 목록을 갱신한다.

## 보안

- 토큰·키는 `.env`에만 둔다. `.env.example`만 커밋한다. TV 개발자 모드 passphrase는 저장하지 않고, SSAP 페어링 키는 `.data/`(커밋 안 함)에만 둔다.
- 업로드된 코드는 Docker 컨테이너 안에서 격리해 빌드한다.
- 검수용 AI는 로컬 LLM만 쓴다. TC·화면·Figma·소스코드를 외부 AI API로 보내지 않는다 (D-026). Ollama는 외부에 열지 않는다.

## Git

- `main` 보호. 작업 브랜치: `feat/…`, `fix/…`, `spike/…`
- 커밋: Conventional Commits (`feat(core): …`)
- PR은 작게, 한 로드맵 항목 위주로. PR 설명에 로드맵 항목 번호(예: P0-6)를 적는다.

## 작업 방식

- 한 번에 로드맵 항목 하나만 다룬다.
- 설계와 다르게 구현해야 하면 코드보다 이유와 대안을 먼저 제시한다.
- 작업이 끝나면 로드맵 체크 상태와 결정로그 갱신 필요 여부를 알린다.
- 응답은 한국어 존댓말.

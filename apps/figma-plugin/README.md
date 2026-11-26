# Auto QA 내보내기 (Figma 플러그인)

Figma에서 선택한 프레임의 **노드 트리(위치·크기·숨김·칠·테두리·글자 스타일·컴포넌트·프로토타입 연결)와 프레임 PNG**를 JSON 한 파일로 저장합니다 (D-009). REST API 호출 제한과 무관하게 Figma 안에서 실행됩니다.

- 네트워크를 쓰지 않습니다 (`manifest.json`의 `networkAccess: none`). 파일은 이 PC에만 저장됩니다.
- 값은 가공하지 않고 담습니다. 숨김·경계 밖 제외, 반복 요소 묶기, 포커스 요소 추정은 `@auto-qa/figma`가 합니다. 규칙이 바뀌어도 다시 내보낼 필요가 없습니다.

## 설치 (처음 한 번, Figma 데스크톱 앱)

1. 플러그인 빌드: 저장소에서 `pnpm install && pnpm figma:build` (또는 전달받은 압축 파일을 풀어 씁니다)
2. Figma 데스크톱 앱 → 메뉴 **Plugins → Development → Import plugin from manifest…** → 이 폴더의 `manifest.json` 선택

개발용 플러그인은 브라우저판 Figma에서는 가져올 수 없습니다. 데스크톱 앱을 써 주세요.

## 사용

1. 내보낼 프레임을 선택합니다 (여러 개 가능). 선택이 없으면 현재 페이지의 최상위 프레임 전체를 내보냅니다.
   - GUI: 포커스 상태 스냅샷 프레임 (예: `Top 10 01`)
   - 화면설계서: 화면 페이지 프레임 (예: `4.1. Search Field …`)
2. **Plugins → Development → Auto QA Export** 실행 → 목록 확인 → **JSON으로 내보내기**
3. `<파일 이름>-auto-qa-<시각>.json` 파일이 저장됩니다. PNG 배율은 기본 1x입니다 (1920×1080 프레임 = 1920×1080 PNG).

## 결과 확인

```bash
pnpm spike:figma <내보낸 파일.json>   # spikes/p0-5-figma/out/<이름>/report.html
pnpm spike:figma --sample            # 합성 데이터로 리포트 형식 확인
```

리포트는 프레임 PNG 위에 반복 묶음(색 점선), 포커스 추정 요소(빨강), 다른 후보(주황)를 겹쳐 보여 주고, 기대 포커스 스타일(확대 배율·테두리)과 근거, 글자 분류(고정·예시 데이터·순번), 앵커를 나열합니다.

화면설계서 프레임(화면 ID 글자 `4.1. …`이 있는 프레임)은 `@auto-qa/spec`으로 구조를 뽑아 함께 보여 줍니다: 화면 번호·제목·상위 화면·쪽 번호·버전 이력, 진입 조건과 Default Focus, 목업 배율, 콜아웃(목업 마커 → 가리키는 요소 → 화면 좌표, 설명의 방향키 동작), 추가 설명, 음성 안내(보류).

**내보낸 JSON과 리포트에는 디자인 내용이 들어 있으므로 커밋하지 않습니다** (`.gitignore`: `*-auto-qa-*.json`, `spikes/*/out/`).

## 구조

| 파일                       | 역할                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `src/code.ts`              | Figma 샌드박스에서 실행: 대상 프레임 결정, 노드 직렬화, PNG 생성                    |
| `src/serialize.ts`         | Figma 노드 → 내보내기 형식 (`@auto-qa/figma/format`). `figma` 전역 없이 테스트      |
| `src/ui.ts`, `src/ui.html` | 목록·옵션 UI, PNG base64 변환, JSON 파일 내려받기                                   |
| `build.mjs`                | esbuild로 ES2017 한 파일씩 빌드 (`dist/code.js`, UI 스크립트를 넣은 `dist/ui.html`) |

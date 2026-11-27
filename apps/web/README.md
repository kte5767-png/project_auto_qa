# 사용자 UI 1차 (`@auto-qa/web`)

UX Pilot 시안(대시보드 · 새 검수 · 검수 중 · 결과)을 판넬 톤으로 옮긴 화면입니다 (D-041, 기획 고정 D-044).
로컬 PC에서만 열립니다(127.0.0.1:8093). 회사 자료는 이 PC 밖으로 나가지 않습니다.

## 실행

```powershell
# 대상 앱은 다른 창에서 (예: lg_travel_service_app → npm run serve, localhost:8091)
pnpm web            # http://127.0.0.1:8093
```

- **새 검수**: TC 엑셀 경로(이 PC의 절대 경로), UX 시나리오(화면설계서) 폴더, 앱 프로필, 앱 주소를 넣고 시작합니다. 내부적으로 `spikes/p0-8-e2e/tc.ts`를 실행합니다(명령줄 `pnpm spike:tc-run`과 같음). 입력값은 `spikes/p0-8-e2e/out/web-settings.json`에 저장돼 다음에 그대로 채워집니다.
- **검수 중**: 실행이 단계마다 쓰는 `progress.json`과 캡처를 1.5초마다 읽어 진행률, 단계 목록, 최근 캡처·리모컨 키, 실패·확인 필요(바로 확인), 실행 로그를 보여 줍니다.
- **결과**: 통과·실패·확인 필요·미실행, 확인 필요 항목 확정(통과/실패, `decisions.json`에 저장 — TC 파일은 바꾸지 않음), 단계 격자, 실패 항목, 단계 상세(앱 캡처, 조건별 판정, Issue Detail에 쓴 설명, 리모컨 입력 경로), 결과 TC 엑셀 내려받기.
- 명령줄로 실행한 결과도 `spikes/p0-8-e2e/out/tc-*`에 있으면 그대로 보입니다.

## 구조

- `server/api.ts`: Vite 개발 서버 안의 로컬 API (`/api/runs`, `/api/run`, `/api/live`, `/api/stop`, 캡처·TC 파일 제공). 실행 폴더 이름·파일 이름만 받아 경로 밖으로 나가지 않습니다.
- `src/pages/*`: 화면 4개. `src/styles.css`: 판넬 색(네이비 #0B2559, 블루 #1E4C8F, 라이트 #DCE6F3)·글꼴(Paperlogy, Pretendard).

## 아직 없는 것 (시안에는 있음)

GUI 디자인 비교(화면설계서/Figma ↔ 앱 캡처 나란히, 조건별 px 비교)와 AI 설명은 별도 기능으로 뒤에 붙입니다(D-044). TV 실기기 실행은 P0-6 뒤.

# P0-2 포커스 판별 + 프로필 탐지 스파이크

방향키를 누르며 각 포커스 어댑터가 "지금 포커스된 요소"를 얼마나 정확히 찾는지, 그리고 포커스 방식을 자동으로 알아내는지 확인합니다.

## 실행

```bash
pnpm install
pnpm spike:focus                                   # 샘플 앱 (spotlight, class 두 방식, 정답으로 채점)
pnpm spike:focus --url http://localhost:8091       # 실제 앱 (정답 없음 → 리포트로 사람이 확인)
```

- 브라우저: `CHROME_PATH` 환경 변수 → 설치된 Chrome → Playwright Chromium 순으로 찾습니다.
- 옵션: `--keys "RIGHT*4 DOWN*3 …"`(기본 20회), `--modes spotlight,class`, `--out <폴더>`, `--headed`(창 띄우기)
- 결과: `out/report.html`(단계별 스크린샷 + 어댑터별 판단 상자), `out/results.json`

측정 흐름과 리포트는 `spikes/shared`에 있으며, 실기기 스파이크(`spikes/p0-6-device`)도 같은 흐름을 씁니다. 드라이버만 브라우저(`BrowserDriver`)와 TV(`WebOsDriver`)로 다릅니다.

## 하는 일

1. **자동 탐지**: 방향키 5번(↓ → → ← ↑)을 누르며 상태를 모아 어댑터 후보를 신뢰도 순으로 냅니다.
2. **정확도 측정**: 페이지를 다시 열고 방향키 20번을 누르며, 단계마다 어댑터 4개의 판단을 기록합니다.
   - `enact-spotlight`: 실제 DOM 포커스가 `.spottable` 요소에 있을 때
   - `active-element`: `document.activeElement`
   - `selector`: 탐지된 포커스 클래스(예: `.focused`)
   - `style-diff`: 키 입력 전후로 강조 스타일(확대, 테두리, 그림자, 밝은 배경 등)이 생긴 요소
3. **채점**: 샘플 앱은 정답과 비교합니다. 실제 앱은 정답이 없으므로 1순위 후보와 다른 어댑터의 일치율을 보여주고, 리포트에서 사람이 확인합니다.

## 실제 앱 확인 방법

1. 대상 앱을 `npm run serve`로 띄웁니다 (`http://localhost:8091`).
2. `pnpm spike:focus --url http://localhost:8091`을 실행합니다.
3. `out/report.html`을 열어 20개 스크린샷에서 **1순위 어댑터 상자가 실제 포커스 위치와 맞는지** 셉니다. 19개 이상 맞으면 완료 기준(95%)을 만족합니다.

## 결과 (2026-11-21, 샘플 앱)

| 대상           | 탐지 1순위                  | enact-spotlight | active-element | selector | style-diff |
| -------------- | --------------------------- | --------------- | -------------- | -------- | ---------- |
| 샘플 spotlight | enact-spotlight (100%) ✓    | 20/20           | 20/20          | -        | 20/20      |
| 샘플 class     | selector `.focused` (95%) ✓ | 0/20            | 0/20           | 20/20    | 20/20      |

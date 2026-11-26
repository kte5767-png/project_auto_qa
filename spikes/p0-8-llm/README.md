# P0-8 로컬 LLM 비교

같은 케이스를 여러 로컬 모델(Ollama)에 돌려, P0-8에 쓸 모델을 고르기 위한 자료를 만든다 (D-026).
모델은 **하나씩 올리고 끝나면 내린다** — 메모리 16GB 공유(내장 GPU) PC에서도 돌 수 있게.

| 보는 것                  | 뜻                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 판정 정확                | TC 기대 결과 + 관찰(포커스·글자·잘라낸 화면) → pass / fail / uncertain 이 정답과 같은 비율                    |
| 이미지 판정              | 그중 이미지만 보고 판정하는 케이스                                                                            |
| **확신 오답**            | 틀린 pass/fail을 단정한 수 (확인할 수 없는 것을 pass라고 한 경우 포함). 사람이 믿고 넘어가는 오류라 가장 위험 |
| 계획 정확                | TC 단계 + 화면설계서 콜아웃(방향키 동작) → 리모컨 키 순서가 정답과 같은 비율                                  |
| 반복 일치                | 같은 입력을 여러 번 돌렸을 때 판단이 같은 비율 (재현성)                                                       |
| JSON 유효                | 정해진 출력 형식(JSON 스키마)을 지킨 비율                                                                     |
| 응답·토큰/초·로드·메모리 | 속도와 메모리 (Ollama가 알려 주는 값)                                                                         |

## 준비 (Windows)

1. Ollama 설치: <https://ollama.com/download> → 설치 후 `ollama --version` (Qwen3-VL은 0.12.7 이상 필요, 최신 권장)
2. 모델 받기 (기본 비교 대상)
   ```powershell
   ollama pull qwen3-vl:2b-instruct   # 약 1.9GB
   ollama pull qwen3-vl:4b-instruct   # 약 3.3GB
   ollama pull gemma4:e2b
   ollama pull gemma4:e4b             # 약 9.6GB — 16GB 공유 메모리에서는 무거울 수 있음
   ```
   없는 모델은 건너뛰고 리포트에 `ollama pull …` 안내가 나온다.
3. 확인: `pnpm spike:llm --list` (설치된 모델, 기능 vision/thinking, 라이선스, 실행 중 메모리)

## 실행

```powershell
pnpm spike:llm --runs 1          # 먼저 빠르게 (케이스 22개 × 모델마다 1번)
pnpm spike:llm                   # 반복 2회 — 반복 일치까지 본다
pnpm spike:llm --models qwen3-vl:4b-instruct,gemma4:e2b --limit 5
pnpm spike:llm --fake            # Ollama 없이 흐름만 확인 (가짜 모델)
```

결과: `spikes/p0-8-llm/out/<시각>/report.md` (표·케이스별 결과·틀린 답의 근거), `results.json` (전체 기록).
CPU 실행은 느리다 — 이미지가 있는 케이스는 한 번에 수십 초 걸릴 수 있다. 실행 중 남은 시간이 표시된다.

| 옵션                          | 기본                                    | 설명                                                                     |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `--models`                    | qwen3-vl 2b·4b instruct, gemma4 e2b·e4b | 쉼표로 구분                                                              |
| `--cases`                     | `cases/sample.json`                     | 여러 번 줄 수 있음                                                       |
| `--runs`                      | 2                                       | 같은 케이스 반복 횟수                                                    |
| `--think`                     | off                                     | 생각(추론) 모드: off / on / default(모델 기본). 지원하는 모델에만 보낸다 |
| `--tasks`                     | judge,plan                              | 한쪽만 보려면 `judge` 또는 `plan`                                        |
| `--limit`                     | 없음                                    | 앞에서부터 케이스 N개만                                                  |
| `--num-ctx` / `--num-predict` | 4096 / 512                              | 컨텍스트·최대 출력 토큰                                                  |
| `--host`                      | `OLLAMA_HOST` 또는 `127.0.0.1:11434`    | 내부망 GPU PC를 쓸 때 (아래 보안 참고)                                   |
| `--timeout`                   | 600                                     | 요청 하나의 최대 초                                                      |
| `--keep`                      | 끔                                      | 모델을 내리지 않음                                                       |

## 샘플 케이스 (`cases/sample.json`)

합성 케이스 22개 — **비교 도구가 도는지 확인하는 용도**이고, 모델 선정은 실제 TC로 만든 케이스로 한다.

- 판정(글자) 9개: 포커스 위치, 문구, 개수, 화면 전환, 그리고 관찰할 수 없는 기대 결과(소리·애니메이션 → `uncertain`이 정답)
- 판정(이미지) 6개: 샘플 TV 앱에서 결함을 켠 화면/끈 화면을 같은 위치로 잘라 만든 짝 — 포커스 테두리, 플레이스홀더 문구, 설명 말줄임 (`pnpm --filter @auto-qa/spike-p0-8-llm images`로 다시 만들 수 있음)
- 계획 7개: 합성 검색 화면의 콜아웃 방향키 동작으로 키 순서 만들기

## 실제 TC로 케이스 만들기

회사 TC·화면이 들어가므로 파일 이름을 `*.local.json`으로 하면 커밋되지 않는다 (예: `cases/search.local.json`).

```json
{
  "format": "auto-qa-llm-cases",
  "version": 1,
  "cases": [
    {
      "id": "4.1-01",
      "task": "judge",
      "expected": "TC의 기대 결과 문장",
      "observation": {
        "screen": "검색",
        "focus": "① Search field",
        "texts": ["화면에 보이는 글자"],
        "note": "추가 설명"
      },
      "images": ["images/잘라낸화면.png"],
      "answer": { "verdict": "pass" }
    },
    {
      "id": "4.1-02",
      "task": "plan",
      "step": "TC의 조작 문장",
      "screen": {
        "name": "4.1 Search",
        "focus": "① Search field",
        "callouts": [{ "no": "①", "label": "Search field", "keys": { "down": "② 추천 키워드로 이동" } }]
      },
      "answer": { "keys": ["DOWN"] }
    }
  ]
}
```

- `answer`는 사람이 정한 정답이다. `verdict`: `pass` / `fail` / `uncertain`(화면으로 확인할 수 없음), `keys`: `UP DOWN LEFT RIGHT OK BACK HOME`
- `images`는 케이스 파일 기준 상대 경로. 확인 영역만 잘라서 넣는다 (D-026: 작은 모델에는 작은 이미지)
- 콜아웃의 방향키 동작은 화면설계서 추출 결과(`@auto-qa/spec`의 `description.keys`)를 그대로 옮기면 된다

## 보안 (D-026)

- 검수 자료는 로컬 LLM에만 보낸다. 이 도구는 **이 PC(localhost)와 사설 IP(10.x, 172.16~31.x, 192.168.x)** 주소만 받고 그 밖은 거부한다.
- 내부망 GPU PC를 이름으로 쓸 때만 `--allow-host 이름`을 준다.
- 그 PC에서 Ollama를 다른 PC에 열 때(`OLLAMA_HOST=0.0.0.0`)는 방화벽으로 내부망에서만 접속되게 한다. 인터넷에 열지 않는다.
- `out/`(결과)와 `*.local.json`(실제 케이스)은 커밋되지 않는다.

## 문제 해결

- `Ollama에 연결하지 못함` → Ollama 앱이 실행 중인지(작업 표시줄 아이콘) 또는 `ollama serve`
- `설치되지 않음 — ollama pull …` → 안내대로 받기
- 메모리 부족·멈춤 → 작은 모델부터(`--models qwen3-vl:2b-instruct`), 크롬 등 다른 프로그램 닫기
- 너무 느림 → `--runs 1 --limit 5`로 먼저 확인

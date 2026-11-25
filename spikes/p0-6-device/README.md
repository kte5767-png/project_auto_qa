# P0-6 실기기(webOS) 연결 스파이크

실제 TV에 연결해서 아래 다섯 가지가 되는지 확인합니다 (로드맵 P0-6).

1. ares CLI로 앱 설치·실행
2. SSAP로 리모컨 키 입력 (↑↓←→, OK, Back, Home)
3. 앱 디버거(Inspector)로 포커스 판별 스크립트 실행
4. 앱 화면 캡처와 키 입력 후 안정화 대기
5. 개발자 모드 남은 시간 조회

**완료 기준**: 방향키 20회 포커스 식별 ≥ 95%, 단계별 캡처 성공, webOS 버전이 다른 TV 2대 이상

## 1. 준비 (한 번만)

**PC** (TV와 같은 공유기·네트워크)

```powershell
# 저장소 받고 의존성 설치
git clone https://github.com/kte5767-png/project_auto_qa.git
cd project_auto_qa
corepack enable
pnpm install

# webOS CLI
npm install -g @webos-tools/cli
```

**TV**

1. LG Content Store에서 **Developer Mode** 앱을 설치하고 LG 개발자 계정으로 로그인합니다.
2. **Dev Mode Status**를 켭니다 (TV가 다시 켜집니다).
3. **Key Server**를 켭니다.
4. TV 설정에서 **LG Connect Apps**를 켭니다. 메뉴 이름은 모델마다 다릅니다. "모바일 TV 켜기"나 "외부 장치 연결"일 수 있습니다. SSAP 리모컨 입력에 필요합니다.

**설정 파일**: 프로젝트 루트에 `.env`를 만들고(`.env.example` 복사) 아래 값을 채웁니다.

```
WEBOS_HOST=192.168.0.10        # Developer Mode 앱 화면에 나온 TV IP
WEBOS_DEVICE=tv                # 장치 이름 (TV가 여러 대면 tv1, tv2 …)
WEBOS_APP_ID=                  # 검수할 앱 ID (appinfo.json의 id)
```

개발자 모드 passphrase는 `.env`에 넣지 않습니다. 아래 `setup` 단계에서 직접 입력하며, 저장하지 않습니다.

## 2. 실행 순서

모든 명령은 프로젝트 루트에서 실행합니다.

```powershell
pnpm spike:device doctor        # ① 연결 진단: ares·포트·앱 디버거·엔진 버전
pnpm spike:device setup         # ② ares 장치 등록 + 개발자 모드 키 받기 (TV의 Passphrase 입력)
pnpm spike:device pair          # ③ SSAP 페어링: TV 화면에 뜬 요청에서 "허용"
pnpm spike:device info          # ④ 모델·webOS·엔진 버전 기록
pnpm spike:device devmode       # ⑤ 개발자 모드 남은 시간 (실험적, 아래 참고)
```

**샘플 앱으로 정확도 측정** (정답이 있어 자동 채점됩니다)

```powershell
pnpm spike:device sample-ipk                          # 샘플 앱 ipk 만들기
pnpm spike:device install spikes\p0-6-device\out\ipk\com.autoqa.sampletvapp_0.0.1_all.ipk
pnpm spike:device focus --sample spotlight            # 방향키 20회 (Enact Spotlight 방식)
pnpm spike:device focus --sample class                # 방향키 20회 (CSS 클래스 방식)
```

**실제 대상 앱** (정답이 없으므로 리포트를 보고 사람이 확인합니다)

```powershell
pnpm spike:device install <대상 앱>.ipk
pnpm spike:device keys "RIGHT*3 DOWN OK BACK"         # 키가 도착하는지, 포커스가 어디로 가는지 빠르게 확인
pnpm spike:device focus                               # 방향키 20회 + 단계별 캡처
```

`focus`가 끝나면 `spikes/p0-6-device/out/<장치>-<시각>/report.html`이 생깁니다. 정답이 없는 앱은 리포트에서 단계마다 스크린샷의 실제 포커스와 1순위 상자를 비교합니다. 틀린 단계에 표시하면 정확도가 바로 계산됩니다. 20개 중 19개 이상 맞으면 완료 기준을 만족합니다.

### 옵션

| 옵션                           | 설명                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `--app <ID>`                   | `WEBOS_APP_ID` 대신 쓸 앱 ID                                        |
| `--keys "RIGHT*4 DOWN*3 …"`    | `focus`에서 누를 키 (기본 20회)                                     |
| `--reset relaunch`             | 시작 상태 초기화를 앱 재실행으로 (기본, ares 사용)                  |
| `--reset reload`               | 페이지 다시 열기로 초기화 (더 빠름, 앱 재실행 동작은 확인하지 않음) |
| `--params "{'focus':'class'}"` | `launch`에서 앱 실행 인자                                           |
| `--out <폴더>`                 | 결과 폴더                                                           |

TV가 여러 대면 장치마다 값을 바꿔 실행합니다 (PowerShell 예):

```powershell
$env:WEBOS_DEVICE="tv2"; $env:WEBOS_HOST="192.168.0.11"; pnpm spike:device doctor
```

## 3. 결과 보내 주실 것

- `doctor` 출력 전체 (TV마다)
- `focus` 결과 폴더(`out/<장치>-<시각>/`)를 압축한 파일: `report.html`, `results.json`, 단계별 이미지
- 실제 앱이면 리포트에서 확인한 "사람 확인 정확도"

## 4. 동작 방식

| 통로        | 방식                                                   | 이 스파이크에서                                  |
| ----------- | ------------------------------------------------------ | ------------------------------------------------ |
| 설치·실행   | ares CLI (SSH 9922)                                    | `setup`, `install`, `launch`, 앱 재실행 초기화   |
| 리모컨 입력 | SSAP 웹소켓 (3001 보안 → 3000 일반) + 포인터 입력 소켓 | `pair`, 키 입력 (실제 리모컨과 같은 시스템 경로) |
| 화면 내부   | 앱 디버거 (9998) ← CDP                                 | 포커스 판별, 안정화 대기, 화면 캡처, 콘솔 예외   |

- **키 도착 확인**: SSAP 키는 TV 시스템을 거쳐 앱에 도착합니다. 고정 대기 대신 "앱이 keydown을 받았는지"를 확인합니다. 이를 위해 페이지에 keydown 수를 세는 리스너를 붙이며, 앱 동작은 바꾸지 않습니다. HOME은 시스템이 처리하므로 도착을 확인할 수 없습니다.
- **구형 엔진**: TV 안에서 도는 스크립트는 webOS 5.x(Chromium 68)에서도 돌도록 ES2017 문법만 씁니다. `document.getAnimations`가 없는 엔진(Chromium 84 미만)에서는 전환·애니메이션 이벤트와 더 긴 정지 시간으로 안정 상태를 판단합니다. 리포트에는 "구형 엔진 방식"으로 표시됩니다.
- **페어링 키**: `.data/devices/<장치>.json`에 저장합니다. 이 폴더는 커밋하지 않습니다. passphrase는 저장하지 않습니다.

## 5. 문제 해결

| 증상                                      | 확인할 것                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 9922 닫힘                                 | Developer Mode 앱의 Dev Mode Status. 개발자 모드 세션이 끝나면 꺼집니다                                                    |
| 9998 닫힘 / 앱이 디버거 목록에 없음       | 개발자 모드로 설치한 앱이 실행 중인지 (`launch`)                                                                           |
| 디버거 웹소켓 연결 실패                   | TV 앱에 DevTools 창(ares-inspect, chrome://inspect)이 열려 있으면 닫기. 한 앱에 디버거가 하나만 붙는 엔진이 있습니다       |
| 3001·3000 모두 닫힘                       | LG Connect Apps 설정. 안 되면 `.env`에 `WEBOS_KEY_MODE=cdp`로 진행 (HOME 제외, 시스템 Back 경로는 검증 안 됨)              |
| 페어링은 되는데 리모컨 입력 소켓이 거절됨 | 기본 manifest 권한 부족. `WEBOS_SSAP_MANIFEST`에 다른 manifest JSON 경로를 지정 (결과를 알려 주시면 기본값을 고치겠습니다) |
| "키 도착 안 함"이 많음                    | 앱이 키를 받기 전에 다른 창(시스템 팝업 등)이 떠 있는지. `keys`로 한 키씩 확인                                             |
| 엔진이 Chromium 68 미만                   | webOS 4.x 이하는 지원 범위 밖입니다 (결과는 참고용)                                                                        |

**`devmode` (실험적)**: TV에서 개발자 모드 세션 토큰을 읽어 LG 개발자 사이트의 세션 확인 주소로 남은 시간을 조회합니다. 커뮤니티 도구들이 쓰는 비공식 방식이라 실패할 수 있습니다. 실패하면 TV의 Developer Mode 앱 화면에서 확인해 주세요. 토큰 외의 정보는 보내지 않고, 연장은 하지 않습니다.

## 6. TV 없이 흐름 확인 (개발용)

원격 디버깅 포트를 연 Chrome이 TV 역할을 하는 가짜 TV입니다. SSAP 버튼을 받아 Chrome 페이지 키 이벤트로 넘깁니다.

```bash
pnpm --filter @auto-qa/spike-p0-6-device fake-tv                 # --mode class, --legacy-engine(구형 엔진 흉내)
WEBOS_HOST=127.0.0.1 WEBOS_INSPECTOR_PORT=9998 WEBOS_SSAP_PORT=1 WEBOS_SSAP_PLAIN_PORT=3000 \
  pnpm spike:device focus --sample spotlight --reset reload
```

## 결과

| 날짜       | 대상           | 장치·엔진                   | 키 입력    | 탐지 1순위            | 1순위 정확도 | 키 도착 | 비고                            |
| ---------- | -------------- | --------------------------- | ---------- | --------------------- | ------------ | ------- | ------------------------------- |
| 2026-11-25 | 샘플 spotlight | 가짜 TV (Chrome)            | SSAP(가짜) | enact-spotlight ✓     | 20/20        | 20/20   | 흐름 확인용                     |
| 2026-11-25 | 샘플 class     | 가짜 TV (Chrome)            | SSAP(가짜) | selector `.focused` ✓ | 20/20        | 20/20   | 흐름 확인용                     |
| 2026-11-25 | 샘플 spotlight | 가짜 TV, getAnimations 제거 | SSAP(가짜) | enact-spotlight ✓     | 20/20        | 20/20   | 구형 엔진 방식, 안정화 약 410ms |
| (예정)     | 샘플·실제 앱   | 실제 TV 2대 이상            | SSAP       |                       |              |         | 사용자 PC에서 실행              |

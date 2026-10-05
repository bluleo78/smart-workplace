# Gen:iA Works 제품 소개 자료

고객에게 전달하는 화면 중심 제품 소개 자료(16:9, 17장)를 **현재 코드로 다시 만드는 방법**을 담은 문서입니다. 화면이 바뀌면 이 절차로 다시 촬영하고 PDF를 새로 만듭니다.

## 산출물

| 무엇 | 위치 | 비고 |
| --- | --- | --- |
| 화면 원본 | `docs/intro/deck/shots/*.png` | 데스크톱 2880×1620, 모바일 1170×2532 |
| 표시 좌표 | `docs/intro/deck/shots/boxes.js` | 촬영 때 기록한 요소 위치(원본 px). 번호 표식·잘라 보기가 이 값을 쓴다 |
| 슬라이드 원본 | `docs/intro/deck/index.html` · `deck.css` · `deck.js` | 화면 원본을 잘라 보여 줄 뿐 가공하지 않는다 |
| PDF | `docs/intro/genia-works-intro.pdf` | 배포본. `build-pdf.mjs` 는 `dist/intro/` 에 만들고, 확정한 판만 이 위치로 복사해 커밋한다 |
| 장별 PNG | `dist/intro/png/slide-01~17.png` | 빌드 산출물(커밋하지 않음) |

화면 원본 PNG는 그대로 보관합니다. 다른 문서나 발표에 화면만 따로 쓸 때 이 파일을 씁니다.

## 구성(17장)

| # | 헤드라인 | 화면 |
| --- | --- | --- |
| 1 | 표지 | 홈 |
| 2 | 업무 도구 전부를 한 곳에 | 홈(레일·요약·지금 신경 쓸 일·AI 어시스턴트) |
| 3 | AI도 팀원으로 지정합니다 | 담당자 선택창의 "에이전트" + AI 분류 제안 |
| 4 | 맡기면 AI가 직접 처리합니다 | AI 착수·결과 코멘트 + 이력(상태 변경) |
| 5 | AI에게 맡긴 일을 한눈에 | 내 작업 › AI 위임 작업 |
| 6 | 어디서든 말로 일을 시킵니다 | AI 어시스턴트 패널 + 이슈 채팅 |
| 7 | 대화가 바로 일이 됩니다 | 채널 @멘션 → AI 이슈 제안 → 승인 직후 |
| 8 | 흩어진 맥락은 AI가 정리합니다 | "AI 현황 요약" + "놓친 대화 요약" |
| 9 | 메일은 AI가 먼저 읽고 정리합니다 | 메일 AI 분류 · AI 요약 · AI 답장 초안/이슈 생성 버튼 |
| 10 | 답장도, 할 일 등록도 AI가 초안을 | AI 답장 초안 + 이슈로 만들기(AI 초안) |
| 11 | 계획과 진행을 함께 봅니다 | 사이클 목록 + 타임라인 |
| 12 | 팀의 지식은 노트에, AI가 읽고 일합니다 | 노트(PRD) + PRD 를 읽고 착수한 AI 코멘트 |
| 13 | 파일은 열기 전에 AI 요약부터 | 드라이브 + 미리보기 AI 요약 |
| 14 | 회사 캘린더와 팀 일정을 한 화면에 | 캘린더 주간(Microsoft 365 연동·이슈 마감일) |
| 15 | 휴대폰에서도 같은 업무, 같은 AI | 모바일 홈·채널·AI |
| 16 | 쓰던 AI 도구에서도 같은 업무 공간에 | 개념도 + 설정 › API 토큰 |
| 17 | 관리자가 AI를 통제합니다 | 설정 › 에이전트 + 에이전트 상세 |

## 작성 규칙

**화면에 없는 기능, 코드에 없는 동작을 쓰지 않습니다.** 자료가 고객에게 나가기 때문에 과장이 곧 신뢰 문제가 됩니다.

| 알아야 할 것 | 근거 |
| --- | --- |
| 화면이 있는지 | `apps/workplace-web/src/App.tsx` 라우터 |
| 버튼·메뉴·라벨 문구 | 해당 컴포넌트 소스의 한국어 문구(화면 캡처와 일치해야 함) |
| AI가 무엇을 하는지 | `apps/workplace-ai-agent/src/agent/*system-prompt.ts`, 실제 실행 결과 |
| 외부 도구 연동 범위 | `apps/workplace-mcp/src/tools/index.ts` |

- **AI 결과물은 지어내지 않습니다.** AI 코멘트·요약·제안·초안은 `seed-ai.mjs`와 촬영 스크립트가 사람과 같은 방식으로 요청해 AI가 실제로 만든 것입니다. API로 문구를 직접 넣지 않습니다.
- **AI 표현은 일반 용어로 씁니다.** "AI 에이전트", "외부 AI 도구"처럼 쓰고, 모델·벤더 이름은 화면에 보이는 경우에만 그대로 둡니다.
- 확인한 근거가 없는 효과(시간 단축률 등)는 쓰지 않습니다.
- 운영 데이터를 찍지 않습니다. 가상 회사(누리커머스)와 `example.com` 계정만 씁니다.

## 다시 만들기

### 1. 격리 스택 띄우기

다른 세션이 쓰는 6060·6173·5434 와 겹치지 않게 별도 포트로 띄웁니다. 워크트리에서 작업합니다.

| 구성요소 | 포트 | 띄우는 방법 |
| --- | --- | --- |
| DB | 5444 | `reset-stack.sh` 가 컨테이너 `intro-deck-db`(pgvector/pgvector:pg18)를 새로 만든다 |
| API | 6160 | `./gradlew bootJar -x test` 로 jar 를 만들고 `reset-stack.sh` 가 기동 |
| 웹 | 6273 | `apps/workplace-web/vite.config.ts` 의 `API_PORT` 를 6160 으로 **로컬에서만** 바꾸고 `npx vite --port 6273 --strictPort` |
| AI 에이전트 | 6170 | `pnpm --filter "@smart-workplace/mcp-tools-shared..." build` 후 `apps/workplace-ai-agent` 에서 `PORT=6170 INTERNAL_SERVICE_TOKEN=changeme-local WORKPLACE_API_BASE_URL=http://localhost:6160/api/v1 npx tsx src/index.ts` |
| 문서 처리 워커 | 6180 | `apps/workplace-worker` 에서 `WORKER_BLOB_BASE=<워크트리>/storage-data WORKPLACE_API_BASE_URL=http://localhost:6160 INTERNAL_SERVICE_TOKEN=changeme-local uv run uvicorn app.main:app --port 6180`. API 주소는 루트(`/api/v1` 없음)여야 한다 — 붙이면 추출이 EXTRACTING 에서 멈춘다 |
| 웹(메일·캘린더용) | 6173 | Microsoft 365 OAuth 리다이렉트가 `localhost:6173/oauth/m365/callback` 으로 고정이라, 메일 장면은 6173 웹으로 찍는다(`capture-screens.mjs` 기본값) |

### 메일·캘린더 연결

메일·캘린더 장면은 실제 Microsoft 365 계정을 연결해 찍습니다.

1. `M365_CLIENT_ID` · `M365_TENANT_ID` · `M365_CLIENT_SECRET` 을 환경변수로 넘겨 `start-api.sh` 로 API 를 띄웁니다(값은 운영 Helm values 에 있음, 파일에 남기지 않는다).
2. 6173 웹에서 첫 번째 구성원으로 로그인해 설정 › 메일 계정에서 연결하고, 설정 › AI 비서에서 개인 비서를 켭니다.
3. 시연용 메일을 연결 계정 자신에게 보냅니다. 외부로는 나가지 않습니다.
   ```bash
   INTRO_MAIL_TO=<연결한 메일 주소> node docs/intro/scripts/send-demo-mail.mjs
   ```
   본문이 400자 이하면 AI 요약을 건너뛰므로 시연 메일은 길게 씁니다. 화면은 제목 머리말 `【누리커머스】` 로 검색해 이 메일만 보여 줍니다(검색은 괄호 종류를 가리지 않으니 예전 시연 메일이 남아 있으면 지운다).
4. 동기화·AI 요약이 끝난 뒤 `INTRO_SHOTS_ONLY=mail,calendar node docs/intro/scripts/capture-screens.mjs`.

`reset-stack.sh` 는 DB 를 새로 만들므로 메일 연결도 사라집니다. 전체를 다시 만들면 위 과정을 다시 합니다.

### 2. 한 번에 실행

```bash
JAR=apps/workplace-api/build/libs/workplace-api-0.0.1-SNAPSHOT.jar \
LOG=/tmp/intro-api.log \
INTRO_AI_TOKEN=<AI 에이전트용 Claude 토큰> \
docs/intro/scripts/run-all.sh
```

AI 에이전트용 토큰은 `claude setup-token` 으로 발급합니다. 토큰은 환경변수로만 넘기고 파일에 남기지 않습니다.

`run-all.sh` 는 다음 순서로 실행합니다(약 15분).

1. `reset-stack.sh`: DB 를 비우고 API 를 다시 띄웁니다.
2. `seed-demo.mjs`: 가상 회사 데이터를 넣습니다. 구성원 5명, AI 에이전트 "지니", 프로젝트·이슈·사이클·마일스톤, 채널 대화, 노트, 일정, 연락처, API 토큰이 포함됩니다. AI 에이전트는 프로젝트·채널·노트 스페이스의 멤버로 넣습니다. 멤버가 아니면 해당 자료를 읽지 못해 "찾지 못했다"고 답합니다.
3. 워크스페이스 이름을 "누리커머스"로 바꿉니다. 이름 변경 API 가 없어 DB 를 직접 고칩니다.
4. `seed-ai.mjs`: 지니에게 실제로 일을 시키고 결과를 기다립니다. 이슈 위임 3건, 현황 요약, 이슈 채팅, 채널 @멘션이 포함됩니다.
5. `capture-screens.mjs`: 화면을 촬영합니다. 일부만 다시 찍을 때는 `INTRO_SHOTS_ONLY=home,mobile` 을 씁니다.
6. `build-pdf.mjs`: PDF 와 장별 PNG 를 만듭니다. 검토용 PNG 만 만들 때는 `--png-only` 를 씁니다.

### 3. 확인

- AI 결과물은 실행할 때마다 문구가 달라집니다. 촬영 후 `dist/intro/png/` 을 훑어 어색한 답변이 없는지 봅니다. 어색하면 해당 장면만 다시 돌립니다.
- 번호 표식은 촬영 때 기록한 요소 위치(`shots/boxes.js`)를 따라가므로 화면 배치가 바뀌어도 대부분 그대로 맞습니다. 새 표식이 필요하면 촬영 스크립트에 `mark()` 를 추가합니다.

### 번호 표식

| 표기 | 쓰임 |
| --- | --- |
| `<b class="ann area" data-box="장면:키" data-n="1">` | 영역 — 빨간 테두리 투명 박스 |
| `<b class="ann point" data-box="장면:키" data-n="1" data-side="left" data-len="40"><i></i></b>` | 지점 — 요소 가장자리에 점, 선 끝에 번호 |
| `<div data-crop-box="장면:키" data-crop-pad="20" data-max-h="690">` | 기록된 영역만 잘라 보여 주는 확대 패널. `data-max-h` 로 높이를 묶는다 |

## 빌드 환경

- 슬라이드 글꼴은 Pretendard 입니다. `deck.css` 가 로컬에 설치된 글꼴(`local()`)을 씁니다. 설치되지 않은 PC 에서 빌드하면 시스템 글꼴로 바뀌어 줄바꿈이 달라질 수 있습니다.
- 흐림(blur) 그림자는 쓰지 않습니다. Chrome 이 PDF 에 래스터로 구워 macOS 미리보기에서 회색 사각형으로 보입니다. PDF 검수는 PNG 가 아니라 PDF 를 미리보기(PDFKit)로 열어 확인합니다.
- Playwright 는 `apps/workplace-web` 의 의존성을 그대로 씁니다. 먼저 `pnpm install` 이 되어 있어야 합니다.

## 촬영 규격

- 데스크톱: 뷰포트 1440×810(16:9), 배율 2, 라이트 테마, `ko-KR`, `Asia/Seoul`.
  - 1280 처럼 좁으면 사이드바와 속성 패널이 겹칩니다.
  - 1920 처럼 넓으면 슬라이드 안에서 글자가 작아집니다.
- 모바일: 390×844, 배율 3, 터치 기기로 엽니다. 이렇게 열어야 모바일 전용 화면으로 바뀝니다.
- 화면 요소는 문구가 아니라 `data-testid` 로 찾습니다. AI 문구가 매번 달라지기 때문입니다.

## 알려진 제약

- **노트 "AI 초안 작성" 장면 없음.** 스트리밍으로 들어간 초안의 마크다운(표·굵게·목록 깊이)이 깨지고 제목이 중복돼 소개 장면에서 뺐습니다(WP-255).
- **채널 읽음 기준점 직접 지정.** 빈 채널을 만든 사람은 읽음 기준점이 없어 "놓친 대화 요약"이 뜨지 않습니다(WP-256). 그래서 시드가 기준점을 명시적으로 읽음 처리합니다.
- **에이전트 역할 수동 부여.** 관리자 API 로 만든 에이전트에는 역할이 붙지 않아(WP-252), 시드가 AGENT 역할을 직접 붙입니다.
- **AI 지정은 생성 뒤에.** 이슈를 만들면서 AI 를 담당자로 넣으면 AI 가 두 번 실행됩니다(WP-253). 그래서 시드는 이슈를 만든 뒤에 담당자를 지정합니다.
- **AI 코멘트의 마크다운이 그대로 보임.** 4장의 AI 결과 코멘트는 마크다운 기호(`##`, `**`)가 렌더링되지 않은 채 보입니다(WP-254).
- **회신 필요 표시는 자기 자신에게 보낸 메일에 붙지 않음.** 시연 메일이 본인 발송이라 AI 가 회신 필요로 판단하지 않아, 9장은 분류·요약·답장/이슈 버튼만 짚습니다.

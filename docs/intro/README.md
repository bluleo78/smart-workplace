# Gen:iA Works 제품 소개 자료

고객에게 전달하는 화면 중심 제품 소개 자료(16:9, 19장)를 **현재 화면으로 다시 만드는 방법**을 담은 문서입니다. 화면이 바뀌면 이 절차로 다시 촬영하고 PDF를 새로 만듭니다.

## 산출물

| 무엇 | 위치 | 비고 |
| --- | --- | --- |
| 화면 원본 | `docs/intro/deck/shots/*.png` | 데스크톱 2880×1620, 모바일 780×1688 |
| 표시 좌표 | `docs/intro/deck/shots/boxes.json` | 촬영 때 기록한 요소 위치(원본 px, 사용자 매뉴얼과 같은 형식). 번호 표식·잘라 보기가 이 값을 쓴다 |
| 촬영 장면 | `docs/intro/scripts/scenes.mjs` | 실행은 `docs/intro/scripts/capture.mjs` |
| 슬라이드 원본 | `docs/intro/deck/index.html` · `deck.css` · `deck.js` | 화면 원본을 잘라 보여 줄 뿐 가공하지 않는다 |
| PDF | `dist/intro/genia-works-intro.pdf` | 빌드 산출물(커밋하지 않음). 확정한 판은 드라이브 「소개 자료 › Gen:iA › Gen:iA Works」에 올린다 |
| 장별 PNG | `dist/intro/png/slide-01~19.png` | 빌드 산출물(커밋하지 않음) |

화면 원본 PNG는 그대로 보관합니다. 다른 문서나 발표에 화면만 따로 쓸 때 이 파일을 씁니다.

## 구성(19장)

| # | 헤드라인 | 화면 |
| --- | --- | --- |
| 1 | 표지 | 홈 |
| 2 | 업무 도구 전부를 한곳에 | 홈(레일·요약·지금 신경 쓸 일·AI 어시스턴트) |
| 3 | AI도 팀원으로 지정합니다 | 담당자 선택창의 「에이전트」 + 새 이슈의 AI 제안 받기 |
| 4 | 맡기면 AI가 직접 처리합니다 | AI 착수·결과 코멘트 + 이력(상태 변경) |
| 5 | AI에게 맡긴 일을 한눈에 | AI 위임 작업(이슈별, 상태 칩) |
| 6 | AI마다 역할을 주고, 하는 일을 봅니다 | AI 위임 작업 › AI별 + 에이전트 설명(역할)·지시 |
| 7 | 어디서든 말로 일을 시킵니다 | AI 어시스턴트 패널 + 이슈 채팅 |
| 8 | 대화가 바로 일이 됩니다 | 채널 @멘션 → AI 이슈 제안 → 승인 직후 |
| 9 | 흩어진 맥락은 AI가 정리합니다 | AI 현황 요약 + 놓친 대화 요약 |
| 10 | 메일은 AI가 읽고, 초안을 씁니다 | 메일 AI 분류·요약 + 답장 초안 + 이슈로 만들기(AI 초안) |
| 11 | 계획과 진행을 함께 봅니다 | 보드 + 타임라인(마일스톤·버전) |
| 12 | 팀의 지식은 노트에 모읍니다 | 노트(PRD)·실시간 편집 |
| 13 | 노트는 링크로, 범위와 기한을 정해 공유합니다 | 페이지 공유 창 + 설정 › 내 공유 |
| 14 | 파일은 열기 전에 AI 요약부터 | 파일 미리보기 + AI 요약 |
| 15 | 회사 캘린더와 팀 일정을 한 화면에 | 캘린더 주간(Microsoft 365 연동·이슈 마감일·태그) |
| 16 | 사람 대신 부서를 고르면 한 번에 | 프로젝트 멤버 추가·일정 참석자의 조직 탭 |
| 17 | 휴대폰에서도 같은 업무, 같은 AI | 모바일 홈(탭바)·채널·AI |
| 18 | 쓰던 AI 도구에서도 같은 업무 공간에 | 개념도 + 설정 › API 토큰 |
| 19 | 관리자가 AI를 통제합니다 | 설정 › 에이전트 + 에이전트 상세 |

## 작성 규칙

**화면에 없는 기능, 코드에 없는 동작을 쓰지 않습니다.** 자료가 고객에게 나가기 때문에 과장이 곧 신뢰 문제가 됩니다.

| 알아야 할 것 | 근거 |
| --- | --- |
| 화면이 있는지 | `apps/workplace-web/src/App.tsx` 라우터 |
| 버튼·메뉴·라벨 문구 | 해당 컴포넌트 소스의 한국어 문구(화면 캡처와 일치해야 함) |
| AI가 무엇을 하는지 | `apps/workplace-ai-agent/src/agent/*system-prompt.ts`, 실제 실행 결과 |
| 외부 도구 연동 범위 | `apps/workplace-mcp/src/tools/index.ts` |

- **AI 결과물은 지어내지 않습니다.** AI 코멘트·요약·제안·초안은 촬영 장면과 시드가 사람과 같은 방식으로 요청해 AI가 실제로 만든 것입니다. API로 문구를 직접 넣지 않습니다.
- **AI 표현은 일반 용어로 씁니다.** "AI 에이전트", "외부 AI 도구"처럼 쓰고, 모델·벤더 이름은 화면에 보이는 경우에만 그대로 둡니다.
- 확인한 근거가 없는 효과(시간 단축률 등)는 쓰지 않습니다.
- 실제 고객 데이터를 찍지 않습니다. 운영의 촬영 전용 테넌트(가상 회사 누리커머스)와 `example.com` 계정만 씁니다.

## 다시 만들기

사용자 매뉴얼과 **같은 운영 촬영 테넌트(누리커머스, slug `nuri-demo`)·같은 촬영기**를 씁니다. 테넌트를 채우는 시드와 계정·비밀번호 규칙은 [사용자 매뉴얼 README](../manual/README.md) 를 따릅니다. 비밀번호는 키체인 `genia-works-manual-demo` 에 두고 환경변수로만 넘깁니다.

### 1. 촬영

```bash
MANUAL_WEB=https://genia-works.iacloud.kr MANUAL_API=https://genia-works.iacloud.kr \
MANUAL_PASS="$(security find-generic-password -s genia-works-manual-demo -w)" \
node docs/intro/scripts/capture.mjs                       # once 장면을 뺀 전체
MANUAL_SHOTS_ONLY=home,assignee node docs/intro/scripts/capture.mjs   # 일부만(앞의 환경변수와 함께)
```

- 장면은 읽기 전용 가드(`guardReadOnly`)를 걸고 화면을 열기만 합니다. 저장·제출·승인·읽음 처리를 하지 않습니다.
- **AI 결과 장면은 `once`** 입니다. 실제 AI 를 불러 결과가 매번 달라지므로 전체 재촬영에서 빠지고, `MANUAL_SHOTS_ONLY` 에 이름을 적었을 때만 돕니다. 운영에 쓰기(AI 질문·요약)가 생기므로 **매번 사람의 확인을 받은 뒤** 돌립니다.
- 촬영 시각은 `scenes.mjs` 의 `CLOCK.now`(시드 직후)로 고정합니다. 「n분 전」·「오늘 마감」 이 찍을 때마다 바뀌지 않게 하려는 것입니다. AI 결과 장면은 실제 시각을 씁니다.
- 화면 도우미(홈·이슈·채널·설정 열기 등)는 매뉴얼과 공용입니다: `docs/manual/scripts/scenes/user-kit.mjs`.

### 메일·캘린더 장면

메일·캘린더 장면은 실제 Microsoft 365 계정을 김서연에 잠시 연결해 찍습니다.

1. 사람이 김서연으로 로그인해 설정 › 메일 계정에서 Microsoft 365 를 연결합니다.
2. 시연용 메일을 연결 계정 자신에게 보냅니다. 받는 사람은 스크립트가 연결 계정 주소로 고정하므로 외부로는 나가지 않습니다.
   ```bash
   MANUAL_API=https://genia-works.iacloud.kr MANUAL_TENANT_SLUG=nuri-demo MANUAL_SEED_CONFIRM=nuri-demo \
   MANUAL_PASS="$(security find-generic-password -s genia-works-manual-demo -w)" node docs/intro/scripts/send-demo-mail.mjs
   ```
   본문이 400자 이하면 AI 요약을 건너뛰므로 시연 메일은 길게 씁니다. 화면은 제목 머리말 `【누리커머스】` 로 검색해 이 메일만 보여 줍니다.
3. 동기화·AI 요약이 끝난 뒤 메일·캘린더 장면을 찍습니다. 실제 메일·일정·실명이 보이는 곳은 찍기 전에 가립니다(`capture` 의 `redact`).
4. 찍은 뒤 연결을 해제하고, 연결 때 Outlook 범주에서 생긴 캘린더 태그를 지웁니다.

### 2. PDF

```bash
node docs/intro/scripts/build-pdf.mjs            # dist/intro/genia-works-intro.pdf + png/
node docs/intro/scripts/build-pdf.mjs --png-only # 검토용 PNG 만
```

표식 좌표(`boxes.json`)는 `build-pdf.mjs` 가 넣으므로, `index.html` 을 브라우저로 바로 열면 표식과 잘라 보기가 빠진 채 보입니다. 검토는 `--png-only` 로 만든 PNG 로 합니다.

### 3. 확인

- AI 결과물은 실행할 때마다 문구가 달라집니다. 촬영 후 `dist/intro/png/` 을 훑어 어색한 답변이 없는지 봅니다. 어색하면 그 장면만 다시 돌립니다.
- 번호 표식은 촬영 때 기록한 요소 위치(`shots/boxes.json`)를 따라가므로 화면 배치가 바뀌어도 대부분 그대로 맞습니다. 새 표식이 필요하면 장면의 `capture()` 에 키를 더합니다.

### 번호 표식

| 표기 | 쓰임 |
| --- | --- |
| `<b class="ann area" data-box="장면:키" data-n="1">` | 영역 — 빨간 테두리 투명 박스 |
| `<b class="ann point" data-box="장면:키" data-n="1" data-side="left" data-len="40"><i></i></b>` | 지점 — 요소 가장자리에 점, 선 끝에 번호 |
| `<div data-crop-box="장면:키" data-crop-pad="20" data-max-h="690">` | 기록된 영역만 잘라 보여 주는 확대 패널. `data-max-h` 로 높이를 묶는다 |
| `<div data-crop="x,y,w,h">` | 원본 px 로 직접 정한 잘라 보기 |

## 빌드 환경

- 슬라이드 글꼴은 Pretendard 입니다. `deck.css` 가 로컬에 설치된 글꼴(`local()`)을 씁니다. 설치되지 않은 PC 에서 빌드하면 시스템 글꼴로 바뀌어 줄바꿈이 달라질 수 있습니다.
- 흐림(blur) 그림자는 쓰지 않습니다. Chrome 이 PDF 에 래스터로 구워 macOS 미리보기에서 회색 사각형으로 보입니다. PDF 검수는 PNG 가 아니라 PDF 를 미리보기(PDFKit)로 열어 확인합니다.
- Playwright 는 `apps/workplace-web` 의 의존성을 그대로 씁니다. 먼저 `pnpm install` 이 되어 있어야 합니다.

## 촬영 규격

사용자 매뉴얼과 같습니다(`docs/manual/scripts/lib/capture-kit.mjs`).

- 데스크톱: 뷰포트 1440×810(16:9), 배율 2, **라이트 테마 고정**, `ko-KR`, `Asia/Seoul`. 토스트·애니메이션을 끄고 입력 커서를 숨겨 결정적으로 찍습니다.
  - 1280 처럼 좁으면 사이드바와 속성 패널이 겹칩니다.
  - 1920 처럼 넓으면 슬라이드 안에서 글자가 작아집니다.
- 모바일: 390×844, 배율 2(원본 780×1688). 폭으로 모바일 전용 화면이 열립니다.
- 화면 요소는 문구가 아니라 `data-testid` 로 찾습니다. AI 문구가 매번 달라지기 때문입니다.
- 슬라이드는 그림 전체를 보이므로, 토큰 앞자리처럼 남으면 안 되는 값은 촬영 브라우저 안에서 가린 채 찍습니다.

## 알려진 제약

- **노트 "AI 초안 작성" 장면 없음.** 스트리밍으로 들어간 초안의 마크다운(표·굵게·목록 깊이)이 깨지고 제목이 중복돼 소개 장면에서 뺐습니다(WP-255).
- **회신 필요 표시는 자기 자신에게 보낸 메일에 붙지 않음.** 시연 메일이 본인 발송이라 AI 가 회신 필요로 판단하지 않아, 10장은 분류·요약·답장/이슈 버튼만 짚습니다.
- **이슈 속성 패널의 「AI 제안 받기」는 바로 저장됩니다.** 운영 이슈를 바꾸지 않으려고 3장은 새 이슈 창(만들지 않음)의 AI 제안을 찍습니다.

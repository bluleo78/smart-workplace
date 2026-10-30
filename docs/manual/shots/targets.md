# 촬영 대상 표

매뉴얼 그림 한 장이 한 행이다. 촬영 스크립트(`scripts/scenes/<book>.mjs`)는 이 표를 구현만 한다 — 집필 중 그림이 필요해지면 **이 표에 행을 먼저 추가**하고 장면을 쓴다.

- 그림 id 는 `<장 slug>-<n>` 이고 `shots/<book>/<id>.png` 와 `boxes.json` 의 키가 된다.
- 자르기·표식 키는 `boxes.json` 의 상자 이름이다. 장 본문 그림 지시문의 `crop=`·`marks=` 와 같아야 한다.
- 로그인 계정·시드는 가상 회사(누리커머스 등) 데이터만 쓴다. 실명·실계정·운영 데이터를 찍지 않는다.

## 사용자 매뉴얼

촬영 환경: **운영(`https://genia-works.iacloud.kr`)의 매뉴얼 전용 테넌트 누리커머스**(slug `nuri-demo`, `scripts/seed-user.mjs` 로 채움). 로그인 계정은 소유자 **김서연**(`seoyeon@example.com`)이다. 뷰포트는 기본 1440x810(배율 2 → 원본 2880x1620)이다.

- **읽기만 한다.** 장면은 화면을 열고, 메뉴·창을 열고, 칸을 채운 뒤 닫기만 한다. 로그인 폼을 제출하지 않고(틀린 비밀번호를 되풀이하면 계정이 잠긴다), 알림 행·**읽음**·**모두 읽음**·**+ 위젯 추가**·**저장**·**켜기**·**테마 전환**·**새 소식** 을 누르지 않는다. 편집 모드는 언제나 **취소** 로 끝낸다.
- **브라우저 시계를 고정한다.** 장면은 `scenes/user.mjs` 의 `FIXED_NOW`(2026-10-29 19:55 KST — 마지막 시드인 대화·캘린더 보강 시드의 마지막 쓰기 19:49:03 직후)로 시계를 고정하고 화면을 연다. 「n분 전」·「오늘 일정」·마감 계산이 그 시각 기준이라 다시 찍어도 같은 그림이 나온다. **시드를 다시 넣으면** `FIXED_NOW` 를 새 시드 직후 시각으로 바꾼다(시드 날짜가 상대 날짜라서다). 실제 시각보다 앞선 시각으로 두지 않는다.
- **안 읽음 수는 운영 상태를 따른다.** 레일의 대화 배지(10)·알림 배지(3)와 홈의 요약·알림·대화 위젯은 김서연이 아직 읽지 않은 상태를 찍은 것이다. 채널을 열기만 해도 앱이 읽음 처리(`POST …/channels/{id}/read`)를, 스레드 패널은 스레드 읽음을 보낸다. 그래서 장면은 촬영 컨텍스트에 `guardReadOnly`(`lib/scene-kit.mjs`)를 걸어 `/api/` 로 가는 GET 이외 요청(로그인 유지용 `/auth/` 제외)과 AI 를 부르는 채널 캐치업 요약(`…/catchup`)을 브라우저 안에서 막는다 — 서버에 닿지 않으므로 5장 장면을 돌려도 01~03장 그림의 수가 바뀌지 않는다. 디자인-리뷰(안 읽음 6)처럼 5건 이상 쌓인 채널은 열면 캐치업 카드가 저절로 뜨므로 장면은 그 채널을 열지 않는다. 특히 이준호의 MOB-14 멘션 알림을 읽으면 요약의 **멘션** 칸과 **지금 신경 쓸 일** 의 멘션 행이 사라진다 — 01~03장 장면은 알림 목록을 열기만 하고 행·**모두 읽음** 을 누르지 않는다(목록을 여는 것만으로는 읽음이 되지 않는다, `InboxList.tsx`).
- **AI 어시스턴트는 켜져 있다.** 에이전트 지니가 워크스페이스 AI 비서라 화면 위 **AI 어시스턴트** 단추가 보인다(`useAiAvailable`). 장면은 단추를 찍기만 하고 누르거나 요청을 보내지 않는다 — AI 결과 그림은 04장에서 찍는다. 홈의 **확인 필요**·AI 우선순위 점수는 서버가 주기적으로(15분 배치) AI 로 다시 매겨 바뀔 수 있다. 다시 찍을 때 홈 그림이 달라지면 이것부터 의심한다(2026-10-29 촬영 때는 우선순위 항목이 아직 없었다. 19:55 재촬영 때 **확인 필요** 는 1 — 이준호 DM 의 회신 대기).

### 01 소개

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| introduction-1 | `/` | 김서연 | 레일 맨 위 표시를 눌러 레일을 펼친다(찍은 뒤 접는다) | (전체) | — (`rail` 기록) | MOB 이슈·채널·일정(홈 위젯이 채워짐) |

### 02 로그인과 화면 구조

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| login-and-layout-1 | `/login` | 로그아웃 상태(새 컨텍스트) | 아이디·비밀번호 칸을 채운다(제출하지 않음) | `card` | `username,password,submit` / `microsoft`(같은 그림을 두 번 싣는다) | 운영의 Microsoft 로그인(SSO) 설정 |
| login-and-layout-2 | `/signup` | 로그아웃 상태(새 컨텍스트) | 가입이 잠긴 안내 카드 | `card` | — (`notice,login` 기록) | — (운영은 첫 가입 뒤 가입이 잠김) |
| login-and-layout-3 | `/` | 김서연 | 홈을 연 그대로(**AI 어시스턴트** 단추는 누르지 않음) | (전체) | `apps@r,assistant,workspace,user` (`inbox` 도 기록) | 위와 같음 |
| login-and-layout-4 | `/` | 김서연 | 레일을 펼친다(찍은 뒤 접는다) | `toggle+apps` | `toggle,apps` | — |
| login-and-layout-5 | `/` | 김서연 | 레일의 **알림** 을 눌러 목록을 연다(행을 누르지 않음) | `panel+trigger` | `trigger@br,item,markAll` | 김서연의 안 읽은 알림(MOB-14 멘션, MOB-7 코멘트 2건) |
| login-and-layout-6 | `/` | 김서연 | 워크스페이스 표시를 눌러 메뉴를 연다 | `menu+trigger` | `trigger,menu` | — |
| login-and-layout-7 | `/` | 김서연 | 레일 맨 아래 아바타를 눌러 사용자 메뉴를 연다 | `menu+trigger` | `profile@r,whatsNew@r,theme@r,logout@r` (`trigger` 도 기록) | — |

### 03 홈

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| home-1 | `/` | 김서연 | 홈을 연 그대로 | (전체) | `summary!inside,edit` (`home` 도 기록) | MOB 이슈·채널·오늘 일정 + 홈 보강 시드 |
| home-2 | `/` | 김서연 | **뷰포트를 1024x810 으로 좁혀** 찍는다(아래 「폭 예외」) | `counts+attention` | `counts,attention` | 홈 보강 시드(MOB-14 오늘 마감·MOB-15 기한 지남·MOB-14 의 안 읽은 멘션) |
| home-3 | `/` | 김서연 | **내 작업** 위젯이 보이게 내린다 | `widget` | `title,group,row` | 김서연이 담당한 MOB 이슈 |
| home-4 | `/` | 김서연 | 홈을 연 그대로 | `title+buttons` | `newIssue,newMail,newChat` | — |
| home-5 | `/` | 김서연 | **편집** 을 누른다(찍은 뒤 **취소**) | `add+banner+controls` | `controls,add,save` | — |
| home-6 | `/` | 김서연 | **편집** → **위젯 추가** 창에서 **이슈 목록** 카드를 고른다(추가하지 않음, 찍은 뒤 창을 닫고 **취소**) | `title+categories+grid` | `category,card` | — |

폭 예외 — home-2 는 자른 폭이 원본 약 1770px 이다. **요약** 위젯은 홈 본문 전체 폭을 쓰고 숫자 칸 다섯 개가 그 폭에 고르게 퍼져, 데스크톱 화면(가장 좁은 1024 폭)에서도 1400px 안에 들지 않는다. 칸 이름은 본문 표에 굵게 적어 그림의 글자를 읽지 않아도 되게 했다.

### AI 시드 뒤에 찍을 그림

AI 결과가 있어야 하는 그림이다(실제 AI 호출로 만든다). 지금은 본문에 설명만 있다. 화면 구조의 **AI 어시스턴트** 단추는 2026-10-29 재촬영(login-and-layout-3)에 담겼다.

| 쓸 곳 | 경로 | 보여 줄 것 | 필요한 시드 |
| --- | --- | --- | --- |
| 03 AI 와 함께 | `/` | **AI 우선순위** 위젯(4분면에 실제 항목) | AI 우선순위 배치가 한 번 돈 뒤. 위젯은 **편집** 으로 추가해 저장해야 해 운영 쓰기다 — 촬영 계정 대신 다른 등장인물로 할지 정한다 |
| 03 AI 와 함께 | `/` | **요약** 의 **회신 필요** 칸과 **확인 필요** 칸(AI 발굴 대화) | 연결한 메일 계정 + 메일 AI 분류 켜기, AI 가 발굴할 대화 |

### 쓰기로만 만들 수 있는 상태(시드 보강 후보)

| 쓸 곳 | 상태 | 넣을 데이터 |
| --- | --- | --- |
| 02 워크스페이스를 고른다 | 로그인 직후 **워크스페이스 선택** 카드 | 등장인물 한 명을 두 번째 가상 테넌트에도 소속시킨다(운영자 콘솔 「기존 사용자 추가」) |
| 02 워크스페이스를 바꾼다 | 워크스페이스 메뉴에 둘 이상 | 위와 같음 |
| 03 위젯 | **메일** 위젯에 안 읽은 메일 | M365 메일 계정 연결(6장 시드와 함께) |

### 04 AI 와 함께 일하기

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| ai-collaboration-1 | `/me/ai-tasks` | 김서연(PM, 관리자) | 범위 **전체** 를 누른다(행은 누르지 않는다) | `scope+chips+titles` | `scope,chips,titles@r` | AI 결과 — once. --ai-run 시드의 release-bot 담당 MOB-9·10 |
| ai-collaboration-2 | `/projects/MOB/issues/8` | 김서연 | 담당자 칸을 눌러 선택창을 연다(체크하지 않고 Esc) — 운영 장면(user.mjs) | `field+picker` | `field@l,agent@l` (`picker` 도 기록) | 구성원 5명 + 에이전트 지니가 MOB 멤버 |
| ai-collaboration-3 | `/projects/MOB/issues/16` | 김서연 | 코멘트 탭(오래된 순), 지니 착수 코멘트 머리가 위쪽에 오게 스크롤 | `start+result` | `start@l,request@l,result@l` | AI 결과 — once. --ai-run 시드 MOB-16(지니 착수 → 박지민 요청 → 지니 체크리스트 → 지니 답) |
| ai-collaboration-4 | 위와 같은 이슈 | 김서연 | **이력** 탭을 누른다 | `head+list` | `changes@r` | AI 결과 — once. 박지민의 담당자 변경과 지니의 상태 변경(할 일 → 진행 중) |
| ai-collaboration-5 | `/projects/MOB`(목록) | 김서연 | **AI 결과 — once**(운영 장면). **AI 어시스턴트** 새 대화에 「이번 스프린트에서 마감이 가까운 MOB 이슈와 담당자를 정리해 줘」(POST /ai/chat 만 연다, 읽기만, AI 1회). 찍기만 다시 할 때는 `MANUAL_AI_REUSE=1`(최근 대화를 다시 열어 AI 를 부르지 않는다) | `launcher+panel` | `launcher,composer@l,answer@l` (`panel` 도 기록) | MOB 이슈·사이클 |

다시 찍을 때 고칠 것(WP-1196) — 샘플 그림은 자르기 폭 기준(원본 1400px 이하, 집필 스킬 「자르기 가독성 기준」)을 넘는다. 표식 상자가 컨테이너 전체를 감싸 자르기를 더 좁힐 수 없기 때문이다.

| 그림 id | 지금 자른 폭(원본 px) | 고칠 것 |
| --- | --- | --- |
| ai-collaboration-2 | 640 | 같은 배율로 단 폭의 약 46% 로 인쇄된다(문제 없음). 담당자 칸까지 감싸는 키를 기록하면 어디서 연 목록인지 보인다 |
| ai-collaboration-5 | 1556 | 패널과 AI 어시스턴트 단추를 함께 담느라 넓다. 단추 위치는 전체 그림으로 따로 보여 주고, 패널만 자르는 것을 검토한다 |

### 05 대화

시작 화면은 채널 **모바일-주문앱**(안 읽음 3 — 머리에 **놓친 대화 요약** 단추가 보이지만 누르지 않는다)이다. 채널 id 는 운영 값이라 사이드바의 이름으로 연다. 메시지·반응·스레드 답글은 보내지 않고, 입력칸에 넣은 글은 찍은 뒤 지운다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| chat-1 | `/chat/channels/<모바일-주문앱>` | 김서연 | 채널을 연 그대로 | (전체) | `channels@r,dms@r,threads!inside,header,composer` | 채널 3개와 대화, 정도윤 메시지의 스레드 답글 |
| chat-2 | 위와 같음 | 김서연 | **뷰포트를 1024x810 으로 좁혀** 입력칸에 글을 넣고 **+** 메뉴를 연다(보내지 않음) | `attach+menu+format+input+send` | `attach,format,input` (`menu,send` 도 기록) | — |
| chat-3 | 위와 같음 | 김서연 | 김서연의 메시지에 마우스를 올려 도구 줄을 띄운다 | `message+emoji+delete` | `emoji,thread,edit,delete` (`message` 도 기록) | 김서연이 보낸 메시지 |
| chat-4 | 위와 같음 | 김서연 | 정도윤 메시지의 **답글 1개** 를 눌러 스레드를 연다 | `root+replies+close` | `root,replies,close` (`panel` 도 기록) | 스레드 답글(이준호) |
| chat-5 | 위와 같음 | 김서연 | 사이드바 **채널** 옆 돋보기를 눌러 **채널 탐색** 을 연다 | `dialog` | `search,rows` | 채널 3개 |
| chat-6 | 위와 같음 | 김서연 | **채널** 옆 **+** 로 **채널 만들기** 창을 열어 이름을 넣는다(만들지 않음) | `dialog` | `name,private,submit` | — |
| chat-7 | 위와 같음 | 김서연 | 머리의 멤버 수를 눌러 **멤버** 창을 연다(역할을 바꾸지 않음) | `dialog` | `add,role,leave` | 채널 멤버 6명(지니 포함) |
| chat-8 | `/chat/new` | 김서연 | **뷰포트를 1024x810 으로 좁혀** 연다(받는 사람을 고르지 않음 — 고르면 DM 을 찾거나 만든다) | `input+list` | `input,filter,list` | 구성원 4명 + 에이전트 지니 |
| chat-9 | `/chat/channels/<모바일-주문앱>` | 김서연 | **뷰포트를 1024x810 으로 좁혀** 채널을 연 그대로 | `own+message+reactions` | `reactions,replies@l` (`message,own` 도 기록) | 박지민 메시지의 반응 3개, 김서연 메시지의 안 읽은 스레드 답글 2건 |
| chat-10 | `/chat/threads/inbox` | 김서연 | 연 그대로(카드는 누르지 않음) | (전체) | `card,badge@l` (`nav` 도 기록) | 위와 같은 스레드 답글 |
| chat-11 | `/chat/dms/<이준호>` | 김서연 | 사이드바에서 이준호 DM 을 연다(읽음 처리는 guardReadOnly 가 막는다, **놓친 대화 요약** 은 누르지 않음) | (전체) | `dm@r,header,divider!inside` | 이준호↔김서연 DM 3건(마지막 1건 안 읽음) |
| chat-12 | `/chat/channels/<모바일-주문앱>` | 김서연 | 채널 머리 **파일** 로 채널 드라이브를 연다(서버의 채널 공간 확인 POST 만 허용 — 공간이 이미 있으면 새로 만들지 않는다) | `area`(머리~마지막 파일 행) | `head,full@l,rows` (`area` 도 기록) | 채널 드라이브 공간과 파일 |
| chat-13 | `/chat/dms/<이준호>` | 김서연 | **AI 결과 — 한 번 찍어 고정, 재촬영 제외(once)**. 폭 1024, **놓친 대화 요약** 단추를 누른다(캐치업 GET 만 연다, AI 1회 — 같은 구간은 서버 캐시라 다시 찍어도 AI 를 다시 부르지 않는다). **확인했어요** 는 누르지 않는다 | `divider+card` | `card,confirm` | 이준호↔김서연 DM(안 읽은 1건) |
| chat-14 | `/chat/channels/<모바일-주문앱>` | 김서연 | **AI 결과 — once**. 새 대화로 묻는다(POST /ai/chat 만 연다). 찍기만 다시 할 때는 `MANUAL_AI_REUSE=1`. 「이 채널에서 이번 주에 정한 일을 세 줄로 정리하고, 배포 알리미(release-bot)를 이 채널에 초대해 줘」 — 확인 카드는 승인·거부하지 않는다(대기 제안은 코디네이터가 API 로 거부해 정리) | `area`(카드 안쪽 14px) | `card!inside` | 사람 구성원은 모두 멤버라 비멤버인 release-bot 을 초대 대상으로 |

표식 상자 — 05장부터의 장면은 상자를 글자에서 CSS 4px(원본 8px) 띄워 기록한다(`MARK_PAD`). 글자 요소의 상자는 글자에 딱 붙거나 글자보다 좁아 빨간 테두리가 글자를 자르거나 덮기 때문이다. 일정·마감 칩은 글자가 아니라 칩 전체를 감싼다.

폭 예외 — chat-2·chat-8 은 입력칸·받는 사람 칸이 본문 전체 폭이라 데스크톱 최소 폭(1024)에서도 자른 폭이 원본 약 1500px 이다. 단추·탭 이름은 본문에 굵게 적었다.

### 06 메일

**M365 연결 중에만 찍는다(once — 연결한 뒤 이름을 지정해 찍는다).** 김서연 계정에 사용자가 Microsoft 로그인으로 직접 연결한 실제 Outlook(Microsoft 365) 메일함(dh.yang@iacloud.kr)이라, 연결을 해제하면 이 장면들(mail-1~3, 12장 my-settings-8, 7장 calendar-8)은 찍을 수 없다. 다시 찍을 때 지킬 것:

- 목록은 검색어 「【누리커머스】」 로만 연다(`openMail`). 검색하지 않은 받은편지함에는 실제 메일이 보인다. 서버 검색은 본문 전문 검색이라 옛 사본 「[누리커머스]」 3통도 결과에 섞이므로, 상세는 제목 전체(「【누리커머스】 배송 추적 API 개편 관련 미팅 요청」)로 골라 연다.
- 목록 행(첫 줄이 보낸 사람 실명)·사이드바(폴더별 안 읽은 수)·레일(메일 배지)·상세의 보낸 사람 줄은 자르기 밖에 둔다. 받는 사람 주소(dh.yang@iacloud.kr)만 허용한다.
- **원본 PNG 도 가린다.** 그림은 빌드 때 잘라 보이지만 저장소에는 원본 전체가 커밋된다. 이 장면들은 `capture(…, { redact: [자르기 키] })` 로 자르기 영역(그림 지시문 crop 과 같은 키) 밖을 단색 덮개로 가리고 찍는다 — redact 키는 그림 지시문의 crop 키와 늘 같게 둔다.
- 동기화가 끝난 뒤 찍는다(진행률이 없고 새로고침 단추가 풀릴 때 — 화면은 동기화 중에만 sync-status 를 부른다).
- 보내기·읽음 처리·옮기기·삭제·AI 요청은 하지 않는다. 쓰기는 guardReadOnly 가, AI 요약 GET(`…/summary`)과 `markSeen=false` 없는 상세 GET 은 `openApp` 의 extraBlock 이 막는다.
- 캘린더는 달력 칸에 실제 Outlook 일정 제목이, 태그 칸에 실제 Outlook 범주 이름이 보이므로 사이드바 M365 계정 묶음만 자른다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| mail-1 | `/mail/<계정>?q=【누리커머스】` | 김서연 | 연 그대로 | `area`(경로~도구 줄, 첫 행 글자 위에서 끊음) | `path,sync,unread,markAll@r` (`area` 도 기록) | M365 연결 + 시연 메일 3통 |
| mail-2 | 위와 같음 | 김서연 | 제목 전체로 시연 메일을 누른다(읽음 POST 는 막힘) | `area`(단추 줄~본문, 보낸 사람 줄 아래에서 끊음) | `actions@r,body` (`area` 도 기록) | 위와 같음 |
| mail-3 | 위와 같음 | 김서연 | **편지쓰기** 로 빈 새 메일 창만 연다(보내지 않음) | `dock` | `to,subject,tabs,send` | M365 연결 |

### 07 캘린더

장면은 캘린더를 연 뒤 언제나 **월** 보기를 눌러 맞춘다(고른 보기가 브라우저에 남아 앞 장면의 보기가 이어진다). 일정 창은 채우기만 하고 **저장**·**수정**·**삭제** 를 누르지 않는다. 날짜·시각 칸은 브라우저가 그리므로 촬영 브라우저를 `--lang=ko-KR` 로 띄운다(`capture.mjs`).

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| calendar-1 | `/calendar` | 김서연 | 월 보기 | (전체) | `create@r,mini@r,calendars@r,nav,views,due` | 김서연이 만든 일정 4건, 마감일이 있는 김서연 담당 이슈 |
| calendar-2 | 위와 같음 | 김서연 | **목록** 보기를 누른다 | (전체) | `views,due,event` | 위와 같음 |
| calendar-3 | 위와 같음 | 김서연 | **새 일정** 창에 제목을 넣는다(저장하지 않음) | `dialog` | `title,time,place,attendees,reminder,save` | — |
| calendar-4 | 위와 같음 | 김서연 | 월 보기의 **스프린트 7 데일리**(김서연이 주최)를 눌러 수정 창을 연다(바꾸지 않음) | `dialog` | `attendees,delete,update` | 참석자 4명을 초대한 일정 |
| calendar-5 | 위와 같음 | 김서연 | **내 캘린더** 옆 **+** 로 **새 캘린더** 창을 열어 이름을 넣는다(추가하지 않음) | `dialog` | `name,color,submit` | — |
| calendar-6 | 위와 같음 | 김서연 | 이준호가 주최한 **포인트 결제 UI 구현 범위 논의** 를 눌러 **일정 보기** 를 연다(응답 단추는 누르지 않음) | `dialog` | `readonly@br,attendees@r,rsvp` | 이준호 주최·김서연 응답 전 일정 |
| calendar-7 | 위와 같음 | 김서연 | 사이드바 태그 **출시** 의 점 세 개 단추로 메뉴를 연다(항목은 누르지 않음) | `tags+menu` | `tags@r,menu@tr,feed@r` | 태그 「출시」·「스프린트」 |
| calendar-8 | `/calendar` | 김서연 | 연 그대로(M365 연결 중에만) | `area`(사이드바 M365 계정 묶음, 테두리 안쪽으로 14px 줄임) | `calendars!inside,readonly@l` (`account` 도 기록) | M365 연결 |
| calendar-9 | `/calendar` | 김서연 | **AI 결과 — once**. 새 대화로 묻는다(POST /ai/chat 만 연다). 찍기만 다시 할 때는 `MANUAL_AI_REUSE=1`. 「2026년 11월 3일 화요일 오후 3시에 '베타 회고' 1시간 일정을 잡고 박지민, 이준호 님을 초대해 줘」 — 확인 카드는 누르지 않는다 | `panel` | `answer,card` (`panel` 도 기록) | — |

### 쓰기로만 만들 수 있는 상태(05·07 시드 보강 후보)

| 쓸 곳 | 상태 | 넣을 데이터 |
| --- | --- | --- |
| 05 채널 파일 | 채널 머리 **파일** 의 채널 드라이브 | 모바일-주문앱의 채널 드라이브 공간과 파일 (보강 시드 `--app-extras` 로 넣음 — 찍음: chat-12) |
| 07 외부 캘린더 | Outlook 에서 동기화된 일정·읽기 전용 칩 | 김서연의 M365 계정 연결 — 찍음: calendar-8(사이드바 계정 묶음만). 동기화된 일정 칸은 실제 일정 제목이 보여 찍지 않는다 |

### 08 작업 관리

이슈·프로젝트를 만들거나 고치지 않는다. 목록·보드 보기는 브라우저에 남으므로 장면이 매번 눌러 맞추고, 보드 장면은 끝나면 목록으로 되돌린다. 이슈 상세는 첨부·하위 태스크의 「로딩 중…」 이 사라진 뒤 찍는다. **AI 현황 요약** 의 **요약 생성**·**AI 제안 받기** 는 누르지 않는다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| work-1 | `/projects` | 김서연 | 연 그대로 | (전체) | `nav@br,create,row!inside` | MOB 프로젝트(개인 작업 P1R 은 앱이 처음 열 때 만든다) |
| work-2 | `/projects/MOB` | 김서연 | 목록 보기 | (전체) | `pages,create,filters,view@bl,group` | MOB 이슈 15건·사이클 스프린트 7 |
| work-3 | 위와 같음 | 김서연 | 보드 보기(찍은 뒤 목록으로) | (전체) | `view,column@tr,card@r` | 위와 같음 |
| work-4 | 위와 같음 | 김서연 | **새 태스크** 로 **새 이슈** 창을 열어 제목을 넣는다(만들지 않음) | `dialog` | `title,body,fields,submit@r` | — |
| work-5 | `/projects/MOB/issues/7` | 김서연 | 연 그대로 | (전체) | `path,title,children,activity,rail@l` | MOB-7(코멘트 2건·담당 2명) |
| work-6 | 위와 같음 | 김서연 | **상태** 칸을 눌러 목록을 연다(고르지 않음) | `status+list` | `status,list@l` (`panel` 도 기록) | 위와 같음 |
| work-7 | `/me/tasks/assigned` | 김서연 | 연 그대로 | `tabs+filters+group+row` | `tabs,filters,group,row!inside` | 김서연 담당 MOB 이슈 6건(MOB-15 기한 지남) |
| work-8 | `/projects/MOB/timeline` | 김서연 | 연 그대로 | (전체) | `scale,filter,list,milestone` | 에픽 3개·마일스톤 베타 오픈 |
| work-9 | `/projects/MOB/versions/<베타 1.0>` | 김서연 | 버전 목록에서 **베타 1.0** 을 누른다 | `head+actions+issues` | `head,actions@l,tabs,issues` | 버전 베타 1.0·MOB-4~7 |
| work-10 | `/projects/MOB/issues/6` | 김서연 | **AI 결과 — 한 번 찍어 고정, 재촬영 제외(once)**. **요약 생성** 을 누른다(POST …/issues/6/ai-summary 만 연다, AI 1회 — 서버가 요약을 이슈에 저장) | `card` | `card,generate` | MOB-6 |
| work-11 | `/projects/MOB`(목록) | 김서연 | **AI 결과 — once**. **새 태스크** 창에 제목·본문을 넣고 **AI 제안 받기**(POST …/issues/ai-classify 만 연다, 저장 없음). **생성** 은 누르지 않는다 | `dialog` | `ai,fields,submit@tr` | — |

### 09 드라이브

올리기·폴더 만들기·이동·삭제·공유 링크 만들기는 하지 않는다. 팀 공간은 사이드바 이름으로 연다(공간 id 는 운영 값).

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| drive-1 | `/drive/spaces/<모바일 주문 앱>` | 김서연 | 연 그대로 | (전체) | `spaces!inside,actions@bl,row@bl,attachments@r` (`search,usage` 도 기록) | 팀 공간·폴더 「기획」 |
| drive-2 | 위와 같음(폴더 「기획」) | 김서연 | 폴더를 두 번 눌러 들어가 첫 파일의 점 세 개 메뉴를 연다(항목은 누르지 않음) | (전체) | `path,file,menu@l` | 「기획」 안 문서 2개 |
| drive-3 | 위와 같음 | 김서연 | **새 폴더** 창에 이름을 넣는다(만들지 않음) | `dialog` | `name,submit@r` | — |
| drive-4 | 위와 같음(폴더 「기획」) | 김서연 | 첫 파일의 **공유** 로 **공유 링크** 창을 연다(만들지 않음) | `dialog` | `audience,options,create` | 위와 같음 |
| drive-5 | `/drive/attachments` | 김서연 | 연 그대로 | `filters+save` | `filters,search,group,save@l` | MOB-7·「공지」 채널 첨부 |
| drive-6 | `/drive`(모바일 주문 앱 › 기획) | 김서연 | PDF 「모바일 주문 앱 2.0 요구사항 정의서.pdf」 를 눌러 미리 보기를 연다 — PDF 는 원본 GET 만(변환 요청 없음), AI 요약 GET 은 막음. 캔버스가 칠해질 때까지 기다림 | (전체) | `actions,next,zoom` (`file` 은 기록 안 함) | 드라이브 시드 |
| drive-7 | `/drive`(모바일 주문 앱) | 김서연 | **AI 결과 — once**. 새 대화로 묻는다(POST /ai/chat 만 연다). 찍기만 다시 할 때는 `MANUAL_AI_REUSE=1`. 「드라이브 모바일 주문 앱 › 기획 폴더의 '모바일 주문 앱 2.0 요구사항 정의서.pdf'를 세 줄로 요약해 줘」 | `panel` | `answer` (`panel` 도 기록) | 드라이브 시드 |

### 10 노트

본문을 고치지 않는다. 페이지를 열면 동시 편집 연결(`wss://…/collab`)이 붙는데, 장면은 입력하지 않으므로 빈 동기화 메시지(Yjs 빈 갱신)와 접속 표시만 오간다(2026-10-29 프레임 확인). 페이지 요약(`…/summary`, AI)은 guardReadOnly 가 막는다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| wiki-1 | `/wiki/spaces/<모바일 주문 앱>/pages/<PRD>` | 김서연 | 스페이스를 고르고 **제품 요구사항 (PRD)** 를 연다 | (전체) | `space!inside,tree@r,path,header,body!inside` | 팀 스페이스 노트 3쪽 |
| wiki-2 | 위와 같음 | 김서연 | **페이지 메뉴** 를 연다(항목은 누르지 않음) | `trigger+menu` | `trigger,menu@bl,history@l` | 위와 같음 |
| wiki-3 | 위와 같음 | 김서연 | **공유** 로 **페이지 공유** 창을 연다(이미 링크로 공유한 PRD — 아무것도 바꾸지 않음, 상태를 불러와 스위치가 풀릴 때까지 기다림) | `dialog` | `toggle@l,link,fields` | 위와 같음 |
| wiki-4 | `/wiki/<내 노트>/<연습장>` | 김서연 | 본문에 「/」 를 넣어 블록 메뉴만 연다 — 문서가 맞춰진 뒤 협업 소켓의 보내는 프레임을 버려 저장되지 않게 하고, 끝나면 about:blank 로 나간다 | `slash` | `slash@r` | 내 노트 빈 페이지 「연습장」 |
| wiki-5 | `/wiki/<내 노트>/<연습장>` | 김서연 | **AI 결과 — once**. 빈 페이지 안내의 **AI 초안 작성** 에 주제 「베타 오픈 회고 회의록 틀. 잘한 점, 아쉬운 점, 다음 할 일 세 칸으로.」(POST …/wiki/pages/{id}/ai 만 연다, AI 1회). 협업 보내기 프레임을 버려 페이지에 저장하지 않는다(실행 뒤 본문 그대로 확인) | (전체) | `body` (`header` 도 기록) | 내 노트 빈 페이지 「연습장」 |
| wiki-6 | 위와 같음(같은 장면) | 김서연 | 초안 전에 머리 「AI」 메뉴만 연다 | `button+menu` | `menu@l` (`button` 도 기록) | 위와 같음 |

### 11 연락처

즐겨찾기·추가·수정·삭제는 하지 않는다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| contacts-1 | `/contacts` | 김서연 | **한지우** 를 눌러 상세를 연다 | (전체) | `views!inside,groups@r,search,row@r,detail@r,create` | 구성원 5명·외부 연락처 2명 |
| contacts-2 | 위와 같음 | 김서연 | **새 외부 연락처** 창에 이름·이메일·소속을 넣는다(저장하지 않음) | `dialog` | `name,fields,scope,save@r` | — |
| contacts-3 | `/contacts` | 김서연 | **조직도** 에서 **제품개발팀** 을 누른다 | (전체) | `org,mine,list@r` | 부서 3개·내 그룹 베타 오픈 TF |
| contacts-4 | `/contacts` | 김서연 | **AI 결과 — once**. 새 대화로 묻는다(POST /ai/chat 만 연다). 찍기만 다시 할 때는 `MANUAL_AI_REUSE=1`. 「빠른물류 오세훈 님 연락처 알려 줘」 | `panel` | `answer` (`panel` 도 기록) | 외부 연락처 오세훈 |

### 쓰기로만 만들 수 있는 상태(08~11 시드 보강 후보)

| 쓸 곳 | 상태 | 넣을 데이터 |
| --- | --- | --- |
| 08 버전 | **버전** 화면·버전 상세 | MOB 버전 「베타 1.0」 과 MOB-4~7 (보강 시드 `--app-extras` 로 넣음 — 찍음: work-9) |
| 09 첨부 모아보기 | 이슈·메시지 첨부 목록 | MOB-7 첨부와 「공지」 채널 메시지 첨부 (보강 시드 `--app-extras` 로 넣음 — 찍음: drive-5) |
| 10 블록 메뉴 | 「/」 메뉴 | 내 노트의 빈 페이지 「연습장」 (보강 시드 `--app-extras` 로 넣음 — 찍음: wiki-4, 협업 쓰기는 막는다) |
| 11 그룹 | 조직도·내 그룹 | 부서 3개, 김서연의 내 그룹 「베타 오픈 TF」 (보강 시드 `--app-extras` 로 넣음 — 찍음: contacts-3) |

### 12 내 설정

**저장**·**비밀번호 변경**·**등록**·**발급**·**추가** 는 누르지 않는다. 창은 열고 Escape 로 닫는다. API 토큰 목록에는 토큰 앞자리가 보이므로 목록 행은 자르기에 넣지 않는다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| my-settings-1 | `/settings/profile` | 김서연 | 연 그대로 | (전체) | `nav!inside,profile,password,guide` | — |
| my-settings-2 | `/settings/notifications` | 김서연 | 폭 1024 로 연다(헤드리스 브라우저는 알림 권한 차단 안내가 보인다) | `head+device+row` | `device,app,cols,row` | — |
| my-settings-3 | `/settings/assistant` | 김서연 | 폭 1024 로 연다(토큰 칸은 비어 있다) | `head+mode+memory` | `mode,token,suggest,memory` | — |
| my-settings-4 | `/settings/tokens` | 김서연 | **토큰 발급** 으로 창을 연다(발급하지 않음) | `dialog` | `name,expiry,submit` | — |
| my-settings-5 | 위와 같음 | 김서연 | **다른 도구로 연결 (Claude.ai, ChatGPT 등)** 을 펼친다 | `claude+url` | `claude,other,url` | — |
| my-settings-6 | `/settings/mail` | 김서연 | **계정 추가** 로 창을 연다(공급자 목록은 열지 않음) | `dialog` | `provider,address,imap` | — |
| my-settings-7 | `/settings/my-shares` | 김서연 | 연 그대로 | `filters+rows+unshare` | `filters,rows,unshare` | PRD·출시 체크리스트 링크 공유 |
| my-settings-8 | `/settings/mail` | 김서연 | 폭 1024 로 연다(M365 연결 중에만) | `list+add` | `provider,status,add` | M365 연결 |
| my-settings-9 | `/settings/notifications` | 김서연 | **AI 결과 — once**. 새 대화로 묻는다(POST /ai/chat 만 연다). 찍기만 다시 할 때는 `MANUAL_AI_REUSE=1`. 「휴대폰으로 알림을 받으려면 어디서 켜?」 | `panel` | `answer` (`panel` 도 기록) | — |

### 13 모바일에서 쓰기

뷰포트를 390x844 로 줄여 찍는다(배율 2 → 원본 780x1688, 앱은 폭으로 모바일 셸을 고른다). 고정·순서 저장은 하지 않는다. 가운데 「AI」 는 누르지 않는다(추천 질문 요청이 AI 를 부른다).

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| mobile-1 | `/apps` | 김서연 | 연 그대로 | (전체) | `coach,grid,edit,tabbar!inside` | — |
| mobile-2 | `/apps/tabs` | 김서연 | 연 그대로(**저장** 은 누르지 않음) | (전체) | `intro!inside,slots@l,add!inside,save` | — |
| mobile-3 | `/apps` | 김서연 | 드라이브의 핀 표시를 눌러 메뉴를 연다(항목은 누르지 않음) | `row+tile+menu` | `tile,menu` | — |

### 14 구성원과 역할

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| members-1 | `/settings/users` | 김서연 | 연 그대로 | (전체) | `admin!inside,search,list,create` | 구성원 5명 |
| members-2 | 위와 같음 | 김서연 | **구성원 추가** 로 창을 연다(칸을 채우지 않음) | `dialog` | `id,profile,password,role,more,submit` | — |
| members-3 | `/settings/users/<박지민>` | 김서연 | 목록에서 **박지민** 을 누른다(폭 1024) | `info+active+roles` | `info,active,roles` | — |
| members-4 | `/settings/roles/<USER>` | 김서연 | 목록에서 **USER** 를 누른다 | `lock+perms` | `lock,info,perms` | — |
| members-5 | `/settings/roles/<PARTNER>` | 김서연 | 목록에서 **PARTNER** 를 누른다(저장하지 않음) | `area`(역할 정보~권한 첫 묶음) | `info,perms` (`area` 도 기록) | 역할 PARTNER |

### 15 AI 에이전트 관리

상세 패널 아래쪽(AI 연결 및 모델·공통 비서·API 키)은 찍지 않는다 — **최근 사용** 시각이 AI 가 일할 때마다 바뀐다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| agents-1 | `/settings/agents` | 김서연 | 연 그대로 | (전체) | `toggle,create,row` | 에이전트 지니(공통 비서) |
| agents-2 | 위와 같음 | 김서연 | **지니** 행을 눌러 상세 패널을 연다(저장하지 않음) | `info+active` | `info,mode,active` | 위와 같음 |
| agents-3 | 위와 같음 | 김서연 | **배포 알리미**(release-bot) 행을 눌러 상세 패널을 열고 ② 플러그인 설치까지 내린다 | `area`(① 키 목록은 밖) | `plugin,login,work` (`area` 도 기록) | 외부 에이전트 release-bot |
| agents-4 | 위와 같음 | 김서연 | **지니** 상세를 열고 **AI 연결 및 모델** 까지 내린다. 모델 이름이 채워질 때까지 기다림 | `area`(재발급 단추 안쪽 10px — 「최근 사용」 시각 줄은 자르기 밖) | `conn,model,assistant@r,key!inside` (`area` 도 기록) | — |

### 16 로그인·앱 설정

SSO 화면의 **관리자 동의 링크**(앱 등록 client_id 가 든 주소)는 자르기에 넣지 않는다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| workspace-settings-1 | `/settings/sso` | 김서연 | 폭 1024 로 연다(켜지 않음) | `section+toggle` | `toggle@l` | — |
| workspace-settings-2 | `/settings/apps/work` | 김서연 | 연 그대로 | `table+create` | `table,create,hide` | — (기본 관계 유형) |
| workspace-settings-3 | `/settings/apps/wiki` | 김서연 | 폭 1024 로 연다, 공유 행이 그려질 때까지 기다린다 | `toggle+list` | `toggle,list` | PRD·출시 체크리스트 링크 공유 |

### 17 감사 로그

로그인할 때마다 맨 위에 새 행이 쌓이므로 **설명으로 검색...** 에 「구성원 계정 생성」 을 넣어 시드가 남긴 4행만 남긴다. IP 열(클러스터 내부 주소)은 자르기에 넣지 않는다 — 필터 줄과 표를 따로 찍는다(1440 폭에서는 날짜 칸이 표의 결과·IP 열 위에 있어 한 그림에 넣으면 IP 가 함께 든다). 행은 누르지 않는다(상세에 IP·브라우저 정보가 보인다).

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| audit-logs-1 | `/settings/audit-logs` | 김서연 | 설명 검색 「구성원 계정 생성」, 폭 1024 로 찍는다(날짜 칸이 둘째 줄로 내려간다) | `area+dates`(area = 칸들보다 8px 안쪽) | `search@l,user!inside,result!inside,dates` (`area` 도 기록) | 시드가 남긴 구성원 계정 생성 기록 4건 |
| audit-logs-3 | 위와 같음 | 김서연 | 같은 검색, 폭 1440 | `area`(rows 와 같은 범위, 여백 0) | `rows!inside` (`area` 도 기록) | 위와 같음 |
| audit-logs-2 | 위와 같음 | 김서연 | 같은 검색 뒤 **필터** 를 연다(고르지 않음) | `trigger+menu` | `trigger,menu` | 위와 같음 |

### 쓰기로만 만들 수 있는 상태(12~17 시드 보강 후보)

| 쓸 곳 | 상태 | 넣을 데이터 |
| --- | --- | --- |
| 12 메일 계정 | 연결된 메일 계정 목록 | 시드 아님 — 사용자가 Microsoft 로그인으로 직접 연결 — 찍음: my-settings-8(06 메일 절의 「M365 연결 중에만 찍는다」) |
| 12 내 공유·16 노트 | 공유 중인 페이지 목록 | PRD·출시 체크리스트 링크 공유 (보강 시드 `--app-extras` 로 넣음 — 찍음: my-settings-7·workspace-settings-3) |
| 14 역할 상세 | 관리자가 만든 역할 | 역할 「PARTNER」 (보강 시드 `--app-extras` 로 넣음 — 찍음: members-5) |
| 15 에이전트 | 외부 에이전트 연결 | 외부 에이전트 release-bot (보강 시드 `--app-extras` 로 넣음 — 찍음: agents-3, 키 앞자리가 있는 ① 키 목록은 자르기 밖). 내부 에이전트의 「AI 연결 및 모델」 그림은 지니의 「최근 사용」 시각이 바뀌어 아직 못 찍음 |

## 운영자 매뉴얼

촬영 환경: **격리 로컬 스택**(매번 깨끗한 DB) + `scripts/seed-operator.mjs` 시드. 로그인 계정은 첫 가입으로 만든 슈퍼어드민 **플랫폼 운영자**(`ops@example.com`)다. 뷰포트는 **900x810**(배율 2 → 원본 1800x1620)이다 — 1440 폭에서는 제목과 오른쪽 단추가 원본 2400px 가까이 벌어져 자르기 폭 기준을 지킬 수 없다(`lib/books.mjs` 의 `capture.viewport`).

시드 테넌트: 누리커머스(활성, 구성원 4) · 한빛물류(활성, 2) · 새솔디자인(정지됨, 2) · 다온헬스케어(활성, 2) · 푸른교육(삭제됨, 1). 앱이 처음부터 두는 기본 테넌트 **Default Workspace**(운영자 1명)도 목록에 보인다. 영구 삭제 장면은 돌 때마다 장면이 새로 만드는 별빛스튜디오(slug 는 비어 있는 첫 값 `byeolbit-studio`, `-2`, …)에서만 한다.

장면은 표 순서대로 돈다. tenant-lifecycle-7·8·6 은 **한 장면**(id `tenant-lifecycle-7`, `shots` 로 세 그림을 밝힘)이다 — 영구 삭제를 실제로 시작해야 진행 배너(8)와 삭제됨 목록의 「영구 삭제 중…」 행(6)이 나온다. API 는 영구 삭제 잡의 첫 실행·주기를 모두 길게(`--workplace.tenant-purge.delay-ms=3600000 --workplace.tenant-purge.initial-delay-ms=3600000`) 띄워 영구 삭제 중 상태가 촬영 동안 남게 한다. 장면은 생성·편집·멤버 추가 창을 채우기만 하고 제출하지 않는다(다시 찍어도 같은 화면).

### 01 소개와 로그인

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| introduction-1 | `/login` | 로그아웃 상태(새 컨텍스트) | 아이디·비밀번호 칸을 채운다 | `card` | `username,password,submit` | 운영자 계정 |
| introduction-2 | `/` | 플랫폼 운영자 | 로그인 직후 화면 | (전체) | `tenants,user` | 시드 테넌트 |
| introduction-3 | `/` | 플랫폼 운영자 | 왼쪽 아래 사용자 메뉴를 연다 | `menu+trigger` | `trigger,logout` (`theme` 도 기록) | — |

### 02 테넌트 만들기와 고치기

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| tenants-1 | `/` | 플랫폼 운영자 | 운영 중 목록 | `header+table` | `toggle,row` | 시드 테넌트(정지됨 포함) |
| tenants-2 | `/` | 플랫폼 운영자 | **테넌트 생성** 창에 이름·소유자 이메일을 넣고 **확인** 으로 찾는다(제출하지 않음) | `dialog` | `name,slug,owner,check,submit` | 오민재(소유자 후보) |
| tenants-3 | `/tenants/<누리커머스>` | 플랫폼 운영자 | 상세 화면 위쪽 | `card+quota` | `edit,quota` | 누리커머스 |
| tenants-4 | 위와 같음 | 플랫폼 운영자 | **편집** 을 눌러 창을 연다(제출하지 않음) | `dialog` | `name,slug,save` | 누리커머스 |

### 03 테넌트 구성원

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| tenant-members-1 | `/tenants/<누리커머스>` | 플랫폼 운영자 | 멤버 표가 보이게 내린다 | `members` | `add,table` | 누리커머스 구성원 4명 |
| tenant-members-2 | `/tenants/<다온헬스케어>` | 플랫폼 운영자 | **멤버 추가** 창에 다른 테넌트 구성원 이메일을 넣고 **확인**(제출하지 않음) | `dialog` | `email,check,found,role,submit` | 최유나(누리커머스 소속) |
| tenant-members-3 | 위와 같음 | 플랫폼 운영자 | 없는 이메일을 넣고 **확인**, 이름·초기 비밀번호를 채운다(제출하지 않음) | `dialog` | `name,password,role,submit` (`notice` 도 기록) | — |

### 04 테넌트 정지·활성화와 삭제

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| tenant-lifecycle-1 | `/tenants/<한빛물류>` | 플랫폼 운영자 | 상세 화면 위쪽 | `card` | `suspend` | 한빛물류(활성) |
| tenant-lifecycle-2 | `/tenants/<새솔디자인>` | 플랫폼 운영자 | 상세 화면 위쪽 | `card` | `status,activate` | 새솔디자인(정지됨) |
| tenant-lifecycle-3 | `/tenants/<다온헬스케어>` | 플랫폼 운영자 | 위험 구역이 보이게 내린다 | `danger` | `delete` | 다온헬스케어(활성) |
| tenant-lifecycle-4 | 위와 같음 | 플랫폼 운영자 | **삭제** 를 눌러 확인 창을 연다(확정하지 않음) | `dialog` | `confirm` | 다온헬스케어 |
| tenant-lifecycle-5 | `/tenants/<푸른교육>` | 플랫폼 운영자 | 상세 화면 위쪽 | `banner+card` | `restore` | 푸른교육(삭제됨) |
| tenant-lifecycle-7 | `/tenants/<별빛스튜디오>` | 플랫폼 운영자 | 장면이 돌 때마다 API 로 새로 만들고 삭제한 테넌트에서 **영구 삭제** 창을 열어 이름을 넣는다 | `dialog` | `input,confirm` | 장면이 만든다 |
| tenant-lifecycle-8 | 위와 같음 | 플랫폼 운영자 | 창의 **영구 삭제** 를 눌러 진행 배너가 뜨면 찍는다 | `banner+card` | `banner,status` | 위와 같음 |
| tenant-lifecycle-6 | `/?view=deleted` | 플랫폼 운영자 | 위 장면에 이어 삭제됨 보기 | `header+table` | `toggle,rows` | 푸른교육(삭제됨) + 별빛스튜디오(영구 삭제 중) |

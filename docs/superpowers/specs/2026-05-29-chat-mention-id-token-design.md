# Chat @mention 재설계 — ID 토큰 방식 Design

> Status: Design (승인됨 2026-05-29). 다음 단계: GitHub 이슈 등록 + writing-plans 로 구현 계획 작성.

## 1. 목표

채팅 @mention 의 **저장 포맷과 파싱 방식**을 재설계한다. 멘션의 정답(canonical)을 **불변 user id** 로 두고, 화면에는 **이름(name)** 으로 표시한다. 입력은 TipTap 기반 리치 에디터의 멘션 칩으로 처리한다.

## 2. 배경 / 문제

현재(phase 6a/6d) 멘션 파이프라인:

- 백엔드 `ChatMentionParser` 가 본문을 정규식 `@([a-zA-Z0-9._-]+)` 로 파싱해 **username** 토큰 추출 (`ChatMentionParser.java:16`).
- `ChatUserHydrator.resolveUsernamesToIds` 가 **username 정확 일치**로 user id resolve (`ChatUserHydrator.java:45-48`).
- `ChatMessageService.create`/`update` 가 본문에서 username 파싱 → id resolve → 본문 원문 + mention id(JSONB) 저장, `ChatMessageCreatedEvent` 에 `mentionUserIds` 실어 발행(알림/에이전트 트리거).
- 프론트: `ChatComposer`(textarea + `detectMention` + `ChatMentionPopover`)가 선택 시 `@${username}` 삽입. `ChatMessageRow` 는 본문을 평문 렌더.

**문제:** 이 시스템은 username 이 **이메일**(`bob@example.com`, 에이전트 `ai@ai`)이다. `@` 를 멘션 구분자로 쓰는 자유텍스트 파싱은 username 에 `@` 가 들어가면 깨진다.

- 예: 본문 `@ai@ai` → 정규식이 `ai` 까지만 잘라 토큰 `["ai"]` 추출 → username `ai@ai` 와 불일치 → **멘션 resolve 실패**(검증: `@([a-zA-Z0-9._-]+)` 를 `@ai@ai` 에 적용 시 `['ai','ai']`).
- 결과: (a) 화면에 `@ai@ai` 로 보기 싫게 표시, (b) 멘션이 `mentions[]`/이벤트에 기록되지 않아 **에이전트가 멘션으로 동작하지 않음**.
- 공백/한글 이름(`AI Agent`, `양동희`)도 자유텍스트 파싱으로는 매칭 불가.

업계 표준(Slack `<@U123>`, Discord `<@123>`)은 **본문에 불변 id 토큰을 박고 화면에서 이름으로 렌더**한다. 자유텍스트 표시이름/이메일 파싱을 쓰는 곳은 없다. (GitHub/X 의 `@handle` 은 멘션 안전한 별도 핸들 네임스페이스라 가능.)

## 3. 설계 결정 (확정)

1. **저장 포맷:** 본문에 멘션을 `<@{userId}>` 토큰으로 저장 (Slack식). 정답 = user id.
2. **백엔드 파싱:** `<@(\d+)>` 토큰만 파싱. username 종속 제거.
3. **프론트 입력:** TipTap (`@tiptap/extension-mention`) 리치 에디터, 멘션을 원자 칩으로.
4. **표시:** 본문 `<@id>` → `mentions[]` 로 이름 찾아 칩 렌더, 못 찾으면 `@(알 수 없음)`.
5. **이름 표시 스타일:** 옅은 강조 칩(HUMAN 파랑 계열 / AGENT 보라 계열 — 기존 AGENT 시각 컨벤션과 일관).

## 4. 아키텍처

### 4.1 저장 포맷 & 백엔드 (workplace-api, chat 도메인)

- `ChatMentionParser`: 정규식을 `<@(\d+)>` 로 변경, `parse(body)` → `List<Long>` (중복 제거, 첫 등장 순서 유지).
- `ChatUserHydrator`: username 기반 resolve 제거, **id 검증 메서드** 추가 (`filterActiveUserIds(List<Long>)` — 존재하는 active user id 만 통과, 중복 제거). 기존 `summariesOf(ids)` 는 그대로 활용.
- `ChatMessageService.create`/`update`: `resolveUsernamesToIds(parse(body))` → `filterActiveUserIds(parseIds(body))` 로 교체. 본문은 토큰 포함 원문 그대로 저장. `ChatMessageCreatedEvent` 발행(=`mentionUserIds`)은 **변경 없음** → 알림/에이전트 트리거 경로 그대로 동작(깨져있던 에이전트 멘션 복구).
- **DTO/응답 계약 불변:** `ChatMessageResponse.mentions: ChatMentionResponse[]`(id, username, name, kind)는 저장된 id 로 그대로 hydrate. 변하는 것은 `body` 의 내용(토큰 형식)뿐.

### 4.2 프론트 입력 — `ChatRichInput` (신설, TipTap 래퍼)

`ChatComposer` 와 `ChatMessageEditor` 가 공용하는 단일 리치 입력 컴포넌트.

- **익스텐션:** 최소 구성 `Document` + `Paragraph` + `Text` + `@tiptap/extension-mention`.
- **mention suggestion:** `@` 트리거 → thread 멤버(`thread.members`)를 쿼리로 필터 → 팝업에 **이름 + AgentBadge**(picker 한정 보조로 username/email 작게 표기 가능). 선택 시 원자 멘션 노드 삽입 (attrs: `id`=userId, `label`=name).
- **직렬화 `serializeToBody(doc): string`:** TipTap **JSON 도큐먼트(평문 객체, `editor.getJSON()`)** 를 입력으로 받아 순회 → 텍스트 노드는 원문, mention 노드는 `<@{id}>`, 문단 경계는 `\n`. 에디터/DOM 비의존 → node 환경 vitest 로 단위 테스트.
- **역직렬화 `bodyToDoc(body, mentions): JSONContent`:** 본문 `<@(\d+)>` → mention 노드(label 은 `mentions[]` 의 name; 없으면 "알 수 없음")를 포함한 TipTap JSON 생성. 수정 진입 시 `editor.commands.setContent(json)` 로 주입. 에디터/DOM 비의존 → 단위 테스트.
- **키맵:** Enter=전송/저장, Shift+Enter=줄바꿈, Esc=취소(editor 모드). **IME 는 ProseMirror 가 composition 처리** → 한글 Enter 중복(#40)이 구조적으로 해소. 전송 후 `clearContent()` + `focus()` 로 포커스 유지(#41). pending 중에도 입력창 disable 안 함.
- **Props(안):** `{ initialBody?, members, placeholder?, onSubmit(body), onCancel?, autoFocus? }`.

기존 `detectMention.ts` / `ChatMentionPopover.tsx` 는 TipTap suggestion 으로 대체되어 제거(비주얼은 suggestion 렌더에 재활용 가능). `ChatComposer` / `ChatMessageEditor` 는 `ChatRichInput` 를 감싸는 얇은 래퍼로 축소.

### 4.3 표시 렌더 — `ChatMessageRow`

- 순수 유틸 `renderMessageBody(body, mentions): ReactNode[]` 신설: 본문을 `<@(\d+)>` 기준 분할 → 토큰은 `mentions[]` 에서 id 로 이름 찾아 **칩**(`@이름`, HUMAN 파랑/AGENT 보라)으로, 못 찾으면 `@(알 수 없음)` 폴백, 나머지 텍스트는 `whitespace-pre-wrap` 유지. (vitest 단위 테스트 대상)
- `deleted` 메시지는 기존대로 `(삭제됨)` 처리.

### 4.4 수정 — `ChatMessageEditor`

- textarea → `ChatRichInput` 재사용. `initialBody`(토큰 포함)를 `bodyToDoc` 으로 칩 복원해 편집, 저장 시 `serializeToBody` 로 `<@id>` 직렬화. Enter=저장 / Esc=취소.

## 5. 데이터 흐름 (작성 happy path)

1. 사용자가 `@` 입력 → suggestion 팝업 → 멤버 선택 → 에디터에 멘션 칩(id=99) 삽입.
2. Enter → `serializeToBody` → `"안녕 <@99>"` → `useCreateChatMessage` 가 `{ body: "안녕 <@99>" }` POST.
3. 백엔드 `create`: `parse("안녕 <@99>")` → `[99]` → `filterActiveUserIds` → 저장 + 이벤트.
4. 응답: `body="안녕 <@99>"`, `mentions=[{id:99, username:"ai@ai", name:"AI", kind:"AGENT"}]`.
5. `ChatMessageRow`: `renderMessageBody` → `"안녕 "` + 보라 칩 `@AI`.

## 6. 하위호환 / 마이그레이션

- 기존 메시지의 옛 `@username` 본문은 `<@id>` 토큰이 아니므로 **평문으로 렌더**(칩 없음). 단, 그 메시지의 `mentions[]` 는 작성 당시 저장된 id 라 그대로 존재.
- 로컬 dev 환경이라 **마이그레이션/백필 없이 수용**. (운영 도입 시 백필 스크립트는 별도 — 현재 YAGNI.)
- 에이전트 username `ai@ai` 정리는 **더 이상 멘션 때문에 필요 없음**(멘션은 id 기준). 원하면 별도로 정리.

## 7. 테스트

- **백엔드:** `ChatMentionParserTest` 를 `<@id>` 포맷으로 갱신(`<@42>` → `[42]`, 중복/혼합 케이스, 비토큰 `@foo` 무시). `ChatMessageService` create/update 가 토큰→검증된 id 저장하는지(통합).
- **프론트 단위(vitest):** `serializeToBody`/`bodyToDoc` 라운드트립, `renderMessageBody` 분할(토큰/폴백/혼합).
- **E2E(`chat.spec.ts`):** `@mention typeahead` 케이스 갱신 — `@` → suggestion → 멤버 선택 → 칩 → 전송 시 POST `body="<@99>..."`, 렌더 메시지에 `@AI Agent` 칩. AGENT 칩 시각 케이스. scroll/포커스 회귀 유지(단, 입력 셀렉터가 textarea→contenteditable 로 바뀌므로 셀렉터 갱신).

## 8. 범위 & #40/#41 관계

- 규모: backend(파서/하이드레이터/서비스/테스트) + frontend(TipTap 의존성 추가, `ChatRichInput`, composer/editor 재작성, row 렌더 유틸, 단위+E2E).
- **#40(IME)·#41(포커스)** 는 이미 커밋됨(`872bcc7`, `dd8d07a`). composer 가 TipTap 으로 교체되면 textarea 기반 IME/포커스 처리는 ProseMirror/`ChatRichInput` 으로 **대체**된다. **#40-2 스크롤 수정(ChatMessageList)과 회귀 테스트는 유지**.

## 9. Out of scope (YAGNI)

- 멘션 자동완성에서 thread 비멤버 검색/자동 추가(현 6a 동작 유지).
- 운영 데이터 백필.
- 채널/role/@here 류 특수 멘션.
- 리치 텍스트 그 외 기능(볼드/링크 등) — 멘션 칩만.

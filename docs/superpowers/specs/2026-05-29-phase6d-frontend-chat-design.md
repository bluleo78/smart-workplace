# Phase 6d — 프론트 chat panel (REST 폴링 MVP) 설계

> sub-epic: #39 (epic #21)
> 의존: ✅ Phase 6a (#36) — chat REST API 완료
> 후속: Phase 6b (#37, WebSocket 전환), Phase 6c (#38, ai-agent @mention 응답)

## 1. 목적·범위

이슈 상세 페이지에 chat panel 을 inline section 으로 노출, 사용자가 이슈 컨텍스트 안에서 thread 멤버(사람·AGENT) 와 짧은 turn 을 주고받을 수 있게 한다. **MVP** 는 REST + visible polling 만 사용; WebSocket 은 #37 에서 도입.

### 검증 가능한 결과
- 이슈 상세에 chat section 노출, 미 마운트 상태에서 thread 호출 안 함 (lazy fetch)
- 메시지 작성 — Optimistic UI + 서버 확정 또는 rollback
- @mention typeahead 동작 — Slack 스타일 인라인
- AGENT 메시지 시각 구분 — 기존 `AgentBadge` 재사용
- 본인 메시지 hover → 인라인 수정 / 삭제
- 스크롤이 마지막 메시지 도달 시 mark-as-read 1회 발화 (debounce 1s)
- 폴링: 이슈 상세 활성 + `document.visibilityState === 'visible'` + chat section in-viewport 일 때만 5초 주기

### 비목표
- ❌ WebSocket / SSE — Phase 6b
- ❌ 타이핑 인디케이터
- ❌ 멤버 add/remove UI — 6a 백엔드만 노출, 화면은 없음
- ❌ 검색 / pin / reaction
- ❌ markdown 렌더링 — plain text + 기본 줄바꿈만
- ❌ 첨부 / 이미지 paste

## 2. 컴포넌트·파일 구조

```
apps/workplace-web/src/
├── api/chat.ts                                       # API 클라이언트 (7 endpoints)
├── types/chat.ts                                     # 백엔드 DTO 1:1 매칭 타입
├── hooks/queries/
│   ├── useChatThread.ts                              # GET thread (lazy 생성 트리거)
│   ├── useChatMessages.ts                            # useInfiniteQuery + visible polling
│   ├── useCreateChatMessage.ts                       # mutation + optimistic
│   ├── useUpdateChatMessage.ts                       # mutation
│   ├── useDeleteChatMessage.ts                       # mutation
│   └── useMarkChatRead.ts                            # debounced mutation
└── pages/projects/components/chat/
    ├── IssueChatSection.tsx                          # inline section 컨테이너 (thread 로딩·에러)
    ├── ChatMessageList.tsx                           # ScrollArea + pagination + mark-read 트리거
    ├── ChatMessageRow.tsx                            # 메시지 1건 (AgentBadge, hover toolbar)
    ├── ChatMessageEditor.tsx                         # 인라인 수정 textarea (저장/취소)
    ├── ChatComposer.tsx                              # 작성 폼 + 멘션 detection
    └── ChatMentionPopover.tsx                        # @ 인라인 typeahead popover
```

`IssueDetailPage.tsx` 는 본문·코멘트·활동 아래 `<IssueChatSection projectKey number />` 한 줄 추가.

## 3. 데이터 흐름

### 3.1 초기 로드 (lazy 생성)

1. `IssueChatSection` 마운트 → `useChatThread(projectKey, number)` 발화
   - `GET /api/v1/projects/{key}/issues/{number}/chat/thread` (6a 가 lazy 생성)
   - 응답: `ChatThreadResponse` (thread, members, recentMessages)
2. 초기 메시지 캐시 시드: `useChatMessages(threadId)` 의 첫 페이지를 thread 응답의 `recentMessages` 로 미리 채움 (`queryClient.setQueryData`)
3. 이후 사용자가 위로 스크롤 → `fetchNextPage` 트리거 → `GET /chat/threads/{id}/messages?cursor=`

### 3.2 폴링

```
enabled  = thread 로드 완료 && in viewport && document.visible
interval = enabled ? 5_000 : false
```

- `IntersectionObserver` 로 section root 의 viewport 진입/이탈을 추적해 state `isInView` 로 보관
- `useEffect` + `document.addEventListener('visibilitychange')` 로 `isPageVisible` 추적
- `refetchInterval` 은 위 두 값 중 하나라도 false 면 `false`
- refetch 대상: **첫 페이지만** — 폴링은 `useChatMessages` 의 첫 페이지를 invalidate, 새 메시지가 cursor 보다 위에 추가됨
- 다중 탭 폴링 충돌은 6a 가 race-safe 이고 GET 만 발생하므로 무해

### 3.3 메시지 작성 (Optimistic)

`useCreateChatMessage.mutate({ body, mentionUserIds })`:

1. `onMutate`: 임시 메시지 `{ id: -randomInt, status: 'pending', authorId: me, body, createdAt: Date.now() }` 을 첫 페이지 끝에 push, 이전 상태 snapshot 저장
2. `mutationFn`: `POST /chat/threads/{id}/messages` → 서버가 영구 id·정규화된 mentions 반환
3. `onSuccess`: 임시 메시지를 서버 응답으로 replace
4. `onError`: snapshot 복원 + toast "메시지 전송 실패"
5. `onSettled`: 첫 페이지 invalidate (다른 사용자 동시 전송 반영)

### 3.4 수정 / 삭제

- 본인 메시지 hover → 우측 상단에 `Pencil` / `Trash2` 아이콘 표시
- 수정: 행을 `ChatMessageEditor` 로 swap (textarea + 저장/취소). 저장 → `PATCH /messages/{id}` → 성공 시 캐시 업데이트, 실패 시 toast
- 삭제: 클릭 즉시 `DELETE /messages/{id}` (확인 dialog 없음 — soft-delete 라 복구 가능, MVP 마찰 최소화). 캐시에서 `deletedAt` 세팅 → 행 본문 "(삭제됨)" 으로 마스킹

### 3.5 Mark-as-read

- `ChatMessageList` 의 **마지막 메시지** DOM 에 `IntersectionObserver` 부착
- 진입 시: `useMarkChatRead.mutate({ uptoMessageId: lastId })` 호출 — `lodash.debounce(1000, { trailing: true })` 로 폭주 방지
- 새 메시지가 폴링으로 들어오면 자동으로 last 가 갱신되어 다시 발화 (사용자가 viewport 떠나면 발화 안 함 — 안 읽음 카운트 보존 가능)
- 응답은 무시; 실패해도 toast 없음 (조용히 retry on next intersection)

## 4. @mention typeahead (Slack 스타일)

### 4.1 검출

`ChatComposer` textarea 의 `onInput` 에서 caret 직전 텍스트를 살펴봄:

```ts
function detectMention(textBeforeCaret: string): { query: string; anchor: number } | null {
  // 마지막 @ 위치, 앞이 공백 또는 문자열 시작
  const match = textBeforeCaret.match(/(?:^|\s)@([\w._-]{0,20})$/);
  if (!match) return null;
  return { query: match[1], anchor: textBeforeCaret.length - match[1].length - 1 };
}
```

- 검출되면 `ChatMentionPopover` 를 textarea caret 위치 근처에 띄움 (`@uiw/react-textarea-code-editor` 사용 안 함, caret pixel 위치 측정은 `getBoundingClientRect` + caret offset 사용)
- popover 위치 측정의 픽셀 정확도는 MVP 에서 unimportant — caret 가 있는 line 의 좌상단 anchor 면 충분

### 4.2 후보 목록

- 데이터 소스: `useChatThread` 응답의 `members: ChatMemberResponse[]`
- 필터: `member.name.toLowerCase().includes(query) || member.username.toLowerCase().includes(query)`
- 최대 8개 표시, AGENT 멤버 우선 노출 (검출된 query 가 빈 문자열일 때만)
- 각 항목에 `<AgentBadge>` (AGENT) 또는 avatar (HUMAN)

### 4.3 키보드 / 선택

- popover 가 열려 있는 동안 textarea `keydown` 가로채기:
  - `↑` / `↓` : 선택 이동
  - `Enter` / `Tab` : 선택 확정 → 텍스트 치환 `@username ` (trailing space)
  - `Esc` : popover 닫고 textarea focus 유지
- Enter 의 기본 동작 (메시지 전송) 은 popover 가 열린 동안에만 가로채짐
- 외부 클릭 / focus loss : popover 닫음
- 선택 시 `mentions` 배열에 `{ userId, start, end }` 누적 → submit 시 `mentionUserIds: number[]` 로 전송

### 4.4 표시 (수신 측)

- 메시지 body 에 포함된 `@username` 토큰은 정규식으로 찾아 `<span data-mention={userId}>` 로 감싸 노출 (서버가 응답에 `mentions` 배열을 함께 주므로 username 으로 매핑)
- AGENT 가 멘션 대상이면 텍스트 옆에 작은 보라 dot 인디케이터 (선택적 — MVP 에서는 그냥 굵게 표시만)

## 5. 시각·접근성

### 5.1 레이아웃

- `IssueChatSection` 은 `<Card>` 컴포넌트 사용, max height = `min(60vh, 480px)`, 내부 `<ScrollArea>` 에 메시지 리스트
- 헤더: "이슈 채팅" + 멤버 수 배지 + (멤버 추가 버튼은 MVP 비노출)
- 본문: 메시지 리스트 (역연대순 X — 최신이 아래, Slack 스타일)
- 푸터: `ChatComposer` (sticky bottom)

### 5.2 AGENT 구분

- AGENT 메시지 행: 좌측 보더 `border-l-2 border-purple-400`, 아바타 자리에 `<Bot>` 아이콘, 이름 옆 `<AgentBadge size="xs" />`
- HUMAN 메시지 행: 좌측 보더 없음, avatar fallback `<User>`

기존 `apps/workplace-web/src/components/users/AgentBadge.tsx` 재사용. 코멘트/타임라인 의 blue/AI 패턴(#35) 과 불일치하지만, 이 epic 의 진입 시점에 통일은 보류 — 추후 일관화 별도 작업.

### 5.3 빈 상태

- 메시지 0개: 중앙에 "아직 대화가 없어요. 첫 메시지를 남겨보세요." + 작성 폼 활성

### 5.4 에러

- `useChatThread` 실패: section 영역에 retry 버튼 + 에러 메시지
- `useChatMessages` 실패: 리스트 상단에 inline error banner + "다시 시도" 버튼
- 작성/수정/삭제 실패: toast — `useToast()` 의 `destructive` variant

### 5.5 접근성

- 메시지 행은 `<li>` 안 `role="article" aria-label="<author>: <preview>"`
- composer textarea: `aria-label="채팅 메시지 작성"`
- mention popover: `role="listbox"`, 옵션 `role="option" aria-selected`
- toolbar 버튼: `aria-label="수정"` / `aria-label="삭제"`

## 6. API 클라이언트 (`src/api/chat.ts`)

`src/api/issues.ts` 의 axios 패턴 그대로. 7개 함수:

```ts
export async function getChatThread(projectKey: string, issueNumber: number): Promise<ChatThreadResponse>;
export async function getChatMessages(threadId: number, cursor?: string): Promise<ChatMessagePage>;
export async function createChatMessage(threadId: number, payload: CreateChatMessageRequest): Promise<ChatMessageResponse>;
export async function updateChatMessage(messageId: number, payload: UpdateChatMessageRequest): Promise<ChatMessageResponse>;
export async function deleteChatMessage(messageId: number): Promise<void>;
export async function markChatRead(threadId: number, payload: MarkChatReadRequest): Promise<void>;
export async function addChatMember(threadId: number, payload: AddChatMemberRequest): Promise<ChatMemberResponse>; // 노출 안 함, 타입 보강용
```

타입은 `src/types/chat.ts` 가 6a 의 record DTO 와 1:1.

## 7. 테스트 전략

### 7.1 E2E (Playwright) — `apps/workplace-web/e2e/pages/projects/chat.spec.ts`

`page.route()` 로 7 endpoint 모킹. 최소 5 케이스:

1. **happy path** `@smoke` — 이슈 진입 → chat section 노출 → 작성 → optimistic UI 즉시 표시 → POST payload 검증 → 서버 응답 후 confirmed 상태
2. **mention typeahead** — `@` 입력 → popover 노출 → 멤버 클릭 → textarea 치환 → 전송 시 `mentionUserIds: [id]` 페이로드 확인
3. **AGENT 시각 구분** — 모킹 메시지에 AGENT 1건 → `AgentBadge` 노출 + `data-agent="true"` 속성
4. **수정/삭제** — 본인 메시지 hover → 편집 → PATCH 호출 + 캐시 갱신 / 삭제 → DELETE 호출 + "(삭제됨)" 마스킹
5. **mark-read** — 새 메시지 도착 후 스크롤 → `POST /threads/{id}/read` 1회 호출, `uptoMessageId` 일치

### 7.2 단위 (필요한 만큼만)

- `detectMention()` 순수 함수: 다양한 입력에 대한 `query/anchor` 검증
- `useChatMessages` 의 폴링 활성 조건: jsdom 에서 `document.visibilityState` mocking + `IntersectionObserver` mocking — RTL 로 hook 단독 테스트

### 7.3 시각 검증

`pnpm dev` 실행 후 브라우저에서 다음 골든 패스를 직접 확인:
- 빈 상태 → 첫 메시지 → 즉시 노출
- @mention 인라인 작동
- AGENT 행 색 구분
- hover toolbar
- 페이지 비활성 (탭 전환) 시 폴링 멈춤 (Network 탭 확인)

## 8. 구현 순서 (task 분해 가이드)

1. types + api 클라이언트 + queries 훅 (E2E 가 의존)
2. `IssueChatSection` + `ChatMessageList` + `ChatMessageRow` (정적 렌더)
3. `ChatComposer` 단순 버전 (멘션 없이) — 작성·optimistic
4. `ChatMentionPopover` + `detectMention` 통합
5. 수정/삭제 toolbar + `ChatMessageEditor`
6. mark-read 통합
7. 폴링 visible 조건 통합
8. E2E 스펙
9. IssueDetailPage 통합 + 시각 검증

## 9. 위험·주의

- **폴링 코스트**: 첫 페이지 invalidate 가 매 5초마다 발생 — 메시지 N 개 응답 페이로드 평균 < 20KB. 다중 사용자 시 서버 부담 미미하나, Phase 6b 의 WebSocket 으로 빠르게 전환할수록 좋음
- **Optimistic ↔ 서버 응답 race**: 사용자가 빠르게 연속 전송 시 임시 id 충돌 가능 → `crypto.randomUUID()` 기반 음수 id 사용 (TS 타입은 number; UUID hash 가 안전)
- **Mention 정규식의 unicode**: 한글 username 가능성? 6a 에서 username 은 ASCII 만 허용 (V11 schema) → 안전
- **AGENT self-mention 무한 루프**: 6c 이슈, 6d 와 무관

## 10. Out of scope (명시)

- WebSocket / SSE 연결 — #37
- ai-agent 가 chat 메시지 작성 — #38
- 멤버 add/remove UI
- 메시지 검색
- 첨부 / 이미지 paste
- markdown 렌더링
- 알림 뱃지 (unread count) — `last_read_message_id` 활용한 별도 작업
- 모바일 반응형 polish (기본 동작만 보장)

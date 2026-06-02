# Messaging Phase 4 설계 — @멘션 + 메시지 수정/삭제 + 읽음 추적

- 날짜: 2026-06-02
- 이슈: [#61](https://github.com/users/bluleo78/projects/4) — `[messaging] @멘션 + 메시지 수정/삭제 + 읽음 추적`
- 의존: Phase 3 DM(#60, 완료)
- 출처 로드맵: `docs/superpowers/specs/2026-06-01-messaging-phase1-design.md` §단계 분할

## 목표

팀 채팅(messaging)에 세 기능을 추가한다. 모두 이슈 컨텍스트 chat 도메인에 이미 구현·검증된 패턴을 **포팅**하는 작업이다.

1. **@멘션** — 메시지에 사용자 멘션 입력·저장·렌더 (notify 인박스 알림은 제외)
2. **메시지 수정/삭제** — 작성자 본인 수정(`edited_at`) + soft-delete 마스킹(`deleted_at`)
3. **읽음 추적** — `last_read_message_id` 동기화 + 사이드바 채널/DM별 안읽음(unread) 배지

## 비목표 (YAGNI)

- **notify 인박스 연동 제외**: 현재 chat 멘션도 notify 알림을 생성하지 않으며, `notification` 테이블은 issue 전용(`issue_id NOT NULL`)이다. 멘션 알림은 별도 후속 작업으로 분리한다. 멘션된 사용자는 SSE/unread 로 인지한다.
- **메시지 목록 내 unread divider("여기까지 읽음" 구분선) 제외**: 사이드바 배지로만 노출한다.
- 스레드 답글·리액션(Phase 5), 파일 첨부(Phase 6), AI 멤버(Phase 7)는 범위 밖.

## 아키텍처 원칙

- **모듈 경계 준수**: Spring Modulith 상 `messaging` 모듈이 `chat` 모듈을 직접 의존하지 않는다. 공유 로직은 백엔드 `global`(이미 `SseRegistry` 위치), 프론트 신규 `src/components/mentions/` 로 추출한다.
- chat 의 import 경로는 추출된 공유 모듈을 가리키도록 리팩터한다 (동작 동일, 회귀 없음).

## 마이그레이션 (V25)

`message` 테이블에 멘션 컬럼만 추가한다. 나머지 컬럼은 V19 에 이미 존재.

```sql
-- V25__messaging_mentions.sql
ALTER TABLE message ADD COLUMN mentions JSONB NOT NULL DEFAULT '[]';
```

이미 존재(추가 불필요):
- `message.edited_at TIMESTAMPTZ`, `message.deleted_at TIMESTAMPTZ` (V19)
- `channel_member.last_read_message_id BIGINT` (V19)

마이그레이션 번호: V22=notify, V23=DM, **V24=saved_view_pin(main 선점)** → **다음은 V25**.

## 백엔드 설계

### 공유 추출 (`global` 모듈)

| 신규/이동 | 출처 | 내용 |
|---|---|---|
| `MentionParser` | `chat/service/ChatMentionParser` | regex `<@(\d+)>` → `List<Long>`, 순서 유지 dedup, Long 오버플로 가드. 도메인 무관 → 일반화. |
| `UserMentionHydrator` | `chat/service/ChatUserHydrator` | `filterExistingUserIds(ids)`, `asMentionResponses(ids)`(id/username/name/kind 배치 조회), `summariesOf(ids)`. `user` 테이블만 조회 → 공유. |
| `MentionResponse` (공유 DTO) | chat 의 동등 DTO | `{ id, username, name, kind }` |

chat 도메인은 위 공유 컴포넌트를 사용하도록 수정한다(기존 chat 테스트로 회귀 확인).

### @멘션

- `MessageRepository`: `mentions JSONB` 컬럼 read/write (insert·select·update 에 반영).
- `MessageService.create`: body 파싱(`MentionParser`) → `filterExistingUserIds` 로 검증 → 저장 → 응답에 hydrate(`asMentionResponses`). chat `ChatMessageService.create` 미러.
- `MessageResponse`: `mentions: List<MentionResponse>` 추가.
- `MessageCreatedEvent` payload 에 mentions 포함 → `MessageSseDispatcher.onCreated` 전달.

### 메시지 수정/삭제 (chat `ChatMessageService.update/delete` 미러)

- `MessageRepository`:
  - `update(id, body, mentionIds)` → `SET body=?, mentions=?, edited_at=NOW()`
  - `softDelete(id)` → `SET deleted_at=NOW()`
  - `findAuthorId(id)`, `findChannelId(id)`
- `MessageService.update(callerId, messageId, body)`: 작성자 본인 확인 → 멘션 재파싱 → `update` → `MessageUpdatedEvent`.
- `MessageService.delete(callerId, messageId)`: 작성자 본인 확인 → `channelId` 조회(fan-out 용) → `softDelete` → `MessageDeletedEvent`.
- 신규 이벤트 `MessageUpdatedEvent`/`MessageDeletedEvent` (`MessagingDomainEvents`).
- `MessageSseDispatcher.onUpdated/onDeleted` (AFTER_COMMIT) → `fanOut(memberIds, "messaging.message.updated|deleted", payload)`.
- REST (`MessageController`): `PATCH /api/v1/messaging/messages/{id}` body `{body}`, `DELETE /api/v1/messaging/messages/{id}`.
- 응답 `toResponse`: `deleted_at IS NOT NULL` 이면 body 를 `"(삭제됨)"` 로 마스킹, `deleted=true`.

### 읽음 추적

- `ChannelMemberRepository.markRead(channelId, userId, upto)` → `SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, ?), ?)`. chat `ChatThreadMemberRepository.markRead` 미러.
- `MessageService.markRead(callerId, channelId, uptoMessageId)`: 멤버 확인 → `markRead` → `MessageReadEvent`.
- `MessageSseDispatcher.onRead` → `fanOut(memberIds, "messaging.message.read", {channelId, userId, lastReadMessageId})`.
  - 본인 multi-device 동기화가 주 목적이므로 멤버 전체 fan-out (chat 동일 패턴).
- REST: `POST /api/v1/messaging/channels/{id}/read` body `{uptoMessageId}`.
- **Unread-count** (⚠️ net-new 설계 — 포팅 아님): chat 에는 메시지 unread 배지 선례가 없다. notify 의 `useUnreadCount`(인박스 알림 카운트)를 개념적으로만 참고한다. mark-read 동기화는 chat 에서 포팅하되, *집계·노출* 은 신규 설계로 취급한다.
  - 채널 목록 조회(`ChannelService.list`) 시 채널별 안읽음 수를 단일 상관 서브쿼리로 집계:
    `unreadCount = count(message m WHERE m.channel_id = c.id AND m.id > COALESCE(member.last_read_message_id, member_init) AND m.deleted_at IS NULL AND m.author_id <> :callerId)`
    - 본인 메시지는 제외(보낸 직후 자기 채널이 unread 로 뜨지 않게).
  - **신규 멤버 초기값**: 채널 join 시 `last_read_message_id` 를 *그 시점의 최신 메시지 id* 로 초기화한다(`ChannelMemberRepository.join/add` 수정). → 가입 전 히스토리가 거대한 unread 배지로 뜨는 것 방지. (대안인 "NULL=전체 미읽음" 은 폐기.)
  - 비용: 채널 목록당 채널 수만큼의 상관 서브쿼리. 채널 수가 작아 list 응답에 인라인으로 충분(별도 엔드포인트 불필요). 추후 채널 수 급증 시 batch count 로 최적화.
  - `ChannelResponse` 에 `unreadCount: long` 추가.

## 프론트엔드 설계

### 공유 추출 (`src/components/mentions/`)

chat 에서 이동, chat import 경로 수정:
- `RichInput` ← `pages/projects/components/chat/ChatRichInput` (TipTap + @mention extension + 멤버 suggestion popup + IME/Enter/Esc 처리)
- `mentionSerialize` ← 동일 (`serializeToBody`, `bodyToDoc`)
- `parseMessageSegments` ← 동일 (`body, mentions` → segment[])
- `chat-mentions.ts` 의 `hydrateMentions` 는 공유 위치로 이동 또는 재export.

### @멘션

- `MessageComposer`: `Textarea` → `RichInput`. 멘션 후보 source = 해당 채널/DM 멤버 목록.
- `MessageList`/`MessageRow`: `parseMessageSegments` 로 멘션 칩 렌더 (chat 의 색상 컨벤션 유지).
- 타입(`types/messaging.ts`): `MentionResponse` 추가, `MessageResponse.mentions: MentionResponse[]`.

### 메시지 수정/삭제

- `MessageList` 를 `MessageRow` 구조로 — hover 툴바(수정/삭제 아이콘), `(수정됨)` 배지, 인라인 에디터(`RichInput` 재사용). chat `ChatMessageRow`/`ChatMessageEditor` 포팅.
- 훅: `useUpdateMessage(channelId)`, `useDeleteMessage(channelId)` (낙관적 캐시 패치). `messagingApi.updateMessage/deleteMessage`.
- `useMessageStream`: `messaging.message.updated`(upsert) / `messaging.message.deleted`(마스킹) 핸들러 추가.

### 읽음 추적

- `MessageList`: `IntersectionObserver` 로 마지막 메시지 가시 시 `useMarkMessageRead(channelId)(lastId)` 호출. chat `ChatMessageList` 포팅.
- `useMessageStream`: `messaging.message.read` 핸들러 — 채널 멤버/배지 캐시의 `lastReadMessageId` 갱신.
- **사이드바**: 채널/DM 행에 `unreadCount` 배지. 갱신은 **notify 선례(`useUnreadCount`/`useNotificationStream`)와 동일한 invalidate→refetch 패턴**을 따른다 — `messaging.message.created`·`messaging.message.read` SSE 수신 시 채널 목록 쿼리(`unreadCount` 포함)를 invalidate 하여 서버가 정확한 수를 재산출. 클라이언트 낙관적 +1/-1 은 쓰지 않는다(drift 방지, 구현 단순). 현재 열려 있는 채널은 IntersectionObserver mark-read 로 즉시 0 이 되고, 다음 refetch 에서 서버값과 일치.
- 훅/타입: `useMarkMessageRead`, `messagingApi.markRead`, `ChannelResponse.unreadCount`.

## 컴포넌트 경계 요약

| 단위 | 책임 | 의존 |
|---|---|---|
| `global/MentionParser` | body 텍스트 → 멘션 ID 추출 | 없음 |
| `global/UserMentionHydrator` | 멘션 ID 검증·하이드레이트 | `user` 조회 |
| `messaging/MessageService` | 메시지 CRUD·읽음·이벤트 발행 | repo, parser, hydrator |
| `messaging/MessageSseDispatcher` | 이벤트 → SSE fan-out | `SseRegistry` |
| `components/mentions/RichInput` | 멘션 입력 UI | TipTap |
| `components/mentions/parseMessageSegments` | body → 렌더 세그먼트 | 없음 |
| `useMessageStream` | SSE 이벤트 → 캐시 동기화 | react-query |

## 에러 처리

- 수정/삭제 권한: 작성자 아님 → `403`. 존재하지 않는 메시지 → `404`.
- 멘션: 존재하지 않는 user ID 는 저장 단계에서 필터(`filterExistingUserIds`) — 무시.
- markRead: 비멤버 → `403`. `uptoMessageId` 가 과거이면 `GREATEST` 로 무시(역행 방지).
- 빈/초과(>4000) body: 기존 `message` 제약(1–4000) 검증 재사용.

## 테스트

### 백엔드 (JUnit 통합)
- 멘션: 저장/검증(미존재 ID 필터)/응답 hydrate, 수정 시 멘션 재파싱.
- 수정/삭제: 본인 수정 성공, 타인 수정/삭제 403, soft-delete body 마스킹, `edited_at` 세팅.
- 읽음: `markRead` 단조 증가(GREATEST), unread-count 집계 정확도(NULL last_read 포함), 비멤버 403.
- SSE: created/updated/deleted/read 이벤트 fan-out 멤버 대상 확인.
- chat 회귀: 공유 추출 후 기존 chat 멘션/수정/삭제/읽음 테스트 통과.

### 프론트엔드 (Playwright E2E)
- 멘션 입력(suggestion 선택)·전송·칩 렌더.
- 메시지 수정(`(수정됨)` 표시)·삭제(`(삭제됨)` 마스킹).
- unread 배지: 새 메시지 수신 시 증가, 채널 진입·읽음 시 소멸.

## 단계 분할 (구현 순서 가이드)

0. **그린 베이스라인 확보**: worktree 에서 `pnpm install` → chat 백엔드/프론트 테스트 실행해 *시작점이 green* 임을 확인(공유 추출 회귀를 기존 실패와 구분하기 위함).
1. **공유 추출** (백엔드 `global` parser/hydrator, 프론트 `components/mentions/`) + chat 리팩터 + chat 회귀 통과
2. **백엔드 @멘션** (V24, repo/service/dto/event/SSE) + 통합 테스트
3. **백엔드 수정/삭제** (repo/service/event/SSE/REST) + 통합 테스트
4. **백엔드 읽음+unread-count** (repo/service/event/SSE/REST, ChannelResponse) + 통합 테스트
5. **프론트 멘션** (RichInput 교체, 렌더, 타입)
6. **프론트 수정/삭제** (MessageRow 툴바, 훅, SSE 핸들러)
7. **프론트 읽음+배지** (IntersectionObserver, 사이드바 배지, SSE 핸들러)
8. **E2E** + 정리

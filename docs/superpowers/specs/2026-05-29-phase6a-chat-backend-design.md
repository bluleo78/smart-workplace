# Phase 6a: chat 도메인 백엔드 설계 (#36)

작성일: 2026-05-29
대상 이슈: [#36](https://github.com/bluleo78/smart-workplace/issues/36)
부모 epic: [#21](https://github.com/bluleo78/smart-workplace/issues/21)

## 목표

이슈 컨텍스트에 chat thread 를 두고, AI/담당자와 양방향 대화를 가능하게 하는 백엔드 모델·REST API 를 구축한다. 실시간 push (WebSocket) 는 본 epic 의 #6b 가 담당하고, 본 작업은 폴링 기반으로 완전 동작하는 REST API 까지를 책임진다.

## 비목표

- WebSocket / SSE — 6b
- ai-agent 의 LLM 응답 흐름 — 6c (본 작업은 webhook 발사까지)
- 프론트 UI — 6d
- 알림 (브라우저/이메일 push)
- 파일 첨부 (코멘트 첨부 시스템 재사용은 후속)
- 이슈 외 독립 chat (DM, project-wide chat) — 별도 phase

## 가치 가설 (부모 epic 에서 인용)

- H1: 단순 follow-up·clarify·의사결정 trafic 의 70%+ 가 코멘트가 아닌 chat 으로 이동
- H2: AI 와의 turn 평균 응답 시간이 코멘트 방식보다 짧다
- H3: 이슈 본문/코멘트의 노이즈가 감소

## 핵심 설계 결정

1. **이슈당 1개 thread 고정** — `chat_thread.issue_id` UNIQUE, lazy 생성 (getter 호출 시 없으면 생성)
2. **Add-only 자동 멤버십** — reporter/assignee/watcher 로 들어오면 자동 추가, 빠져나가도 thread 멤버는 유지. 명시적 제거 API 제공.
3. **Thread 멤버만 쓰기** — 외부 사람은 명시적 add 후 쓰기 가능
4. **본인만 수정/삭제** — edited_at 노출, soft-delete
5. **@mention 명시적 호출만 AI 발사** — Slack 스타일. self-loop 차단 (Phase 5b 패턴 재사용)
6. **kind 노출** — AGENT 작성 메시지 시각 구분용 (Phase 5c-3 `authorKind` 패턴 일관)

## 아키텍처

Spring Modulith 새 모듈 `com.workplace.chat`. 다른 도메인 모듈(`issue`, `user`, `project`, `watcher`) 을 직접 import 하지 않는다 — 이벤트 + 응답 DTO 의 JOIN 정도만 USER 테이블 사용 (Phase 5c-3 pattern).

```
chat/
  controller/
  service/
  repository/
  dto/
  event/      ← 발행 (ChatMessageCreatedEvent) + 수신 (이슈 이벤트)
  exception/
```

Phase 5b 의 `AiAgentEventClient` (workplace-ai-agent HTTP 클라이언트 + 재시도) 재사용. 발사 디스패처는 chat 전용으로 별도 (`ChatEventDispatcher`) — issue 의 `IssueEventDispatcher` 와 격리.

## 데이터 모델 — V15 마이그레이션

```sql
-- V15__chat.sql

CREATE TABLE chat_thread (
  id            BIGSERIAL PRIMARY KEY,
  issue_id      BIGINT NOT NULL UNIQUE REFERENCES issue(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ
);

CREATE TABLE chat_thread_member (
  thread_id              BIGINT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  user_id                BIGINT NOT NULL REFERENCES "user"(id),
  last_read_message_id   BIGINT,
  joined_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX idx_chat_thread_member_user ON chat_thread_member(user_id);

CREATE TABLE chat_message (
  id            BIGSERIAL PRIMARY KEY,
  thread_id     BIGINT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  author_id     BIGINT NOT NULL REFERENCES "user"(id),
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  mentions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at     TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_chat_message_thread_created ON chat_message(thread_id, created_at DESC, id DESC);
```

`mentions` JSONB 는 user.id 의 정수 배열 (예: `[12, 99]`). UI 가 hydrate 할 수 있도록 응답 DTO 는 `[{id, username, name, kind}]` 로 채워서 내려준다.

## REST API

모든 응답은 `kind` 필드(HUMAN/AGENT) 를 포함한다 (Phase 5c-3 패턴).

### 1. Thread getter (lazy 생성)

```
GET /api/v1/projects/{key}/issues/{number}/chat/thread

Response 200 ChatThreadResponse:
{
  "threadId": 1,
  "issueId": 100,
  "archivedAt": null,
  "members": [
    { "userId": 1, "username": "alice", "name": "Alice", "kind": "HUMAN",
      "lastReadMessageId": 7, "joinedAt": "..." },
    { "userId": 99, "username": "ai-agent", "name": "AI Agent", "kind": "AGENT",
      "lastReadMessageId": null, "joinedAt": "..." }
  ],
  "recentMessages": [ChatMessageResponse, ...]   // 최근 20개 DESC
}
```

권한: caller 가 이슈 속 프로젝트 멤버이면 허용 (`project:read`).
Lazy 생성 시 initial 멤버: reporter ∪ assignees ∪ watchers. issue/watcher 모듈 직접 import X — 이슈/watcher 정보는 동 트랜잭션 내에서 jOOQ SELECT 로 조회 (USER 테이블처럼 row 만 읽고 의존성 가지지 않음).

### 2. 메시지 페이징

```
GET /api/v1/chat/threads/{id}/messages?cursor=&limit=50

Response 200 ChatMessagePage:
{ "items": [ChatMessageResponse], "nextCursor": "...", "hasMore": true }
```

- limit 기본 50, 최대 100
- cursor = base64(`createdAt|id`). DESC 정렬 + (`createdAt, id`) tuple 비교
- 권한: thread 멤버
- soft-delete 된 메시지는 body 를 `"(삭제됨)"` 으로 마스킹해 반환 (UI 정렬 유지)

### 3. 메시지 작성

```
POST /api/v1/chat/threads/{id}/messages  { "body": "@ai-agent 처리해줘" }

Response 201 ChatMessageResponse
```

처리:
1. 권한 체크 — thread 멤버
2. `ChatMentionParser.parse(body)` → username[] → 같은 프로젝트의 active USER 조회 → user.id[]
3. INSERT chat_message (mentions JSONB)
4. `ChatMessageCreatedEvent` 발행 (@TransactionalEventListener AFTER_COMMIT)

### 4. 메시지 수정

```
PATCH /api/v1/chat/messages/{id}  { "body": "수정본" }

Response 200 ChatMessageResponse (edited_at 갱신)
```

- 권한: `caller_id == author_id` (본인만)
- mention 재파싱 → mentions JSONB 갱신
- AI 발사 이벤트는 발행 X (mention 추가에 대해서는 별도 후속 phase 결정. MVP 는 작성 시점만)

### 5. 메시지 삭제

```
DELETE /api/v1/chat/messages/{id}

Response 204
```

- 권한: 본인만
- soft-delete (`deleted_at = NOW()`)
- 응답 페이징에서 body 는 `"(삭제됨)"` 마스킹

### 6. 읽음 표시

```
POST /api/v1/chat/threads/{id}/read  { "uptoMessageId": 42 }

Response 204
```

- 권한: thread 멤버
- 본인의 `chat_thread_member.last_read_message_id` 만 갱신
- `MAX(last_read, uptoMessageId)` 로 백워드 갱신 무효화

### 7. 수동 멤버 추가/제거

```
POST   /api/v1/chat/threads/{id}/members           { "userId": 99 }
DELETE /api/v1/chat/threads/{id}/members/{userId}
```

- 권한: 추가/제거 요청자가 본인 thread 멤버
- 추가는 프로젝트 멤버에 한해 가능 (외부 사용자 차단)
- 제거: **MVP 는 본인 leave 만 허용** (`{userId} == caller`). 타인 제거(모더레이션) 는 후속 phase.

## 멤버십 자동화 (이벤트 핸들러)

`chat.event.IssueStakeholderListener` — `@ApplicationModuleListener` 로 이슈/watcher 모듈 이벤트 구독.

| 수신 이벤트 | 동작 |
|---|---|
| `IssueCreatedEvent` | 무시 (lazy 생성 시 합산) |
| `IssueAssignedEvent` | thread 가 있으면 `added` 멤버 자동 추가 (idempotent). 없으면 무시. |
| `WatcherAddedEvent`* | thread 가 있으면 자동 추가. 없으면 무시. |
| 제거 이벤트 | 무시 (add-only) |

\* `WatcherAddedEvent` 가 watcher 모듈에 없으면 본 작업에서 추가한다 (작은 변경, 동일 패턴).

### Lazy 생성 idempotency

```
@Transactional
public ChatThreadResponse getOrCreate(Long callerId, String projectKey, int issueNumber) {
  Long issueId = issueLookup.findIdOrThrow(projectKey, issueNumber);
  ensureProjectMember(callerId, projectKey);

  return chatThreadRepo.findByIssueId(issueId)
      .orElseGet(() -> createWithInitialMembers(issueId));
}

private ChatThreadResponse createWithInitialMembers(Long issueId) {
  // INSERT … ON CONFLICT (issue_id) DO NOTHING → 별도 SELECT 로 fetch
  // race 발생해도 둘 중 하나만 INSERT, 다른 쪽은 기존 row 반환
  Long threadId = chatThreadRepo.insertReturning(issueId);
  Set<Long> initial = unionOf(reporterOf(issueId), assigneesOf(issueId), watchersOf(issueId));
  chatMemberRepo.insertIgnoreConflict(threadId, initial);
  return buildResponse(threadId);
}
```

`issue_id` UNIQUE 제약 + `ON CONFLICT DO NOTHING` 으로 race 안전.

## @mention 파싱

```
public final class ChatMentionParser {
  private static final Pattern P = Pattern.compile("@([a-zA-Z0-9._-]+)");

  public static List<String> parse(String body) {
    // 정규식 매칭 → 중복 제거된 username[]
  }
}
```

서비스에서:
```
List<String> names = ChatMentionParser.parse(body);
List<UserSummary> resolved = userLookup.findActiveByUsernamesInProject(names, projectId);
List<Long> mentionUserIds = resolved.stream().map(UserSummary::id).distinct().toList();
```

- 매칭 안 되는 username → 무시 (텍스트는 그대로 보관)
- 같은 프로젝트의 active USER 만 해소 → 외부 사용자 mention 차단

## ai-agent 발사 (Phase 5b 재사용)

```
@TransactionalEventListener(phase = AFTER_COMMIT)
@Async("aiAgentEventExecutor")
public void onChatMessageCreated(ChatMessageCreatedEvent e) {
  if (!enabled) return;
  if (e.actor().kind().equals("AGENT")) return;          // self-loop
  boolean hasAgentMention = e.mentions().stream().anyMatch(m -> m.kind().equals("AGENT"));
  if (!hasAgentMention) return;
  client.send("chat.message.posted", buildPayload(e));   // AiAgentEventClient
}
```

Payload:
```json
{
  "type": "chat.message.posted",
  "payload": {
    "projectKey": "WP",
    "issueKey": "WP-1",
    "issueId": 100,
    "threadId": 1,
    "messageId": 42,
    "actor": { "id": 1, "username": "alice", "name": "Alice", "kind": "HUMAN" },
    "body": "@ai-agent 처리해줘",
    "mentions": [{ "id": 99, "username": "ai-agent", "name": "AI Agent", "kind": "AGENT" }],
    "occurredAt": "..."
  }
}
```

ai-agent 측 핸들러는 6c 에서 구현.

## 응답 DTO

```java
public record ChatThreadResponse(
    Long threadId, Long issueId, Instant archivedAt,
    List<ChatMemberResponse> members,
    List<ChatMessageResponse> recentMessages) {}

public record ChatMemberResponse(
    Long userId, String username, String name, String kind,
    Long lastReadMessageId, Instant joinedAt) {}

public record ChatMessageResponse(
    Long id, Long threadId, Long authorId, String authorName, String authorKind,
    String body, List<ChatMentionResponse> mentions,
    Instant createdAt, Instant editedAt, boolean deleted) {}

public record ChatMentionResponse(Long id, String username, String name, String kind) {}

public record ChatMessagePage(
    List<ChatMessageResponse> items, String nextCursor, boolean hasMore) {}
```

- `kind` 노출 패턴은 Phase 5c-3 일관
- `deleted == true` 일 때 `body == "(삭제됨)"`

## 권한/예외

| 케이스 | 예외 | HTTP |
|---|---|---|
| thread 없는 조회 (lazy 생성 흐름 미진입) | — (생성됨) | 200 |
| 비프로젝트 멤버의 thread 조회 | `ProjectAccessDeniedException` (기존) | 403 |
| 비thread 멤버의 메시지 작성 | `ChatThreadNotMemberException` | 403 |
| 타인 메시지 수정/삭제 | `ChatMessageAuthorMismatchException` | 403 |
| 존재하지 않는 메시지 | `ChatMessageNotFoundException` | 404 |
| body 길이 0 / 4000 초과 | `MethodArgumentNotValidException` (bean validation) | 400 |

GlobalExceptionHandler 에 신규 예외 매핑 추가.

## 테스트 전략

### Repository (Spring DataJdbcTest 등 jOOQ 가능한 슬라이스)
- `ChatMessageRepositoryTest`: cursor 페이징 정확성, soft-delete 마스킹, USER JOIN (authorName/authorKind), mentions JSONB roundtrip
- `ChatThreadRepositoryTest`: UNIQUE 제약, ON CONFLICT idempotency
- `ChatThreadMemberRepositoryTest`: PK 중복 INSERT ignore, last_read 갱신

### Service
- `ChatThreadServiceTest`: lazy 생성 idempotent (동시 호출 시 1개만 row), initial 멤버 = reporter ∪ assignees ∪ watchers, 비프로젝트 멤버 차단
- `ChatMessageServiceTest`: 권한 (멤버 아님 → 403), mention 파싱 unknown/duplicate, AGENT 메시지에 mention 있어도 self-loop 차단 시 이벤트 발행은 그대로 (구분: 발행은 하되 dispatcher 가 skip)
- `ChatMentionParserTest`: 정규식 케이스 (공백 둘러쌈, 이메일 형식 `@foo.bar@x.com` 분리, 같은 이름 중복, 매칭 0)
- `ChatMembershipServiceTest`: add-only auto, 본인 leave, 비프로젝트 사용자 추가 차단

### Controller (@WebMvcTest)
- 각 endpoint happy path + 권한 거부 + bean validation (body 길이) + 404

### Integration
- `ChatToAiAgentDispatchTest`: 
  - HUMAN 이 AGENT mention → webhook 1회 발사 + payload 검증
  - HUMAN 이 HUMAN mention → webhook 0회
  - AGENT 가 메시지 작성 (mention 무관) → self-loop 0회
  - mention 안 한 일반 메시지 → 0회
- `ChatThreadLazyCreationTest`: 동시 GET 2개 → row 1개만 생성

### 회귀
- 기존 Phase 5b `IssueEventDispatcher` 가 chat 이벤트와 간섭 없는지 — 별도 dispatcher 라 자동 격리, 그래도 1 케이스로 안전망

## 위험·주의

1. **issue/watcher 모듈 의존성**: 직접 import 금지 — chat 은 USER 테이블처럼 read-only DB 접근으로 reporter/assignees/watchers 조회. 만약 이게 부적절하다 판단되면 issue 모듈에 `IssueStakeholderLookup` 같은 공개 인터페이스를 두는 안 검토 (Modulith allowed-dependencies 로 명시).
2. **WatcherAddedEvent 부재**: 본 작업에서 추가. 작은 변경.
3. **Mention 파싱 보안**: SQL injection 우려 없음 (regex + jOOQ bind), 다만 `body` 자체에는 XSS 검사 없음 — 프론트 렌더링 시 escape 책임.
4. **Lazy 생성 race**: `ON CONFLICT DO NOTHING` + SELECT 로 idempotent.
5. **이슈 archive 시 thread 처리**: 본 spec 은 issue ON DELETE CASCADE 만 정의. 별도 archive 상태 변경 이벤트는 아직 issue 모듈에 없음 — chat_thread.archived_at 컬럼만 두고 setter API 는 후속.

## 완료 기준

- [ ] V15 마이그레이션 적용 + `./gradlew generateJooq` 통과
- [ ] 7 개 REST endpoint 동작 (curl/Postman 검증)
- [ ] 멤버십 자동화: 이슈 생성 → 첫 GET thread → reporter ∪ assignees ∪ watchers 자동 멤버
- [ ] AGENT mention 시 ai-agent 에 webhook 발사, self-loop/no-mention 시 미발사
- [ ] Repository/Service/Controller/Integration 테스트 통과
- [ ] Spotless, Modulith verifier (`./gradlew test` 내 ModulithTest) 통과
- [ ] 6d 가 폴링 기반으로 동작 가능한 API 표면 완성

# Messaging Phase 4 Implementation Plan — @멘션 · 수정/삭제 · 읽음 추적

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 채팅(messaging)에 @멘션, 메시지 수정/삭제, 읽음 추적(사이드바 unread 배지)을 추가한다.

**Architecture:** 이슈 채팅(`chat`) 도메인에 검증된 패턴을 messaging 으로 포팅한다. 모듈 경계상 messaging→chat 직접 의존은 금지하므로, 공유 로직은 백엔드 `global`(parser/hydrator)·프론트 `src/components/mentions/` 로 추출한다. unread 배지는 chat 의 `last_read_message_id` 워터마크 위에 per-channel count 집계를 새로 얹고(net-new), notify 의 `invalidate→refetch` 패턴으로 실시간 갱신한다.

**Tech Stack:** Spring Boot · jOOQ(코드젠) · Flyway(V24) · JUnit 통합테스트 / React 19 · TipTap · TanStack Query · Playwright E2E

**참조 소스(verbatim 미러 대상):**
- `chat/service/ChatMessageService.java`, `chat/repository/ChatMessageRepository.java`, `chat/controller/ChatMessageController.java`
- `chat/outbound/ChatDomainEvents.java`, `chat/outbound/ChatSseDispatcher.java`, `chat/repository/ChatThreadMemberRepository.java:58`(markRead)
- `chat/service/ChatMentionParser.java`, `chat/service/ChatUserHydrator.java`
- notify unread: `notify/repository/NotificationRepository.java:87`, `hooks/queries/useUnreadCount.ts`, `hooks/useNotificationStream.ts`
- 프론트 chat: `pages/projects/components/chat/{ChatRichInput,mentionSerialize,parseMessageSegments,ChatMessageRow,ChatMessageList}.tsx`, `lib/chat-mentions.ts`, `hooks/queries/{useUpdateChatMessage,useDeleteChatMessage}.ts`

**플랜 코드 규약:** 신규 파일·신규 메서드·novel 로직(마이그레이션, mentions 컬럼, unread 서브쿼리, join 초기화, 공유 추출)은 전체 코드를 싣는다. 기계적 포팅은 "미러 대상 파일 + 정확한 시그니처/델타"로 지시한다(executor 가 소스 접근 가능).

---

## File Structure

**백엔드 — 신규**
- `global/util/MentionParser.java` — `<@id>` 파서 (chat 에서 이동)
- `global/dto/MentionResponse.java` — 공유 멘션 DTO `{id, username, name, kind}`
- `global/service/UserMentionHydrator.java` — `filterExistingUserIds` + `asMentionResponses`
- `db/migration/V24__messaging_mentions.sql`

**백엔드 — 수정**
- chat: `ChatUserHydrator`(mention 메서드 제거·위임), `ChatMessageRepository`(MentionResolver 타입 교체), `ChatMessageResponse`(mentions 타입 교체), `ChatMessageService`(parser/resolver 참조 교체), `chat/dto/ChatMentionResponse.java`(삭제)
- messaging: `MessageRepository`, `MessageService`, `MessageController`, `MessageResponse`, `MessagingDomainEvents`, `MessageSseDispatcher`, `ChannelMemberRepository`, `ChannelService`, `ChannelRepository`, `ChannelResponse`, `DmResponse`, 신규 DTO `UpdateMessageRequest`, `MarkReadRequest`

**프론트 — 신규**
- `src/components/mentions/{RichInput,mentionSerialize,parseMessageSegments}.tsx` (chat 에서 이동)
- `hooks/queries/{useUpdateMessage,useDeleteMessage,useMarkMessageRead}.ts`

**프론트 — 수정**
- `components/chat/{MessageComposer,MessageList}.tsx`, `hooks/useMessageStream.ts`, `api/messaging.ts`, `types/messaging.ts`, 사이드바 채널/DM 컴포넌트
- chat: 이동된 컴포넌트 import 경로 갱신

---

## Task 0: 그린 베이스라인 확보

**목적:** 공유 추출 리팩터의 회귀를 기존 실패와 구분하기 위해 시작점이 green 임을 확인.

- [ ] **Step 1: 의존 설치 + DB 기동**

```bash
cd /Users/bluleo78/git/smart-workplace/.claude/worktrees/messaging-phase4
pnpm install
pnpm db:up
```

- [ ] **Step 2: jOOQ 코드젠 (현 스키마 기준)**

Run: `cd apps/workplace-api && ./gradlew generateJooq`
Expected: BUILD SUCCESSFUL, `src/main/generated/com/workplace/jooq/` 갱신.

- [ ] **Step 3: chat + messaging 백엔드 테스트 그린 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.chat.*" --tests "com.workplace.messaging.*"`
Expected: BUILD SUCCESSFUL (0 failures). 실패 시 보고 후 진행 여부 확인.

- [ ] **Step 4: 프론트 타입체크 그린 확인**

Run: `pnpm --filter workplace-web typecheck`
Expected: 0 errors.

> 커밋 없음(베이스라인 확인 단계).

---

## Task 1: 백엔드 공유 추출 — MentionParser

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/global/util/MentionParser.java`
- Modify: `chat/service/ChatMessageService.java` (parse 호출 2곳)
- Delete: `chat/service/ChatMentionParser.java`

- [ ] **Step 1: 신규 `global/util/MentionParser.java`** (ChatMentionParser 내용 그대로, 패키지/이름만 변경)

```java
package com.workplace.global.util;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 메시지 본문에서 {@code <@{userId}>} 멘션 토큰을 추출한다. 중복은 첫 등장 순서를 유지한 채 제거. 토큰 유효성(존재하는 user) 검증은
 * 서비스 단(UserMentionHydrator)에서 수행한다. chat·messaging 공용.
 */
public final class MentionParser {
  private MentionParser() {}

  // 자릿수 상한(18)으로 bigint 범위를 넘는 토큰 차단 — Long.parseLong overflow(500) 방지.
  private static final Pattern P = Pattern.compile("<@(\\d{1,18})>");

  public static List<Long> parse(String body) {
    if (body == null || body.isEmpty()) return List.of();
    Matcher m = P.matcher(body);
    LinkedHashSet<Long> seen = new LinkedHashSet<>();
    while (m.find()) seen.add(Long.parseLong(m.group(1)));
    return new ArrayList<>(seen);
  }
}
```

- [ ] **Step 2: chat 참조 교체**

`ChatMessageService.java`: `import com.workplace.chat.service.ChatMentionParser;` 제거(자동 import), `ChatMentionParser.parse(...)` → `MentionParser.parse(...)` 2곳(create, update). `import com.workplace.global.util.MentionParser;` 추가.

- [ ] **Step 3: ChatMentionParser 삭제**

```bash
rm apps/workplace-api/src/main/java/com/workplace/chat/service/ChatMentionParser.java
```

- [ ] **Step 4: chat 회귀 테스트**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.chat.*"`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit --no-verify -m "refactor(global): MentionParser 를 global.util 로 추출(chat→공용)"
```

---

## Task 2: 백엔드 공유 추출 — UserMentionHydrator + MentionResponse

**Files:**
- Create: `global/dto/MentionResponse.java`, `global/service/UserMentionHydrator.java`
- Modify: `chat/service/ChatUserHydrator.java`, `chat/repository/ChatMessageRepository.java`, `chat/dto/ChatMessageResponse.java`, `chat/service/ChatMessageService.java`
- Delete: `chat/dto/ChatMentionResponse.java`

- [ ] **Step 1: 신규 `global/dto/MentionResponse.java`**

```java
package com.workplace.global.dto;

/** 메시지에서 멘션된 사용자. UserSummary 와 같은 shape 이지만 응답 계약 분리를 위해 별도 record. chat·messaging 공용. */
public record MentionResponse(Long id, String username, String name, String kind) {}
```

- [ ] **Step 2: 신규 `global/service/UserMentionHydrator.java`** (ChatUserHydrator 의 filterExistingUserIds + asMentionResponses 이동, 반환형 MentionResponse)

```java
package com.workplace.global.service;

import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.MentionResponse;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/** mention userIds → 검증/hydrate. USER 테이블 일괄 조회. chat·messaging 공용. */
@Component
@RequiredArgsConstructor
public class UserMentionHydrator {

  private final DSLContext dsl;

  /** mention id 후보 중 실제 존재하는 user.id 만 통과 (입력 순서 보존). */
  public List<Long> filterExistingUserIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    Set<Long> existing = dsl.select(USER.ID).from(USER).where(USER.ID.in(ids)).fetchSet(USER.ID);
    return ids.stream().filter(existing::contains).toList();
  }

  /** mention id list → MentionResponse list (입력 순서 보존). 미존재 id 는 제외. */
  public List<MentionResponse> asMentionResponses(List<Long> userIds) {
    if (userIds == null || userIds.isEmpty()) return List.of();
    List<Long> normalized = userIds.stream().map(n -> ((Number) n).longValue()).toList();
    Map<Long, MentionResponse> map =
        dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
            .from(USER)
            .where(USER.ID.in(normalized))
            .fetch(
                r ->
                    new MentionResponse(
                        r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)))
            .stream()
            .collect(Collectors.toMap(MentionResponse::id, Function.identity()));
    return normalized.stream().map(map::get).filter(Objects::nonNull).toList();
  }
}
```

- [ ] **Step 3: ChatUserHydrator 에서 이동된 메서드 제거 + 위임**

`ChatUserHydrator` 는 `summaryOf`/`summariesOf`(UserSummary 반환, chat 이벤트용)만 유지. `filterExistingUserIds`/`asMentionResponses` 삭제. chat 이 이를 쓰던 곳은 `UserMentionHydrator` 를 직접 주입해 사용. `ChatMentionResponse` import 제거.

- [ ] **Step 4: ChatMessageRepository — MentionResolver 반환형 교체**

`ChatMessageRepository.MentionResolver.resolve` 반환 `List<ChatMentionResponse>` → `List<MentionResponse>`. `toResponse` 의 `List<ChatMentionResponse> mentions` → `List<MentionResponse>`. import 교체(`com.workplace.global.dto.MentionResponse`).

- [ ] **Step 5: ChatMessageResponse — mentions 타입 교체**

`ChatMessageResponse` 의 `List<ChatMentionResponse> mentions` → `List<MentionResponse>`. (JSON 필드 동일: id/username/name/kind → 프론트 무영향)

- [ ] **Step 6: ChatMessageService — resolver/hydrator 참조 교체**

`ChatMessageService` 에 `UserMentionHydrator userMentionHydrator` 주입. `hydrator.filterExistingUserIds(...)` → `userMentionHydrator.filterExistingUserIds(...)`, `hydrator::asMentionResponses` → `userMentionHydrator::asMentionResponses`. `hydrator.summaryOf/summariesOf` 는 그대로(ChatUserHydrator 유지분).

- [ ] **Step 7: ChatMentionResponse 삭제**

```bash
rm apps/workplace-api/src/main/java/com/workplace/chat/dto/ChatMentionResponse.java
```

- [ ] **Step 8: 컴파일 + chat 회귀**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.chat.*"`
Expected: PASS (0 failures). 멘션/수정/삭제/읽음 기존 테스트 그대로 통과.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit --no-verify -m "refactor(global): UserMentionHydrator/MentionResponse 공용 추출(chat→공용)"
```

---

## Task 3: 마이그레이션 V24 + jOOQ 코드젠

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V24__messaging_mentions.sql`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- V24: messaging 메시지 멘션. chat_message.mentions 와 동일 패턴(JSONB long[]).
ALTER TABLE message ADD COLUMN mentions JSONB NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: 마이그레이션 적용 + jOOQ 재생성**

Run: `cd apps/workplace-api && ./gradlew flywayMigrate generateJooq` (또는 `./gradlew bootRun` 1회로 적용 후 `generateJooq`)
Expected: `MESSAGE.MENTIONS` 필드가 `src/main/generated/.../tables/Message.java` 에 생성됨.

- [ ] **Step 3: 확인**

Run: `grep -n "MENTIONS" apps/workplace-api/src/main/generated/com/workplace/jooq/tables/Message.java`
Expected: `public final TableField<MessageRecord, JSONB> MENTIONS = ...`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit --no-verify -m "feat(messaging): V24 message.mentions 컬럼 + jOOQ 재생성"
```

---

## Task 4: 백엔드 @멘션 — MessageRepository/Service/Response

**Files:**
- Modify: `messaging/repository/MessageRepository.java`, `messaging/service/MessageService.java`, `messaging/dto/MessageResponse.java`, `messaging/outbound/MessagingDomainEvents.java`, `messaging/outbound/MessageSseDispatcher.java`
- Test: `messaging/.../MessageMentionTest.java`

- [ ] **Step 1: 실패 테스트 작성** `apps/workplace-api/src/test/java/com/workplace/messaging/MessageMentionTest.java`

```java
// 채널 멤버 2명 시드 → "<@{u2}> hi" 전송 → 응답 mentions 에 u2 포함(username/name/kind), 미존재 id 는 필터.
// 통합테스트 베이스(@SpringBootTest + 기존 messaging 테스트 픽스처) 재사용 — 동일 패키지 기존 테스트의 셋업 모방.
```

구체 검증:
```java
MessageResponse r = createMessage(channelId, u1, "<@" + u2 + "> <@999999> hi");
assertThat(r.mentions()).extracting(MentionResponse::id).containsExactly(u2);
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.MessageMentionTest"`
Expected: FAIL (`mentions()` 메서드 없음 / 컴파일 에러).

- [ ] **Step 3: MessageResponse 에 mentions 추가**

```java
public record MessageResponse(
    Long id, Long channelId, Long authorId, String authorName, String authorKind,
    String body, java.util.List<com.workplace.global.dto.MentionResponse> mentions,
    java.time.Instant createdAt, java.time.Instant editedAt, boolean deleted) {}
```

- [ ] **Step 4: MessageRepository — mentions read/write + MentionResolver**

`ChatMessageRepository` 미러:
- 필드 추가: `private final ObjectMapper objectMapper;`, `MentionResolver` 인터페이스(`List<MentionResponse> resolve(List<Long>)`), `toJson`/`fromJson`(@SneakyThrows, chat 과 동일).
- `insert(channelId, authorId, body, List<Long> mentionUserIds)` — `.set(MESSAGE.MENTIONS, JSONB.valueOf(toJson(mentionUserIds)))` 추가.
- select 절(`findById`, `findPage`)에 `MESSAGE.MENTIONS` 추가, `toResponse(Record, MentionResolver resolver)` 시그니처로 변경 — `fromJson(r.get(MESSAGE.MENTIONS))` → `resolver.resolve(...)` → MessageResponse 에 전달.

> 기존 `insert(long,long,String)` 호출부(MessageService.create)는 Step 5 에서 갱신.

- [ ] **Step 5: MessageService.create — 멘션 파싱**

```java
@Transactional
public MessageResponse create(long callerId, long channelId, CreateMessageRequest req) {
  ensureMember(channelId, callerId);
  if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
  List<Long> mentionIds = mentionHydrator.filterExistingUserIds(MentionParser.parse(req.body()));
  long messageId = messageRepo.insert(channelId, callerId, req.body(), mentionIds);
  MessageResponse saved = findOne(messageId);
  publisher.publishEvent(new MessageCreatedEvent(channelId, saved));
  return saved;
}
```
- 주입 추가: `private final UserMentionHydrator mentionHydrator;` (+ import `MentionParser`).
- `findOne` 의 `messageRepo.findById(messageId)` → `messageRepo.findById(messageId, mentionHydrator::asMentionResponses)`.
- `list` 의 `findPage(...)` → `findPage(channelId, cursor, limit, mentionHydrator::asMentionResponses)`.

- [ ] **Step 6: MessageSseDispatcher.onCreated — payload 에 mentions 포함**

`MessageCreatedEvent.message()` 는 이미 mentions 를 가진 완성 `MessageResponse` 이므로 현행 `fanOut(..., e.message())` 가 그대로 mentions 를 싣는다. **변경 불필요** — 확인만.

- [ ] **Step 7: 테스트 통과**

Run: `./gradlew test --tests "com.workplace.messaging.MessageMentionTest"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit --no-verify -m "feat(messaging): 메시지 @멘션 파싱·저장·응답 hydrate"
```

---

## Task 5: 백엔드 메시지 수정/삭제

**Files:**
- Create: `messaging/dto/UpdateMessageRequest.java`, messaging 예외 2종(또는 chat 예외 미러)
- Modify: `MessageRepository`(update/softDelete/findAuthorId/findChannelId), `MessageService`(update/delete), `MessagingDomainEvents`, `MessageSseDispatcher`, `MessageController`
- Test: `messaging/MessageEditDeleteTest.java`

- [ ] **Step 1: 실패 테스트** `MessageEditDeleteTest.java`

```java
// 1) 작성자 본인 PATCH → body 변경 + editedAt != null + 재파싱 mentions 반영
// 2) 타인 PATCH/DELETE → 403
// 3) DELETE → 이후 조회 시 deleted=true, body="(삭제됨)"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.MessageEditDeleteTest"`
Expected: FAIL.

- [ ] **Step 3: DTO + 예외**

`messaging/dto/UpdateMessageRequest.java`:
```java
package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 메시지 수정 요청. body 제약은 작성과 동일(1–4000). */
public record UpdateMessageRequest(@NotBlank @Size(max = 4000) String body) {}
```
예외: `messaging/exception/` 에 `MessageNotFoundException`(404), `MessageAuthorMismatchException`(403). chat `ChatMessageNotFoundException`/`ChatMessageAuthorMismatchException` 와 동일 구조(GlobalExceptionHandler 매핑 방식 확인해 동일 패턴 적용).

- [ ] **Step 4: MessageRepository — update/softDelete/findAuthorId/findChannelId** (ChatMessageRepository:53-79 미러)

```java
public void update(long id, String body, java.util.List<Long> mentionUserIds) {
  dsl.update(MESSAGE)
      .set(MESSAGE.BODY, body)
      .set(MESSAGE.MENTIONS, JSONB.valueOf(toJson(mentionUserIds)))
      .set(MESSAGE.EDITED_AT, OffsetDateTime.now())
      .where(MESSAGE.ID.eq(id)).execute();
}
public void softDelete(long id) {
  dsl.update(MESSAGE).set(MESSAGE.DELETED_AT, OffsetDateTime.now())
      .where(MESSAGE.ID.eq(id)).execute();
}
public java.util.Optional<Long> findAuthorId(long id) {
  return dsl.select(MESSAGE.AUTHOR_ID).from(MESSAGE).where(MESSAGE.ID.eq(id))
      .fetchOptional(MESSAGE.AUTHOR_ID);
}
public java.util.Optional<Long> findChannelId(long id) {
  return dsl.select(MESSAGE.CHANNEL_ID).from(MESSAGE).where(MESSAGE.ID.eq(id))
      .fetchOptional(MESSAGE.CHANNEL_ID);
}
```

- [ ] **Step 5: MessagingDomainEvents — Updated/Deleted 이벤트**

```java
/** 메시지 수정 직후. SSE fan-out 용. */
public record MessageUpdatedEvent(
    long channelId, long messageId, String body,
    java.util.List<com.workplace.global.dto.MentionResponse> mentions,
    java.time.Instant editedAt) {}

/** 메시지 soft-delete 직후. SSE fan-out 용. */
public record MessageDeletedEvent(long channelId, long messageId) {}
```

- [ ] **Step 6: MessageService — update/delete** (ChatMessageService:58-95 미러)

```java
@Transactional
public MessageResponse update(long callerId, long messageId, UpdateMessageRequest req) {
  long authorId = messageRepo.findAuthorId(messageId)
      .orElseThrow(() -> new MessageNotFoundException(messageId));
  if (authorId != callerId) throw new MessageAuthorMismatchException(messageId, callerId);
  List<Long> mentionIds = mentionHydrator.filterExistingUserIds(MentionParser.parse(req.body()));
  messageRepo.update(messageId, req.body(), mentionIds);
  MessageResponse saved = findOne(messageId);
  publisher.publishEvent(new MessageUpdatedEvent(
      saved.channelId(), messageId, saved.body(),
      mentionHydrator.asMentionResponses(mentionIds), saved.editedAt()));
  return saved;
}

@Transactional
public void delete(long callerId, long messageId) {
  long authorId = messageRepo.findAuthorId(messageId)
      .orElseThrow(() -> new MessageNotFoundException(messageId));
  if (authorId != callerId) throw new MessageAuthorMismatchException(messageId, callerId);
  long channelId = messageRepo.findChannelId(messageId)
      .orElseThrow(() -> new MessageNotFoundException(messageId));
  messageRepo.softDelete(messageId);
  publisher.publishEvent(new MessageDeletedEvent(channelId, messageId));
}
```

- [ ] **Step 7: MessageSseDispatcher — onUpdated/onDeleted** (ChatSseDispatcher:52-68 미러, 이벤트명 `messaging.message.updated|deleted`)

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onUpdated(MessageUpdatedEvent e) {
  Map<String, Object> p = new LinkedHashMap<>();
  p.put("channelId", e.channelId());
  p.put("id", e.messageId());
  p.put("body", e.body());
  p.put("mentions", e.mentions());
  p.put("editedAt", e.editedAt() == null ? null : e.editedAt().toString());
  registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.updated", p);
}

@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onDeleted(MessageDeletedEvent e) {
  Map<String, Object> p = new LinkedHashMap<>();
  p.put("channelId", e.channelId());
  p.put("id", e.messageId());
  registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.deleted", p);
}
```
(import: `MessageUpdatedEvent`, `MessageDeletedEvent`, `java.util.LinkedHashMap`, `java.util.Map`)

- [ ] **Step 8: MessageController — PATCH/DELETE** (ChatMessageController:50-63 미러)

```java
@PatchMapping("/messages/{id}")
public ResponseEntity<MessageResponse> update(
    @AuthenticationPrincipal Long callerId, @PathVariable("id") long messageId,
    @Valid @RequestBody UpdateMessageRequest req) {
  return ResponseEntity.ok(messageService.update(callerId, messageId, req));
}

@DeleteMapping("/messages/{id}")
public ResponseEntity<Void> delete(
    @AuthenticationPrincipal Long callerId, @PathVariable("id") long messageId) {
  messageService.delete(callerId, messageId);
  return ResponseEntity.noContent().build();
}
```

- [ ] **Step 9: 테스트 통과 + Commit**

Run: `./gradlew test --tests "com.workplace.messaging.MessageEditDeleteTest"`
Expected: PASS.
```bash
git add -A && git commit --no-verify -m "feat(messaging): 메시지 수정/삭제(작성자 권한·soft-delete·SSE)"
```

---

## Task 6: 백엔드 읽음 추적 + unread-count

**Files:**
- Create: `messaging/dto/MarkReadRequest.java`
- Modify: `ChannelMemberRepository`(markRead, join 초기화), `ChannelRepository`(findMyChannels/findMyDms unread 서브쿼리), `ChannelResponse`/`DmResponse`(unreadCount), `MessageService`(markRead), `MessagingDomainEvents`(ReadEvent), `MessageSseDispatcher`(onRead), `MessageController`(read)
- Test: `messaging/MessageReadTest.java`

- [ ] **Step 1: 실패 테스트** `MessageReadTest.java`

```java
// 1) markRead(upto) → channel_member.last_read_message_id == upto, 과거 upto 재호출 시 역행 안 함(GREATEST)
// 2) unreadCount: 멤버가 안 읽은 타인 메시지 N개 → findMyChannels 응답 unreadCount==N, 본인 메시지 제외
// 3) 새 멤버 join 시 last_read 가 가입 시점 최신 메시지로 초기화 → 과거 히스토리 unread 0
// 4) 비멤버 markRead → 403
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.MessageReadTest"`
Expected: FAIL.

- [ ] **Step 3: ChannelMemberRepository.markRead** (ChatThreadMemberRepository:58 미러)

```java
import static org.jooq.impl.DSL.greatest;
import static org.jooq.impl.DSL.val;

/** 본인 last_read_message_id 를 max(기존, upto) 로 갱신. */
public void markRead(long channelId, long userId, long uptoMessageId) {
  dsl.update(CHANNEL_MEMBER)
      .set(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID,
          org.jooq.impl.DSL.coalesce(
              greatest(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, val(uptoMessageId)),
              val(uptoMessageId)))
      .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
      .execute();
}
```

- [ ] **Step 4: ChannelMemberRepository — join/add 시 last_read 초기화**

신규 멤버가 가입 전 히스토리를 unread 로 보지 않도록, `join`·`add` 의 INSERT 에 `last_read_message_id = (SELECT MAX(id) FROM message WHERE channel_id=?)` 를 함께 세팅한다(없으면 NULL→0 처리). raw SQL 사용:

```java
public void join(long channelId, long userId) {
  dsl.execute(
      "INSERT INTO channel_member (channel_id, user_id, last_read_message_id) "
          + "VALUES (?, ?, (SELECT MAX(id) FROM message WHERE channel_id = ?)) "
          + "ON CONFLICT (channel_id, user_id) DO NOTHING",
      channelId, userId, channelId);
}

public void add(long channelId, long userId, String role) {
  dsl.execute(
      "INSERT INTO channel_member (channel_id, user_id, role, last_read_message_id) "
          + "VALUES (?, ?, ?, (SELECT MAX(id) FROM message WHERE channel_id = ?)) "
          + "ON CONFLICT (channel_id, user_id) DO NOTHING",
      channelId, userId, role, channelId);
}
```

> DM 참여자 추가 경로(DmService 등)도 `add`/`join` 을 거치는지 확인 — 거치면 자동 적용, 별도 INSERT 면 동일 초기화 반영.

- [ ] **Step 5: ChannelResponse / DmResponse 에 unreadCount 추가**

`ChannelResponse` 끝에 `long unreadCount` 추가, `DmResponse` 에 `long unreadCount` 추가. 각 매퍼/생성자 호출부 갱신.

- [ ] **Step 6: ChannelRepository.findMyChannels — unread 상관 서브쿼리**

select 절에 추가(이미 caller 의 `CHANNEL_MEMBER` 를 join 하므로 `LAST_READ_MESSAGE_ID` 참조 가능):

```java
dsl.selectCount()
    .from(MESSAGE)
    .where(MESSAGE.CHANNEL_ID.eq(CHANNEL.ID)
        .and(MESSAGE.DELETED_AT.isNull())
        .and(MESSAGE.AUTHOR_ID.ne(callerId))
        .and(MESSAGE.ID.gt(
            org.jooq.impl.DSL.coalesce(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, org.jooq.impl.DSL.inline(0L)))))
    .asField("unread_count")
```

`mapChannel` 에서 방어적으로 읽기(다른 쿼리는 unread_count 별칭이 없으므로):
```java
Integer unread = r.field("unread_count") != null ? r.get("unread_count", Integer.class) : 0;
// ChannelResponse 생성자 마지막 인자로 (unread == null ? 0 : unread) 전달
```

- [ ] **Step 7: ChannelRepository.findMyDms — unread 동일 서브쿼리**

`findMyDms` 의 select 에 동일 `unread_count` 서브쿼리 추가(이미 caller `CHANNEL_MEMBER` join). rows 매핑 시 `DmResponse` 에 `r.get("unread_count", Integer.class)` 전달.

- [ ] **Step 8: MarkReadRequest + MessageService.markRead + 이벤트** (ChatMessageService:102 미러)

`messaging/dto/MarkReadRequest.java`:
```java
package com.workplace.messaging.dto;
import jakarta.validation.constraints.Positive;
/** 읽음 표시 — uptoMessageId 까지 읽음. */
public record MarkReadRequest(@Positive long uptoMessageId) {}
```
`MessagingDomainEvents`:
```java
/** 읽음 표시 직후. SSE fan-out 용. */
public record MessageReadEvent(long channelId, long userId, long lastReadMessageId) {}
```
`MessageService`:
```java
@Transactional
public void markRead(long callerId, long channelId, long uptoMessageId) {
  ensureMember(channelId, callerId);
  memberRepo.markRead(channelId, callerId, uptoMessageId);
  publisher.publishEvent(new MessageReadEvent(channelId, callerId, uptoMessageId));
}
```

- [ ] **Step 9: MessageSseDispatcher.onRead** (ChatSseDispatcher:71 미러, 이벤트명 `messaging.message.read`)

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onRead(MessageReadEvent e) {
  Map<String, Object> p = new LinkedHashMap<>();
  p.put("channelId", e.channelId());
  p.put("userId", e.userId());
  p.put("lastReadMessageId", e.lastReadMessageId());
  registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.read", p);
}
```

- [ ] **Step 10: MessageController.read**

```java
@PostMapping("/channels/{id}/read")
public ResponseEntity<Void> markRead(
    @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId,
    @Valid @RequestBody MarkReadRequest req) {
  messageService.markRead(callerId, channelId, req.uptoMessageId());
  return ResponseEntity.noContent().build();
}
```

- [ ] **Step 11: 테스트 통과 + Commit**

Run: `./gradlew test --tests "com.workplace.messaging.MessageReadTest"`
Expected: PASS.
```bash
git add -A && git commit --no-verify -m "feat(messaging): 읽음 추적 + 채널/DM unread-count 집계"
```

- [ ] **Step 12: 백엔드 전체 회귀**

Run: `./gradlew test --tests "com.workplace.chat.*" --tests "com.workplace.messaging.*"`
Expected: PASS (0 failures).

---

## Task 7: 프론트 공유 추출 — components/mentions

**Files:**
- Create: `src/components/mentions/{RichInput.tsx,mentionSerialize.ts,parseMessageSegments.ts}`
- Modify: chat 의 import 경로(이동된 3 파일을 쓰던 곳), `lib/chat-mentions.ts`(필요 시 재export)

- [ ] **Step 1: 파일 이동(내용 보존, 이름 일반화)**

```bash
git mv apps/workplace-web/src/pages/projects/components/chat/ChatRichInput.tsx apps/workplace-web/src/components/mentions/RichInput.tsx
git mv apps/workplace-web/src/pages/projects/components/chat/mentionSerialize.ts apps/workplace-web/src/components/mentions/mentionSerialize.ts
git mv apps/workplace-web/src/pages/projects/components/chat/parseMessageSegments.ts apps/workplace-web/src/components/mentions/parseMessageSegments.ts
```
`RichInput.tsx` 내부의 컴포넌트명 `ChatRichInput`→`RichInput`(export 포함), 상호 import 경로(`./mentionSerialize` 등) 유지 확인.

- [ ] **Step 2: chat import 경로 갱신**

`ChatRichInput`/`mentionSerialize`/`parseMessageSegments` 를 import 하던 chat 파일들의 경로를 `@/components/mentions/...`(또는 상대경로)로 수정. 컴포넌트명 `ChatRichInput`→`RichInput` 참조 갱신.

Run: `grep -rl "ChatRichInput\|components/chat/mentionSerialize\|components/chat/parseMessageSegments" apps/workplace-web/src` 로 잔여 참조 0 확인.

- [ ] **Step 3: 타입체크 + chat E2E smoke**

Run: `pnpm --filter workplace-web typecheck`
Expected: 0 errors.
Run(가능 시): chat 멘션 관련 기존 E2E 1개 — `pnpm --filter workplace-web test:e2e -g "mention"` 또는 해당 spec. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit --no-verify -m "refactor(web): 멘션 입력/렌더 컴포넌트를 components/mentions 로 공용 추출"
```

---

## Task 8: 프론트 messaging — 타입/API

**Files:**
- Modify: `src/types/messaging.ts`, `src/api/messaging.ts`

- [ ] **Step 1: 타입 추가** `types/messaging.ts`

```ts
export interface MentionResponse { id: number; username: string; name: string; kind: string }
// MessageResponse 에 추가:
//   mentions: MentionResponse[]
// ChannelResponse / DmResponse 에 추가:
//   unreadCount: number
```

- [ ] **Step 2: API 추가** `api/messaging.ts`

```ts
updateMessage: (messageId: number, body: string) =>
  client.patch<MessageResponse>(`/messaging/messages/${messageId}`, { body }).then((r) => r.data),
deleteMessage: (messageId: number) =>
  client.delete(`/messaging/messages/${messageId}`).then(() => undefined),
markRead: (channelId: number, uptoMessageId: number) =>
  client.post(`/messaging/channels/${channelId}/read`, { uptoMessageId }).then(() => undefined),
```

- [ ] **Step 3: 타입체크 + Commit**

Run: `pnpm --filter workplace-web typecheck`
Expected: 0 errors.
```bash
git add -A && git commit --no-verify -m "feat(web/messaging): mentions/unreadCount 타입 + update/delete/markRead API"
```

---

## Task 9: 프론트 messaging — 멘션 입력/렌더

**Files:**
- Modify: `components/chat/MessageComposer.tsx`, `components/chat/MessageList.tsx`

- [ ] **Step 1: MessageComposer — RichInput 으로 교체**

`Textarea` 기반 입력을 `RichInput`(components/mentions)으로 교체. 멘션 후보(member list) prop 은 해당 채널/DM 멤버에서 공급 — `ChannelPage`/`DmPage` 가 멤버 목록을 RichInput 에 전달. 전송 시 `serializeToBody(doc)` 로 `<@id>` 토큰 body 생성(기존 chat composer 흐름 미러).

- [ ] **Step 2: MessageList — 멘션 칩 렌더**

각 메시지 body 를 `parseMessageSegments(body, mentions)` 로 분해해 text/mention 세그먼트 렌더(chat 의 칩 스타일 재사용).

- [ ] **Step 3: 타입체크 + Commit**

Run: `pnpm --filter workplace-web typecheck`
```bash
git add -A && git commit --no-verify -m "feat(web/messaging): 멘션 입력(RichInput)·칩 렌더"
```

---

## Task 10: 프론트 messaging — 수정/삭제 UI + 훅 + SSE

**Files:**
- Create: `hooks/queries/useUpdateMessage.ts`, `hooks/queries/useDeleteMessage.ts`
- Modify: `components/chat/MessageList.tsx`(MessageRow 툴바/인라인 에디터), `hooks/useMessageStream.ts`

- [ ] **Step 1: 훅 작성** (useUpdateChatMessage/useDeleteChatMessage 미러)

`useUpdateMessage(channelId)`/`useDeleteMessage(channelId)` — `messagingApi.updateMessage/deleteMessage` mutation + 메시지 목록 캐시 낙관적 패치(수정: body/mentions/editedAt, 삭제: deleted=true & body 마스킹). 캐시 키는 기존 messaging 메시지 쿼리 키 재사용.

- [ ] **Step 2: MessageRow — hover 툴바 + `(수정됨)` 배지 + 인라인 에디터** (ChatMessageRow 미러)

작성자 본인 메시지에 hover 시 수정/삭제 아이콘. 수정 클릭 → `RichInput` 인라인 에디터. `editedAt != null` → `(수정됨)`. `deleted` → `(삭제됨)` 마스킹 표시(툴바 숨김).

- [ ] **Step 3: useMessageStream — updated/deleted 핸들러**

```ts
// 기존 messaging.message.created 핸들러 옆에 추가:
if (eventName === 'messaging.message.updated') { upsertMessage(parsed) }       // body/mentions/editedAt 반영
if (eventName === 'messaging.message.deleted') { maskDeleted(parsed.id) }      // deleted=true, body "(삭제됨)"
```
(upsert/mask 헬퍼는 기존 `upsertMessage` 패턴 확장.)

- [ ] **Step 4: 타입체크 + Commit**

Run: `pnpm --filter workplace-web typecheck`
```bash
git add -A && git commit --no-verify -m "feat(web/messaging): 메시지 수정/삭제 UI·훅·SSE 동기화"
```

---

## Task 11: 프론트 messaging — 읽음 + 사이드바 unread 배지

**Files:**
- Create: `hooks/queries/useMarkMessageRead.ts`
- Modify: `components/chat/MessageList.tsx`(IntersectionObserver), `hooks/useMessageStream.ts`, 사이드바 채널/DM 컴포넌트

- [ ] **Step 1: useMarkMessageRead 훅**

`useMarkMessageRead(channelId)` → `messagingApi.markRead(channelId, uptoMessageId)` mutation. 연속 호출 디바운스/중복 억제(마지막 본 id 기억).

- [ ] **Step 2: MessageList — IntersectionObserver mark-read** (ChatMessageList 미러)

마지막 메시지가 viewport 에 들어오면 `markRead(lastVisibleId)` 호출.

- [ ] **Step 3: 사이드바 unread 배지**

채널/DM 행에 `unreadCount > 0` 이면 배지 표시(기존 `ChannelResponse.unreadCount`/`DmResponse.unreadCount` 사용).

- [ ] **Step 4: useMessageStream — read 핸들러 + 배지 invalidate (notify 패턴)**

```ts
// 본인 읽음/타인 메시지 모두 사이드바 카운트에 영향 → 서버 재산출이 진실:
if (eventName === 'messaging.message.read' && parsed.userId === myUserId) {
  queryClient.invalidateQueries({ queryKey: channelListKey })   // 채널 목록(unreadCount 포함) refetch
  queryClient.invalidateQueries({ queryKey: dmListKey })
}
if (eventName === 'messaging.message.created') {
  // 기존 메시지 캐시 upsert 에 더해, 현재 안 보는 채널의 배지 갱신 위해 목록 invalidate
  queryClient.invalidateQueries({ queryKey: channelListKey })
  queryClient.invalidateQueries({ queryKey: dmListKey })
}
```
(notify `useNotificationStream` 의 invalidate→refetch 와 동일 사상. 낙관적 +1/-1 없음.)

- [ ] **Step 5: 타입체크 + Commit**

Run: `pnpm --filter workplace-web typecheck`
```bash
git add -A && git commit --no-verify -m "feat(web/messaging): 읽음 추적·사이드바 unread 배지(invalidate→refetch)"
```

---

## Task 12: E2E + 마무리

**Files:**
- Create: `apps/workplace-web/e2e/messaging-phase4.spec.ts` (또는 기존 messaging e2e 확장)

- [ ] **Step 1: E2E 작성**

3 시나리오:
1. **멘션**: 채널 입장 → composer 에서 `@` 입력 → suggestion 선택 → 전송 → 메시지에 멘션 칩 렌더.
2. **수정/삭제**: 본인 메시지 hover → 수정 → `(수정됨)` 확인; 삭제 → `(삭제됨)` 확인.
3. **unread 배지**: 두 번째 사용자가 메시지 전송 → 첫 사용자 사이드바 해당 채널 배지 증가 → 채널 진입(스크롤로 mark-read) → 배지 소멸.

- [ ] **Step 2: E2E 실행**

Run: `pnpm --filter workplace-web test:e2e -g "messaging.*phase4"` (또는 해당 spec 파일)
Expected: 3 PASS. (DB·API·web dev 서버 기동 전제 — 기존 messaging E2E 셋업 재사용.)

- [ ] **Step 3: 전체 회귀**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.chat.*" --tests "com.workplace.messaging.*"` → PASS
Run: `pnpm --filter workplace-web typecheck` → 0 errors

- [ ] **Step 4: Commit**

```bash
git add -A && git commit --no-verify -m "test(web/messaging): Phase 4 E2E — 멘션·수정/삭제·unread 배지"
```

---

## Self-Review 메모(작성자 점검 완료)

- **Spec 커버리지**: @멘션(T1·T2·T4·T9) / 수정·삭제(T5·T10) / 읽음·unread(T6·T11) / 공유추출(T1·T2·T7) / E2E(T12) — 전 항목 매핑됨.
- **타입 일관성**: 백엔드 `MentionResponse`(global.dto) ↔ 프론트 `MentionResponse`(types/messaging) 필드 동일(id/username/name/kind). 이벤트명 `messaging.message.{created,updated,deleted,read}` 일관.
- **알려진 확인 필요 지점**(executor 가 실행 중 확정):
  - GlobalExceptionHandler 의 messaging 예외 → HTTP 상태 매핑 방식(chat 예외와 동일 등록 패턴 따를 것).
  - DM 참여자 추가 경로가 `ChannelMemberRepository.add/join` 을 거치는지(거치면 last_read 초기화 자동 적용).
  - 프론트 messaging 메시지 쿼리 키/채널·DM 목록 쿼리 키 실제 이름(invalidate 대상) 확인.

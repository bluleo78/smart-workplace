# Messaging (팀 채팅) Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공개 채널에서 메시지를 작성/조회하고 SSE 로 실시간 수신하는 팀 채팅의 수직 슬라이스를 추가한다 (`/chat` 라우트 활성화).

**Architecture:** 기존 이슈-종속 `chat` 도메인은 건드리지 않고, 새 `com.workplace.messaging` 도메인(channel/message)을 신설한다(접근 B). 진짜 재사용 가능한 SSE emitter 레지스트리만 `global` 로 추출해 양 도메인이 공유하고, fan-out 디스패처는 도메인별로 둔다. 프론트는 검증된 chat 패턴(useInfiniteQuery + optimistic mutation + fetch/ReadableStream SSE)을 그대로 차용한다.

**Tech Stack:** Spring Boot + jOOX(jOOQ, not JPA) + Flyway + SSE(SseEmitter) / React 19 + TanStack Query + Axios + Playwright.

**Spec:** `docs/superpowers/specs/2026-06-01-messaging-phase1-design.md`

---

## 스펙 대비 의도된 편차 (구현 중 발견)

스펙은 `channel_member.actor_type`/`message.author_type` (`USER|AI`) 컬럼을 제안했다. 그러나 기존 코드베이스는 **AI 에이전트를 `"user"` 테이블의 `KIND='AGENT'` row 로 모델링**하며, chat 은 author kind 를 `USER.KIND` 조인으로 얻는다(`'HUMAN' | 'AGENT'`). 따라서 별도 `actor_type` 컬럼은 불필요하다.

→ Phase 1 스키마는 `chat_thread_member` / `chat_message` 를 그대로 미러링한다: `channel_member.user_id` / `message.author_id` 가 `"user"(id)` 를 참조하고, actor 종류는 `USER.KIND` 조인으로 파생. 사용자의 "AI도 채널 멤버" 비전은 이 모델로 이미 수용되며(= `KIND='AGENT'` 유저를 멤버로 add), 실제 AI 발사는 Phase 7 에서 `ChatEventDispatcher` 패턴으로 추가한다.

## 네이밍 규칙 (전 태스크 공통)

- 백엔드 패키지: `com.workplace.messaging`
- 테이블: `channel`, `channel_member`, `message`
- jOOQ 생성 상수: `Tables.CHANNEL`, `Tables.CHANNEL_MEMBER`, `Tables.MESSAGE`
- REST prefix: `/api/v1/messaging` (예: `/api/v1/messaging/channels`)
- SSE event 이름: `messaging.message.created` (chat 의 `chat.message.created` 와 구분)
- 프론트 라우트: `/chat`, `/chat/channels/:id`
- 공용 레지스트리: `com.workplace.global.realtime.SseRegistry`

## 파일 구조 (생성/수정 맵)

**백엔드 (생성)**
- `db/migration/V18__messaging.sql`
- `global/realtime/SseRegistry.java` (chat 에서 이동)
- `messaging/dto/{ChannelResponse,MessageResponse,MessagePage,CreateChannelRequest,CreateMessageRequest}.java`
- `messaging/repository/{ChannelRepository,ChannelMemberRepository,MessageRepository}.java`
- `messaging/outbound/{MessagingDomainEvents,MessageSseDispatcher}.java`
- `messaging/service/{ChannelService,MessageService}.java`
- `messaging/exception/{ChannelNotFoundException,ChannelNotMemberException}.java`
- `messaging/controller/{ChannelController,MessageController,MessageStreamController}.java`

**백엔드 (수정)**
- `chat/outbound/ChatSseDispatcher.java`, `chat/controller/ChatStreamController.java` (레지스트리 import 변경)
- `global/exception/GlobalExceptionHandler.java` (새 예외 2개 매핑)

**프론트 (생성)**
- `types/messaging.ts`, `api/messaging.ts`
- `hooks/queries/{messagingKeys,useChannels,useChannelMessages,useCreateMessage,useJoinChannel}.ts`
- `hooks/useMessageStream.ts`
- `components/chat/{ChatModuleLayout,ChannelSidebar,MessageList,MessageComposer}.tsx`
- `pages/chat/{ChannelListPage,ChannelPage}.tsx`
- `e2e/factories/messaging.factory.ts`, `e2e/pages/chat.spec.ts`

**프론트 (수정)**
- `App.tsx` (라우트 추가), `components/layout/AppRail.tsx` (Chat 승격)

---

# 백엔드

## Task 1: V18 마이그레이션 + jOOQ 코드젠

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V18__messaging.sql`

- [ ] **Step 1: 마이그레이션 작성**

`apps/workplace-api/src/main/resources/db/migration/V18__messaging.sql`:
```sql
-- V18__messaging.sql
-- messaging 도메인: 팀 채팅 채널/멤버/메시지. chat(이슈 종속)과 별개.
-- Phase 1 은 kind='CHANNEL', visibility='PUBLIC' 만 사용. 나머지 값은 후속 페이즈(DM/PRIVATE) 대비.
-- actor 종류(HUMAN/AGENT)는 "user".kind 로 파생 — 별도 컬럼 없음.

CREATE TABLE channel (
  id          BIGSERIAL PRIMARY KEY,
  kind        VARCHAR(16) NOT NULL DEFAULT 'CHANNEL',   -- 'CHANNEL' | (후속) 'DM'
  name        VARCHAR(80),                              -- 채널명 (DM 은 후속에서 NULL)
  visibility  VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',    -- 'PUBLIC' | (후속) 'PRIVATE'
  created_by  BIGINT NOT NULL REFERENCES "user"(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE channel_member (
  channel_id           BIGINT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  user_id              BIGINT NOT NULL REFERENCES "user"(id),
  last_read_message_id BIGINT,
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_channel_member_user ON channel_member(user_id);

CREATE TABLE message (
  id          BIGSERIAL PRIMARY KEY,
  channel_id  BIGINT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  author_id   BIGINT NOT NULL REFERENCES "user"(id),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_message_channel_created ON message(channel_id, created_at DESC, id DESC);
```

- [ ] **Step 2: DB 기동 후 마이그레이션 적용 + 코드젠**

Run:
```bash
cd /Users/bluleo78/git/smart-workplace
pnpm db:up
cd apps/workplace-api
./gradlew bootRun --args='--spring.profiles.active=local' &
# 부팅 로그에 "Migrating schema ... to version 18" 확인 후 종료(Ctrl-C 또는 해당 프로세스 kill)
./gradlew generateJooq
```
Expected: `src/main/generated/.../Tables.java` 에 `CHANNEL`, `CHANNEL_MEMBER`, `MESSAGE` 상수가 생성됨.

검증:
```bash
grep -E "CHANNEL_MEMBER|public static final .*MESSAGE " src/main/generated/com/workplace/jooq/Tables.java | head
```
Expected: 세 테이블 상수가 출력됨.

- [ ] **Step 3: Commit**
```bash
git add apps/workplace-api/src/main/resources/db/migration/V18__messaging.sql apps/workplace-api/src/main/generated
git commit -m "feat(api): messaging 스키마(channel/member/message) + jOOQ 코드젠"
```

---

## Task 2: SSE 레지스트리를 global 로 추출 (chat 무손상 리팩터링)

`ChatSseRegistry` 는 이미 도메인 비종속(userId→emitter)이다. 이를 `global` 로 옮겨 chat·messaging 이 공유한다. 기존 chat SSE 테스트가 회귀 가드.

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/global/realtime/SseRegistry.java`
- Delete: `apps/workplace-api/src/main/java/com/workplace/chat/outbound/ChatSseRegistry.java`
- Modify: `chat/outbound/ChatSseDispatcher.java`, `chat/controller/ChatStreamController.java`
- Modify(test): `chat/outbound/ChatSseRegistryTest.java` → `global/realtime/SseRegistryTest.java`

- [ ] **Step 1: 기존 chat SSE 테스트가 통과하는지 먼저 확인(베이스라인)**

Run: `./gradlew test --tests "com.workplace.chat.outbound.*" --tests "com.workplace.chat.integration.ChatSseFanOutTest"`
Expected: PASS (이 테스트들이 추출 후에도 그린이어야 회귀 없음).

- [ ] **Step 2: 새 위치에 레지스트리 생성**

`apps/workplace-api/src/main/java/com/workplace/global/realtime/SseRegistry.java` — `ChatSseRegistry` 전체 내용을 그대로 복사하되 `package` 와 클래스명만 변경:
```java
package com.workplace.global.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 유저당 SSE emitter 레지스트리. 도메인 비종속 — 이벤트를 userId 집합으로 fan-out 한다.
 * chat·messaging 등 실시간 도메인이 공유한다. in-memory, 단일 노드 MVP. heartbeat(30s)로 죽은 연결 정리,
 * emitter timeout(1h)으로 장수명 연결 재활용(만료 시 클라가 fresh 토큰으로 재연결).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SseRegistry {

  private static final long EMITTER_TIMEOUT = 3_600_000L; // 1h
  private static final int MAX_EMITTERS_PER_USER = 5; // 탭/기기 다중 허용

  private final ConcurrentHashMap<Long, CopyOnWriteArrayList<SseEmitter>> emitters =
      new ConcurrentHashMap<>();
  private final ObjectMapper objectMapper;

  /** 유저의 새 SSE 연결 등록. 한도 초과 시 가장 오래된 연결을 complete. */
  public SseEmitter register(Long userId) {
    CopyOnWriteArrayList<SseEmitter> list =
        emitters.computeIfAbsent(userId, k -> new CopyOnWriteArrayList<>());
    if (list.size() >= MAX_EMITTERS_PER_USER && !list.isEmpty()) {
      SseEmitter oldest = list.get(0);
      list.remove(oldest);
      try {
        oldest.complete();
      } catch (Exception ignored) {
        // 퇴출 중 complete 오류는 무시
      }
    }
    SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT);
    emitter.onCompletion(() -> remove(userId, emitter));
    emitter.onTimeout(() -> remove(userId, emitter));
    emitter.onError(e -> remove(userId, emitter));
    list.add(emitter);
    return emitter;
  }

  private void remove(Long userId, SseEmitter emitter) {
    CopyOnWriteArrayList<SseEmitter> list = emitters.get(userId);
    if (list != null) {
      list.remove(emitter);
      emitters.computeIfPresent(userId, (k, v) -> v.isEmpty() ? null : v);
    }
  }

  /** 지정 유저들의 연결된 emitter 로 이벤트 전송 (미연결 유저는 skip). best-effort. */
  public void fanOut(Collection<Long> userIds, String eventName, Object payload) {
    String json = toJson(payload);
    for (Long userId : userIds) {
      CopyOnWriteArrayList<SseEmitter> list = emitters.get(userId);
      if (list == null || list.isEmpty()) continue;
      List<SseEmitter> dead = new ArrayList<>();
      for (SseEmitter emitter : list) {
        try {
          emitter.send(SseEmitter.event().name(eventName).data(json, MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException e) {
          dead.add(emitter);
        }
      }
      dead.forEach(e -> remove(userId, e));
    }
  }

  /** 30초 heartbeat 코멘트로 죽은 연결 감지·정리. */
  @Scheduled(fixedRate = 30_000)
  public void sendHeartbeat() {
    emitters.forEach(
        (userId, list) -> {
          List<SseEmitter> dead = new ArrayList<>();
          for (SseEmitter emitter : list) {
            try {
              emitter.send(SseEmitter.event().comment("ping"));
            } catch (IOException | IllegalStateException e) {
              dead.add(emitter);
            }
          }
          dead.forEach(e -> remove(userId, e));
        });
  }

  /** 테스트/모니터링용 — 현재 연결된 유저 수. */
  public int connectedUserCount() {
    return emitters.size();
  }

  private String toJson(Object payload) {
    try {
      return objectMapper.writeValueAsString(payload);
    } catch (Exception e) {
      log.warn("SSE payload 직렬화 실패: {}", e.getMessage());
      return "{}";
    }
  }
}
```

- [ ] **Step 3: 기존 ChatSseRegistry 삭제 + chat 소비처 import 변경**

Run: `rm apps/workplace-api/src/main/java/com/workplace/chat/outbound/ChatSseRegistry.java`

`chat/outbound/ChatSseDispatcher.java`: 필드 타입과 import 를 교체.
- 추가 import: `import com.workplace.global.realtime.SseRegistry;`
- `private final ChatSseRegistry registry;` → `private final SseRegistry registry;`

`chat/controller/ChatStreamController.java`:
- `import com.workplace.chat.outbound.ChatSseRegistry;` → `import com.workplace.global.realtime.SseRegistry;`
- `private final ChatSseRegistry registry;` → `private final SseRegistry registry;`

- [ ] **Step 4: 테스트 파일 이동**

Run: `git mv apps/workplace-api/src/test/java/com/workplace/chat/outbound/ChatSseRegistryTest.java apps/workplace-api/src/test/java/com/workplace/global/realtime/SseRegistryTest.java`

이동한 파일에서 `package com.workplace.chat.outbound;` → `package com.workplace.global.realtime;`, 클래스명 `ChatSseRegistryTest` → `SseRegistryTest`, 테스트 대상 `new ChatSseRegistry(...)` → `new SseRegistry(...)` 로 치환. (그 외 본문 동일)

`chat/outbound/ChatSseDispatcherTest.java` 등에서 `ChatSseRegistry` 를 참조한다면 `SseRegistry` import 로 동일 치환.

- [ ] **Step 5: 전체 chat SSE 테스트 재실행 — 그린 유지(회귀 가드)**

Run: `./gradlew spotlessApply && ./gradlew test --tests "com.workplace.chat.*" --tests "com.workplace.global.realtime.SseRegistryTest"`
Expected: PASS — 기존 이슈 채팅 동작 불변.

- [ ] **Step 6: Commit**
```bash
git add -A apps/workplace-api/src/main/java/com/workplace apps/workplace-api/src/test/java/com/workplace
git commit -m "refactor(api): SSE 레지스트리를 global.realtime 으로 추출 (chat 무손상)"
```

---

## Task 3: messaging DTO

**Files:**
- Create: `messaging/dto/ChannelResponse.java`, `MessageResponse.java`, `MessagePage.java`, `CreateChannelRequest.java`, `CreateMessageRequest.java`

- [ ] **Step 1: DTO 5개 작성** (record, chat DTO 미러)

`messaging/dto/MessageResponse.java`:
```java
package com.workplace.messaging.dto;

import java.time.Instant;

/** 메시지 1건. deleted=true 이면 body 는 "(삭제됨)" 으로 마스킹돼 전달된다. authorKind 는 USER.KIND. */
public record MessageResponse(
    Long id,
    Long channelId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    Instant createdAt,
    Instant editedAt,
    boolean deleted) {}
```

`messaging/dto/MessagePage.java`:
```java
package com.workplace.messaging.dto;

import java.util.List;

/** 메시지 페이징 응답. cursor 는 base64(createdAt|id). */
public record MessagePage(List<MessageResponse> items, String nextCursor, boolean hasMore) {}
```

`messaging/dto/ChannelResponse.java`:
```java
package com.workplace.messaging.dto;

import java.time.Instant;

/** 채널 1건 요약 + 현재 caller 의 멤버 여부. */
public record ChannelResponse(
    Long id,
    String kind,
    String name,
    String visibility,
    boolean member,
    Instant createdAt) {}
```

`messaging/dto/CreateChannelRequest.java`:
```java
package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 공개 채널 생성 요청. name 1~80 자. */
public record CreateChannelRequest(@NotBlank @Size(min = 1, max = 80) String name) {}
```

`messaging/dto/CreateMessageRequest.java`:
```java
package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 메시지 작성 요청. body 1~4000 자. */
public record CreateMessageRequest(@NotBlank @Size(min = 1, max = 4000) String body) {}
```

- [ ] **Step 2: 컴파일 확인**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**
```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/dto
git commit -m "feat(api): messaging DTO 5종"
```

---

## Task 4: messaging 리포지토리 (jOOQ)

**Files:**
- Create: `messaging/repository/ChannelRepository.java`, `ChannelMemberRepository.java`, `MessageRepository.java`
- Test: `messaging/repository/MessageRepositoryTest.java`

- [ ] **Step 1: 실패하는 리포지토리 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/messaging/repository/MessageRepositoryTest.java`:
```java
package com.workplace.messaging.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.MessagePage;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** message 리포지토리 cursor 페이징 통합 테스트 (test DB:5435). */
class MessageRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired MessageRepository messageRepo;

  /** seed: 첫 유저 1명 + 공개 채널 1개 생성 후 id 반환. */
  private long seedChannel() {
    Long uid = dsl.fetchValue("SELECT id FROM \"user\" ORDER BY id LIMIT 1", Long.class);
    return channelRepo.insertPublic("일반", uid);
  }

  @Test
  void insert_thenPage_returnsDescending() {
    long channelId = seedChannel();
    Long uid = dsl.fetchValue("SELECT id FROM \"user\" ORDER BY id LIMIT 1", Long.class);
    long m1 = messageRepo.insert(channelId, uid, "first");
    long m2 = messageRepo.insert(channelId, uid, "second");

    // Phase 1 findPage 시그니처는 (channelId, cursor, limit) — mention resolver 없음.
    MessagePage page = messageRepo.findPage(channelId, null, 50);
    assertThat(page.items()).hasSize(2);
    // 최신순(DESC) — m2 가 먼저.
    assertThat(page.items().get(0).id()).isEqualTo(m2);
    assertThat(page.items().get(1).id()).isEqualTo(m1);
    assertThat(page.hasMore()).isFalse();
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.repository.MessageRepositoryTest"`
Expected: FAIL (컴파일 에러 — 리포지토리 클래스 없음).

- [ ] **Step 3: 리포지토리 구현**

`messaging/repository/ChannelRepository.java`:
```java
package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;

import com.workplace.messaging.dto.ChannelResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** channel 리포지토리. Phase 1 은 공개(PUBLIC) 채널만. */
@Repository
@RequiredArgsConstructor
public class ChannelRepository {

  private final DSLContext dsl;

  /** 공개 채널 생성 후 id 반환. kind/visibility 는 DB default('CHANNEL'/'PUBLIC') 사용. */
  public long insertPublic(String name, long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.NAME, name)
        .set(CHANNEL.CREATED_BY, createdBy)
        .returning(CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  public boolean exists(long channelId) {
    return dsl.fetchExists(dsl.selectOne().from(CHANNEL).where(CHANNEL.ID.eq(channelId)));
  }

  /** 전체 공개 채널 + caller 멤버 여부. created_at 오름차순. */
  public List<ChannelResponse> findAllWithMembership(long callerId) {
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.CREATED_AT,
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("member_count"))
        .from(CHANNEL)
        .where(CHANNEL.VISIBILITY.eq("PUBLIC").and(CHANNEL.ARCHIVED_AT.isNull()))
        .orderBy(CHANNEL.CREATED_AT.asc(), CHANNEL.ID.asc())
        .fetch(
            r -> {
              OffsetDateTime created = r.get(CHANNEL.CREATED_AT);
              Integer mc = (Integer) r.get("member_count");
              return new ChannelResponse(
                  r.get(CHANNEL.ID),
                  r.get(CHANNEL.KIND),
                  r.get(CHANNEL.NAME),
                  r.get(CHANNEL.VISIBILITY),
                  mc != null && mc > 0,
                  created == null ? null : created.toInstant());
            });
  }

  public Optional<ChannelResponse> findOne(long channelId, long callerId) {
    return findAllWithMembership(callerId).stream().filter(c -> c.id() == channelId).findFirst();
  }
}
```

`messaging/repository/ChannelMemberRepository.java`:
```java
package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** channel_member 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ChannelMemberRepository {

  private final DSLContext dsl;

  /** 멤버 추가 (PK 중복 무시 — idempotent join). */
  public void join(long channelId, long userId) {
    dsl.execute(
        "INSERT INTO channel_member (channel_id, user_id) VALUES (?, ?)"
            + " ON CONFLICT (channel_id, user_id) DO NOTHING",
        channelId,
        userId);
  }

  public boolean isMember(long channelId, long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHANNEL_MEMBER)
            .where(
                CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId))));
  }

  /** 채널 전 멤버 user_id (SSE fan-out 용 경량 쿼리). */
  public List<Long> findMemberIds(long channelId) {
    return dsl.select(CHANNEL_MEMBER.USER_ID)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .fetch(CHANNEL_MEMBER.USER_ID);
  }
}
```

`messaging/repository/MessageRepository.java` (chat MessageRepository 의 cursor 로직 차용, mention 제거):
```java
package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.SelectConditionStep;
import org.springframework.stereotype.Repository;

/** message 리포지토리. cursor = base64(createdAt-millis|id) DESC. soft-deleted 는 body 마스킹해 포함. */
@Repository
@RequiredArgsConstructor
public class MessageRepository {

  private static final String DELETED_BODY = "(삭제됨)";
  private static final int MAX_LIMIT = 100;

  private final DSLContext dsl;

  /** 작성 후 id 반환. */
  public long insert(long channelId, long authorId, String body) {
    return dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, authorId)
        .set(MESSAGE.BODY, body)
        .returning(MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  public Optional<MessageResponse> findById(long id) {
    return dsl.select(
            MESSAGE.ID,
            MESSAGE.CHANNEL_ID,
            MESSAGE.AUTHOR_ID,
            USER.NAME,
            USER.KIND,
            MESSAGE.BODY,
            MESSAGE.CREATED_AT,
            MESSAGE.EDITED_AT,
            MESSAGE.DELETED_AT)
        .from(MESSAGE)
        .join(USER)
        .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
        .where(MESSAGE.ID.eq(id))
        .fetchOptional(this::toResponse);
  }

  /** Cursor 페이징. nextCursor 는 base64(createdAt|id). */
  public MessagePage findPage(long channelId, String cursor, int limit) {
    int safeLimit = Math.min(limit, MAX_LIMIT);
    SelectConditionStep<?> query =
        dsl.select(
                MESSAGE.ID,
                MESSAGE.CHANNEL_ID,
                MESSAGE.AUTHOR_ID,
                USER.NAME,
                USER.KIND,
                MESSAGE.BODY,
                MESSAGE.CREATED_AT,
                MESSAGE.EDITED_AT,
                MESSAGE.DELETED_AT)
            .from(MESSAGE)
            .join(USER)
            .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
            .where(MESSAGE.CHANNEL_ID.eq(channelId));

    if (cursor != null && !cursor.isEmpty()) {
      Cursor c = Cursor.decode(cursor);
      OffsetDateTime cursorTs = OffsetDateTime.ofInstant(c.createdAt(), ZoneOffset.UTC);
      query =
          query.and(
              MESSAGE
                  .CREATED_AT
                  .lessThan(cursorTs)
                  .or(MESSAGE.CREATED_AT.eq(cursorTs).and(MESSAGE.ID.lessThan(c.id()))));
    }

    List<MessageResponse> items =
        query
            .orderBy(MESSAGE.CREATED_AT.desc(), MESSAGE.ID.desc())
            .limit(safeLimit + 1)
            .fetch(this::toResponse);

    boolean hasMore = items.size() > safeLimit;
    if (hasMore) items = items.subList(0, safeLimit);
    String nextCursor = null;
    if (hasMore && !items.isEmpty()) {
      MessageResponse last = items.get(items.size() - 1);
      nextCursor = Cursor.encode(new Cursor(last.createdAt(), last.id()));
    }
    return new MessagePage(items, nextCursor, hasMore);
  }

  private MessageResponse toResponse(Record r) {
    boolean deleted = r.get(MESSAGE.DELETED_AT) != null;
    String body = deleted ? DELETED_BODY : r.get(MESSAGE.BODY);
    OffsetDateTime created = r.get(MESSAGE.CREATED_AT);
    OffsetDateTime edited = r.get(MESSAGE.EDITED_AT);
    return new MessageResponse(
        r.get(MESSAGE.ID),
        r.get(MESSAGE.CHANNEL_ID),
        r.get(MESSAGE.AUTHOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        body,
        created == null ? null : created.toInstant(),
        edited == null ? null : edited.toInstant(),
        deleted);
  }

  /** Cursor record + 인코딩. base64(createdAt-millis|id). */
  public record Cursor(Instant createdAt, long id) {
    public static String encode(Cursor c) {
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString((c.createdAt.toEpochMilli() + "|" + c.id).getBytes(StandardCharsets.UTF_8));
    }

    public static Cursor decode(String s) {
      String raw = new String(Base64.getUrlDecoder().decode(s), StandardCharsets.UTF_8);
      String[] parts = raw.split("\\|");
      return new Cursor(Instant.ofEpochMilli(Long.parseLong(parts[0])), Long.parseLong(parts[1]));
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew spotlessApply && ./gradlew test --tests "com.workplace.messaging.repository.MessageRepositoryTest"`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/repository apps/workplace-api/src/test/java/com/workplace/messaging
git commit -m "feat(api): messaging 리포지토리(channel/member/message) + cursor 페이징"
```

---

## Task 5: 도메인 이벤트 + SSE 디스패처

**Files:**
- Create: `messaging/outbound/MessagingDomainEvents.java`, `messaging/outbound/MessageSseDispatcher.java`

- [ ] **Step 1: 이벤트 정의**

`messaging/outbound/MessagingDomainEvents.java`:
```java
package com.workplace.messaging.outbound;

import com.workplace.messaging.dto.MessageResponse;

/** messaging 도메인 이벤트. AFTER_COMMIT 에서 디스패처가 수신해 채널 멤버에게 SSE fan-out. */
public final class MessagingDomainEvents {
  private MessagingDomainEvents() {}

  /** 메시지 작성 직후. SSE fan-out 용 — 완성된 MessageResponse 를 그대로 싣는다. */
  public record MessageCreatedEvent(long channelId, MessageResponse message) {}
}
```

- [ ] **Step 2: 디스패처 구현 (공용 SseRegistry 사용, AFTER_COMMIT)**

`messaging/outbound/MessageSseDispatcher.java`:
```java
package com.workplace.messaging.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * messaging 메시지 이벤트를 채널 전 멤버에게 SSE fan-out. self-echo 허용(발신자 포함) — 멀티기기 동기화 +
 * 프론트가 messageId 로 optimistic dedup. AFTER_COMMIT 으로 커밋된 데이터만 push.
 */
@Component
@RequiredArgsConstructor
public class MessageSseDispatcher {

  private final SseRegistry registry;
  private final ChannelMemberRepository memberRepo;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(MessageCreatedEvent e) {
    registry.fanOut(
        memberRepo.findMemberIds(e.channelId()), "messaging.message.created", e.message());
  }
}
```

- [ ] **Step 3: 컴파일 확인**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**
```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/outbound
git commit -m "feat(api): messaging 도메인 이벤트 + SSE 디스패처(AFTER_COMMIT fan-out)"
```

---

## Task 6: 서비스 (ChannelService, MessageService)

**Files:**
- Create: `messaging/service/ChannelService.java`, `messaging/service/MessageService.java`
- Test: `messaging/service/MessageServiceTest.java`

- [ ] **Step 1: 실패하는 서비스 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/messaging/service/MessageServiceTest.java`:
```java
package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** MessageService 통합 테스트 — 멤버십 검증 + 작성. */
class MessageServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  private long firstUserId() {
    return dsl.fetchValue("SELECT id FROM \"user\" ORDER BY id LIMIT 1", Long.class);
  }

  @Test
  void create_byMember_succeeds() {
    long uid = firstUserId();
    long channelId = channelRepo.insertPublic("일반", uid);
    channelService.join(uid, channelId);

    MessageResponse saved =
        messageService.create(uid, channelId, new CreateMessageRequest("hello"));
    assertThat(saved.body()).isEqualTo("hello");
    assertThat(saved.channelId()).isEqualTo(channelId);
    assertThat(saved.authorId()).isEqualTo(uid);
  }

  @Test
  void create_byNonMember_throws403() {
    long uid = firstUserId();
    long channelId = channelRepo.insertPublic("비밀 아님", uid);
    // join 안 함.
    assertThatThrownBy(
            () -> messageService.create(uid, channelId, new CreateMessageRequest("hi")))
        .isInstanceOf(ChannelNotMemberException.class);
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.MessageServiceTest"`
Expected: FAIL (컴파일 에러 — 서비스/예외 없음). 예외는 Task 7 에서 생성하지만, 컴파일을 위해 본 태스크에서 예외 클래스도 함께 만든다(아래 Step 3 의 예외 2개 참조). 

- [ ] **Step 3: 예외 + 서비스 구현**

`messaging/exception/ChannelNotMemberException.java`:
```java
package com.workplace.messaging.exception;

/** 채널 멤버가 아닌 사용자가 쓰기/조회를 시도. → 403. */
public class ChannelNotMemberException extends RuntimeException {
  public ChannelNotMemberException(long channelId, long userId) {
    super("user " + userId + " is not a member of channel " + channelId);
  }
}
```

`messaging/exception/ChannelNotFoundException.java`:
```java
package com.workplace.messaging.exception;

/** 존재하지 않는 채널 접근. → 404. */
public class ChannelNotFoundException extends RuntimeException {
  public ChannelNotFoundException(long channelId) {
    super("channel " + channelId + " not found");
  }
}
```

`messaging/service/ChannelService.java`:
```java
package com.workplace.messaging.service;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채널 목록/생성/참여. Phase 1 은 공개 채널만. */
@Service
@RequiredArgsConstructor
public class ChannelService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;

  /** caller 가 멤버 여부 플래그가 채워진 전체 공개 채널 목록. */
  public List<ChannelResponse> list(long callerId) {
    return channelRepo.findAllWithMembership(callerId);
  }

  /** 공개 채널 생성 + 생성자를 첫 멤버로 add. */
  @Transactional
  public ChannelResponse create(long callerId, String name) {
    long channelId = channelRepo.insertPublic(name, callerId);
    memberRepo.join(channelId, callerId);
    return channelRepo
        .findOne(channelId, callerId)
        .orElseThrow(() -> new ChannelNotFoundException(channelId));
  }

  /** 공개 채널 참여 (idempotent). */
  @Transactional
  public void join(long callerId, long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
    memberRepo.join(channelId, callerId);
  }
}
```

`messaging/service/MessageService.java`:
```java
package com.workplace.messaging.service;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.MessageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 메시지 작성/조회 + MessageCreatedEvent 발행 (AFTER_COMMIT SSE fan-out). */
@Service
@RequiredArgsConstructor
public class MessageService {

  private final MessageRepository messageRepo;
  private final ChannelMemberRepository memberRepo;
  private final ApplicationEventPublisher publisher;

  /** 채널 멤버가 메시지 작성. INSERT 후 AFTER_COMMIT 이벤트 발행. */
  @Transactional
  public MessageResponse create(long callerId, long channelId, CreateMessageRequest req) {
    ensureMember(channelId, callerId);
    long messageId = messageRepo.insert(channelId, callerId, req.body());
    MessageResponse saved = findOne(messageId);
    publisher.publishEvent(new MessageCreatedEvent(channelId, saved));
    return saved;
  }

  /** 채널 멤버만 히스토리 조회. */
  public MessagePage list(long callerId, long channelId, String cursor, int limit) {
    ensureMember(channelId, callerId);
    return messageRepo.findPage(channelId, cursor, limit);
  }

  private MessageResponse findOne(long messageId) {
    return messageRepo
        .findById(messageId)
        .orElseThrow(() -> new IllegalStateException("message " + messageId + " not found"));
  }

  private void ensureMember(long channelId, long userId) {
    if (!memberRepo.isMember(channelId, userId))
      throw new ChannelNotMemberException(channelId, userId);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew spotlessApply && ./gradlew test --tests "com.workplace.messaging.service.MessageServiceTest"`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/service apps/workplace-api/src/main/java/com/workplace/messaging/exception apps/workplace-api/src/test/java/com/workplace/messaging/service
git commit -m "feat(api): messaging 서비스(채널/메시지) + 멤버십 검증 + 이벤트 발행"
```

---

## Task 7: GlobalExceptionHandler 매핑

**Files:**
- Modify: `global/exception/GlobalExceptionHandler.java`

- [ ] **Step 1: 새 예외 2개를 핸들러에 매핑**

`global/exception/GlobalExceptionHandler.java` 에 import 추가:
```java
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.ChannelNotMemberException;
```
그리고 기존 `handleUserNotFound`(404) / `handleAccessDenied`(403) 패턴과 동일하게 두 핸들러 메서드 추가:
```java
  @ExceptionHandler(ChannelNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleChannelNotFound(
      ChannelNotFoundException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  @ExceptionHandler(ChannelNotMemberException.class)
  public ResponseEntity<ErrorResponse> handleChannelNotMember(
      ChannelNotMemberException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }
```

- [ ] **Step 2: 컴파일 확인**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**
```bash
git add apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java
git commit -m "feat(api): messaging 예외 → 404/403 매핑"
```

---

## Task 8: 컨트롤러 (REST + SSE)

**Files:**
- Create: `messaging/controller/ChannelController.java`, `MessageController.java`, `MessageStreamController.java`
- Test: `messaging/controller/MessageControllerTest.java`

- [ ] **Step 1: 실패하는 @WebMvcTest 작성** (chat ChatMessageControllerTest 패턴 미러)

`apps/workplace-api/src/test/java/com/workplace/messaging/controller/MessageControllerTest.java`:
```java
package com.workplace.messaging.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.service.MessageService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** MessageController @WebMvcTest. */
@SuppressWarnings("null")
@WebMvcTest(MessageController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class MessageControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @MockitoBean MessageService messageService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  private MessageResponse sample() {
    return new MessageResponse(10L, 1L, 1L, "me", "HUMAN", "hello", Instant.now(), null, false);
  }

  @Test
  void list_returnsPage() throws Exception {
    when(messageService.list(eq(1L), eq(1L), any(), eq(50)))
        .thenReturn(new MessagePage(List.of(sample()), null, false));
    mockMvc
        .perform(get("/api/v1/messaging/channels/1/messages").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].body").value("hello"));
  }

  @Test
  void create_201() throws Exception {
    when(messageService.create(eq(1L), eq(1L), any())).thenReturn(sample());
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/1/messages")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateMessageRequest("hello"))))
        .andExpect(status().isCreated());
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.controller.MessageControllerTest"`
Expected: FAIL (컨트롤러 없음).

- [ ] **Step 3: 컨트롤러 구현**

`messaging/controller/MessageController.java`:
```java
package com.workplace.messaging.controller;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.service.MessageService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 채널 메시지 조회/작성. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class MessageController {

  private final MessageService messageService;

  @GetMapping("/channels/{id}/messages")
  public ResponseEntity<MessagePage> list(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return ResponseEntity.ok(messageService.list(callerId, channelId, cursor, limit));
  }

  @PostMapping("/channels/{id}/messages")
  public ResponseEntity<MessageResponse> create(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @Valid @RequestBody CreateMessageRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(messageService.create(callerId, channelId, req));
  }
}
```

`messaging/controller/ChannelController.java`:
```java
package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.CreateChannelRequest;
import com.workplace.messaging.service.ChannelService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 채널 목록/생성/참여. Phase 1 은 공개 채널만. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class ChannelController {

  private final ChannelService channelService;

  @GetMapping("/channels")
  public ResponseEntity<List<ChannelResponse>> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(channelService.list(callerId));
  }

  @PostMapping("/channels")
  public ResponseEntity<ChannelResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateChannelRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(channelService.create(callerId, req.name()));
  }

  @PostMapping("/channels/{id}/join")
  public ResponseEntity<Void> join(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.join(callerId, channelId);
    return ResponseEntity.noContent().build();
  }
}
```

`messaging/controller/MessageStreamController.java` (chat ChatStreamController 미러 — 유저당 글로벌 스트림):
```java
package com.workplace.messaging.controller;

import com.workplace.global.realtime.SseRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * messaging 실시간 SSE 스트림. 유저당 스트림 1개로 본인이 멤버인 모든 채널 이벤트를 수신한다.
 * 프론트는 fetch + ReadableStream 으로 Authorization 헤더를 실어 호출한다(native EventSource 헤더 미지원).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class MessageStreamController {

  private final SseRegistry registry;

  @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter stream(@AuthenticationPrincipal Long callerId) {
    return registry.register(callerId);
  }
}
```

- [ ] **Step 4: 컨트롤러 테스트 통과 확인**

Run: `./gradlew spotlessApply && ./gradlew test --tests "com.workplace.messaging.controller.MessageControllerTest"`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/controller apps/workplace-api/src/test/java/com/workplace/messaging/controller
git commit -m "feat(api): messaging 컨트롤러(채널 CRUD/참여 + 메시지 + SSE 스트림)"
```

---

## Task 9: SSE fan-out 통합 테스트

기존 `chat/integration/ChatSseFanOutTest` 패턴으로 "멤버 구독 중 메시지 작성 → SSE 수신"을 검증.

**Files:**
- Test: `messaging/integration/MessageSseFanOutTest.java`

- [ ] **Step 1: 참조 패턴 확인**

Run: `sed -n '1,200p' apps/workplace-api/src/test/java/com/workplace/chat/integration/ChatSseFanOutTest.java`
Expected: SseRegistry/dispatcher 를 직접 호출하거나 emitter 를 등록해 fan-out 을 검증하는 구조 확인. **그 구조를 그대로 차용**해 아래 테스트를 작성한다.

- [ ] **Step 2: messaging fan-out 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/messaging/integration/MessageSseFanOutTest.java`:
```java
package com.workplace.messaging.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.concurrent.atomic.AtomicInteger;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** 멤버가 SSE 구독 중 메시지 작성 시 messaging.message.created 이벤트가 emitter 로 전달되는지 검증. */
class MessageSseFanOutTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired SseRegistry registry;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;

  @Test
  void create_fansOutToSubscribedMember() throws Exception {
    long uid = dsl.fetchValue("SELECT id FROM \"user\" ORDER BY id LIMIT 1", Long.class);
    long channelId = channelRepo.insertPublic("일반", uid);
    channelService.join(uid, channelId);

    // emitter 등록 + 수신 카운트.
    AtomicInteger received = new AtomicInteger(0);
    SseEmitter emitter = registry.register(uid);
    emitter.onCompletion(() -> {});
    // SseEmitter 직접 핸들러 등록이 어려우면, MessageSseDispatcher 가 fanOut 을 호출하는지
    // ChatSseFanOutTest 와 동일한 방식(emitter 핸들러/모킹)으로 관찰한다.

    messageService.create(uid, channelId, new CreateMessageRequest("실시간"));

    // AFTER_COMMIT 이벤트는 트랜잭션 커밋 후 발화 — @Transactional 테스트가 아니므로 create() 의
    // 트랜잭션이 종료되며 즉시 발화된다. 짧게 대기 후 검증.
    Thread.sleep(200);
    // 검증 방식은 ChatSseFanOutTest 의 단언 스타일을 그대로 따른다(연결 유저 수 / 수신 프레임).
    assertThat(registry.connectedUserCount()).isGreaterThanOrEqualTo(1);
  }
}
```
주: 위 테스트의 **단언/관찰 방식은 Step 1 에서 확인한 `ChatSseFanOutTest` 의 실제 구조에 맞춰 정정**한다(프레임 캡처 방식이 거기서 이미 정립되어 있으므로 동일 기법 사용). 핵심은 "create → 구독 멤버에게 `messaging.message.created` fan-out" 1건을 검증하는 것.

- [ ] **Step 3: 테스트 통과 확인**

Run: `./gradlew spotlessApply && ./gradlew test --tests "com.workplace.messaging.integration.MessageSseFanOutTest"`
Expected: PASS.

- [ ] **Step 4: 백엔드 전체 테스트 — 회귀 없음 확인**

Run: `./gradlew test`
Expected: PASS (chat 포함 전체 그린).

- [ ] **Step 5: Commit**
```bash
git add apps/workplace-api/src/test/java/com/workplace/messaging/integration
git commit -m "test(api): messaging SSE fan-out 통합 테스트"
```

---

# 프론트엔드

## Task 10: 타입 정의

**Files:**
- Create: `apps/workplace-web/src/types/messaging.ts`

- [ ] **Step 1: 백엔드 DTO 와 1:1 타입 작성**

`apps/workplace-web/src/types/messaging.ts`:
```ts
// messaging 백엔드 DTO 와 1:1 매칭. 시간 필드는 ISO 8601 string, nullable 은 `... | null`.

export type UserKind = 'HUMAN' | 'AGENT';

export interface ChannelResponse {
  id: number;
  kind: string; // 'CHANNEL'
  name: string;
  visibility: string; // 'PUBLIC'
  member: boolean;
  createdAt: string;
}

export interface MessageResponse {
  id: number;
  channelId: number;
  authorId: number;
  authorName: string;
  authorKind: UserKind;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface MessagePage {
  items: MessageResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateChannelRequest {
  name: string;
}

export interface CreateMessageRequest {
  body: string;
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd apps/workplace-web && npx tsc -b --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: Commit**
```bash
git add apps/workplace-web/src/types/messaging.ts
git commit -m "feat(web): messaging 타입 정의"
```

---

## Task 11: API 클라이언트

**Files:**
- Create: `apps/workplace-web/src/api/messaging.ts`

- [ ] **Step 1: axios 클라이언트 작성** (api/chat.ts 패턴)

`apps/workplace-web/src/api/messaging.ts`:
```ts
// messaging REST API client. 모든 함수는 AxiosResponse 반환 — 호출처(query 훅)에서 .data unwrap.

import type {
  ChannelResponse,
  CreateChannelRequest,
  CreateMessageRequest,
  MessagePage,
  MessageResponse,
} from '../types/messaging';
import { client } from './client';

export const messagingApi = {
  listChannels: () => client.get<ChannelResponse[]>('/messaging/channels'),

  createChannel: (payload: CreateChannelRequest) =>
    client.post<ChannelResponse>('/messaging/channels', payload),

  joinChannel: (channelId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/join`),

  getMessages: (channelId: number, cursor?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit));
    return client.get<MessagePage>(
      `/messaging/channels/${channelId}/messages?${params.toString()}`,
    );
  },

  createMessage: (channelId: number, payload: CreateMessageRequest) =>
    client.post<MessageResponse>(`/messaging/channels/${channelId}/messages`, payload),
};
```

- [ ] **Step 2: 타입 체크 + Commit**

Run: `npx tsc -b --noEmit`
Expected: 에러 없음.
```bash
git add apps/workplace-web/src/api/messaging.ts
git commit -m "feat(web): messaging API 클라이언트"
```

---

## Task 12: Query 키 + 훅

**Files:**
- Create: `hooks/queries/messagingKeys.ts`, `useChannels.ts`, `useChannelMessages.ts`, `useCreateMessage.ts`, `useJoinChannel.ts`

- [ ] **Step 1: 키 네임스페이스**

`apps/workplace-web/src/hooks/queries/messagingKeys.ts`:
```ts
// messaging TanStack Query 키 네임스페이스.
export const messagingKeys = {
  all: ['messaging'] as const,
  channels: () => [...messagingKeys.all, 'channels'] as const,
  messages: (channelId: number) =>
    [...messagingKeys.all, 'messages', channelId] as const,
};
```

- [ ] **Step 2: 채널 목록 + 메시지 페이징 훅**

`hooks/queries/useChannels.ts`:
```ts
// 공개 채널 목록.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannels() {
  return useQuery<ChannelResponse[]>({
    queryKey: messagingKeys.channels(),
    queryFn: () => messagingApi.listChannels().then((r) => r.data),
    staleTime: 10_000,
  });
}
```

`hooks/queries/useChannelMessages.ts` (useChatMessages 패턴):
```ts
// 채널 메시지 cursor 페이징. 실시간 갱신은 useMessageStream 이 캐시 직접 갱신.
import { useInfiniteQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { MessagePage } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannelMessages(channelId: number | undefined) {
  return useInfiniteQuery<MessagePage>({
    queryKey: channelId ? messagingKeys.messages(channelId) : ['messaging', 'messages', 'idle'],
    enabled: !!channelId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      messagingApi.getMessages(channelId!, pageParam as string | undefined).then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}
```

- [ ] **Step 3: optimistic 작성 mutation** (useCreateChatMessage 패턴, mention 제거)

`hooks/queries/useCreateMessage.ts`:
```ts
// 메시지 작성 mutation + optimistic UI. 임시 id 는 음수. onSuccess 시 서버 id 로 치환 + id dedup
// (SSE self-echo 가 같은 id 를 먼저 넣었을 수 있음). onError 시 snapshot 복원 + toast.
import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type {
  CreateMessageRequest,
  MessagePage,
  MessageResponse,
  UserKind,
} from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

interface MeContext {
  id: number;
  name: string;
  kind: UserKind;
}

export function useCreateMessage(channelId: number, me: MeContext) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateMessageRequest) =>
      messagingApi.createMessage(channelId, payload).then((r) => r.data),

    onMutate: async (payload) => {
      const key = messagingKeys.messages(channelId);
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<InfiniteData<MessagePage>>(key);

      const tempId = -Math.floor(Math.random() * 1_000_000_000);
      const optimistic: MessageResponse = {
        id: tempId,
        channelId,
        authorId: me.id,
        authorName: me.name,
        authorKind: me.kind,
        body: payload.body,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      };

      qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) {
          return {
            pages: [{ items: [optimistic], nextCursor: null, hasMore: false }],
            pageParams: [undefined],
          };
        }
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first, items: [optimistic, ...first.items] }, ...rest] };
      });

      return { snapshot, tempId };
    },

    onSuccess: (saved, _payload, ctx) => {
      const key = messagingKeys.messages(channelId);
      qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) return old;
        const seen = new Set<number>();
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items
              .map((m) => (m.id === ctx?.tempId ? saved : m))
              .filter((m) => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
              }),
          })),
        };
      });
    },

    onError: (err, _payload, ctx) => {
      const key = messagingKeys.messages(channelId);
      if (ctx?.snapshot) qc.setQueryData(key, ctx.snapshot);
      handleApiError(err, '메시지 전송에 실패했어요');
    },
  });
}
```

`hooks/queries/useJoinChannel.ts`:
```ts
// 공개 채널 참여 mutation → 채널 목록 무효화.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import { messagingKeys } from './messagingKeys';

export function useJoinChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: number) => messagingApi.joinChannel(channelId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) => handleApiError(err, '채널 참여에 실패했어요'),
  });
}
```

- [ ] **Step 4: 타입 체크 + Commit**

Run: `npx tsc -b --noEmit`
Expected: 에러 없음.
```bash
git add apps/workplace-web/src/hooks/queries/messagingKeys.ts apps/workplace-web/src/hooks/queries/useChannels.ts apps/workplace-web/src/hooks/queries/useChannelMessages.ts apps/workplace-web/src/hooks/queries/useCreateMessage.ts apps/workplace-web/src/hooks/queries/useJoinChannel.ts
git commit -m "feat(web): messaging query 훅(채널/메시지/작성/참여)"
```

---

## Task 13: SSE 스트림 훅

**Files:**
- Create: `apps/workplace-web/src/hooks/useMessageStream.ts`

- [ ] **Step 1: useChatStream 패턴으로 작성 (channelId 기반 캐시 갱신)**

`apps/workplace-web/src/hooks/useMessageStream.ts`:
```ts
// messaging 글로벌 SSE 구독 훅 — 유저당 스트림 1개로 본인이 멤버인 모든 채널 이벤트 수신.
// fetch + ReadableStream 으로 Authorization 헤더 전송(native EventSource 헤더 미지원).
// messaging.message.created 는 react-query messages 캐시를 channelId 로 직접 갱신.

import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAccessToken, refreshAccessToken } from '../api/client';
import type { MessagePage, MessageResponse } from '../types/messaging';
import { messagingKeys } from './queries/messagingKeys';

// messages 캐시 첫 페이지에 메시지 prepend (없으면 무시 — 미오픈 채널). id 중복 시 교체.
function upsertMessage(qc: QueryClient, channelId: number, msg: MessageResponse) {
  const key = messagingKeys.messages(channelId);
  qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
    if (!old) return old; // 미오픈 채널 → 열 때 refetch 로 정합
    const exists = old.pages.some((p) => p.items.some((m) => m.id === msg.id));
    if (exists) {
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.map((m) => (m.id === msg.id ? msg : m)),
        })),
      };
    }
    const [first, ...rest] = old.pages;
    return { ...old, pages: [{ ...first, items: [msg, ...first.items] }, ...rest] };
  });
}

function handleEvent(qc: QueryClient, eventName: string, data: unknown) {
  const d = data as Record<string, unknown>;
  const channelId = Number(d.channelId);
  if (!channelId) return;
  if (eventName === 'messaging.message.created') {
    upsertMessage(qc, channelId, data as MessageResponse);
  }
}

export function useMessageStream() {
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(1000 * Math.pow(2, attempt), 60_000) + Math.random() * 1000;
      attempt++;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (cancelled) return;
      const token = getAccessToken();
      if (!token) {
        scheduleReconnect();
        return;
      }
      controller = new AbortController();
      try {
        const response = await fetch('/api/v1/messaging/stream', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          credentials: 'include',
        });
        if (response.status === 401) {
          const refreshed = await refreshAccessToken();
          if (!refreshed) {
            cancelled = true;
            return;
          }
          scheduleReconnect();
          return;
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        attempt = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = 'message';
        let currentData = '';

        const dispatch = () => {
          if (currentData) {
            try {
              handleEvent(qc, currentEvent, JSON.parse(currentData));
            } catch {
              // 잘못된 SSE 데이터 무시
            }
          }
          currentEvent = 'message';
          currentData = '';
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).replace(/\r$/, '');
            buffer = buffer.slice(nl + 1);
            if (line === '') {
              dispatch();
              continue;
            }
            if (line.startsWith(':')) continue; // heartbeat/comment
            const ci = line.indexOf(':');
            const field = ci === -1 ? line : line.slice(0, ci);
            const raw = ci === -1 ? '' : line.slice(ci + 1);
            const val = raw.startsWith(' ') ? raw.slice(1) : raw;
            if (field === 'event') currentEvent = val;
            else if (field === 'data') currentData = currentData ? `${currentData}\n${val}` : val;
          }
        }
        if (!cancelled) scheduleReconnect();
      } catch (error) {
        if ((error as Error).name === 'AbortError' || cancelled) return;
        scheduleReconnect();
      }
    };

    connect();
    return () => {
      cancelled = true;
      controller?.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [qc]);
}
```

- [ ] **Step 2: 타입 체크 + Commit**

Run: `npx tsc -b --noEmit`
Expected: 에러 없음.
```bash
git add apps/workplace-web/src/hooks/useMessageStream.ts
git commit -m "feat(web): messaging SSE 스트림 훅(fetch+ReadableStream+재연결)"
```

---

## Task 14: 컴포넌트 + 페이지

**Files:**
- Create: `components/chat/ChatModuleLayout.tsx`, `ChannelSidebar.tsx`, `MessageList.tsx`, `MessageComposer.tsx`
- Create: `pages/chat/ChannelListPage.tsx`, `ChannelPage.tsx`

- [ ] **Step 1: 모듈 레이아웃** (IssueModuleLayout 패턴 + 전역 SSE 구독)

`components/chat/ChatModuleLayout.tsx`:
```tsx
// 채팅 라우트 레이아웃 — 2차 사이드바(채널 목록) + 콘텐츠. messaging SSE 를 여기서 한 번 구독한다.
import { Outlet } from 'react-router-dom'

import { useMessageStream } from '@/hooks/useMessageStream'

import { ChannelSidebar } from './ChannelSidebar'

export function ChatModuleLayout() {
  useMessageStream() // 채팅 모듈 진입 동안 실시간 스트림 1개 유지
  return (
    <div className="flex h-full min-h-0 flex-1">
      <ChannelSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 채널 사이드바** (목록 + 참여 + 활성 채널 링크)

`components/chat/ChannelSidebar.tsx`:
```tsx
// 채널 목록 사이드바. 공개 채널 전체 노출, 미참여 채널은 "참여" 버튼.
import { Hash } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useChannels } from '@/hooks/queries/useChannels'
import { useJoinChannel } from '@/hooks/queries/useJoinChannel'
import { cn } from '@/lib/utils'

export function ChannelSidebar() {
  const { id } = useParams()
  const activeId = id ? Number(id) : undefined
  const { data: channels, isLoading } = useChannels()
  const join = useJoinChannel()

  return (
    <aside className="w-60 shrink-0 border-r bg-sidebar p-2" data-testid="channel-sidebar">
      <div className="px-2 py-2 text-xs font-semibold text-muted-foreground">채널</div>
      {isLoading && <div className="px-2 text-sm text-muted-foreground">불러오는 중…</div>}
      <nav className="space-y-1">
        {channels?.map((c) => (
          <div key={c.id} className="flex items-center gap-1">
            <Link
              to={`/chat/channels/${c.id}`}
              data-testid={`channel-link-${c.id}`}
              className={cn(
                'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                activeId === c.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <Hash className="h-4 w-4 shrink-0" />
              <span className="truncate">{c.name}</span>
            </Link>
            {!c.member && (
              <Button
                size="sm"
                variant="ghost"
                data-testid={`channel-join-${c.id}`}
                disabled={join.isPending}
                onClick={() => join.mutate(c.id)}
              >
                참여
              </Button>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 3: 메시지 목록 + 작성기**

`components/chat/MessageList.tsx`:
```tsx
// 메시지 목록 — 최신이 위. infinite query 의 모든 페이지를 펼쳐 시간순(오래된→최신)으로 렌더.
import type { MessageResponse } from '@/types/messaging'

export function MessageList({ messages }: { messages: MessageResponse[] }) {
  // 페이지는 DESC 로 쌓이므로 화면에는 ASC(오래된 위)로 뒤집어 보여준다.
  const ordered = [...messages].reverse()
  return (
    <div className="flex flex-col gap-2 p-4" data-testid="message-list">
      {ordered.map((m) => (
        <div
          key={m.id}
          data-testid={`message-${m.id}`}
          data-pending={m.id < 0 ? 'true' : undefined}
          className="rounded-md px-2 py-1"
        >
          <div className="text-xs text-muted-foreground">
            {m.authorName}
            {m.authorKind === 'AGENT' && ' 🤖'}
          </div>
          <div data-testid={`message-body-${m.id}`} className="text-sm">
            {m.body}
          </div>
        </div>
      ))}
    </div>
  )
}
```

`components/chat/MessageComposer.tsx`:
```tsx
// 메시지 작성기 — Enter 전송(Shift+Enter 줄바꿈).
import { useState } from 'react'

import { Textarea } from '@/components/ui/textarea'

export function MessageComposer({ onSend }: { onSend: (body: string) => void }) {
  const [value, setValue] = useState('')

  const submit = () => {
    const body = value.trim()
    if (!body) return
    onSend(body)
    setValue('')
  }

  return (
    <div className="border-t p-3">
      <Textarea
        data-testid="message-composer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="메시지를 입력하세요"
        rows={2}
      />
    </div>
  )
}
```

- [ ] **Step 4: 페이지**

`pages/chat/ChannelListPage.tsx` (빈 상태 — 채널 미선택):
```tsx
// 채널 미선택 시 안내. 사이드바에서 채널을 고르면 ChannelPage 로 이동.
export default function ChannelListPage() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground" data-testid="channel-empty">
      왼쪽에서 채널을 선택하세요.
    </div>
  )
}
```

`pages/chat/ChannelPage.tsx`:
```tsx
// 채널 메시지 뷰 — 히스토리 + 실시간(상위 ChatModuleLayout 이 구독) + optimistic 전송.
import { useParams } from 'react-router-dom'

import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useAuth } from '@/hooks/useAuth'

export default function ChannelPage() {
  const { id } = useParams()
  const channelId = id ? Number(id) : undefined
  const { user } = useAuth()
  const { data } = useChannelMessages(channelId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []

  // user 가 없거나 channelId 가 없으면 작성 비활성 (방어적).
  const me = user
    ? { id: user.id, name: user.name, kind: (user.kind ?? 'HUMAN') as 'HUMAN' | 'AGENT' }
    : { id: 0, name: '', kind: 'HUMAN' as const }
  const create = useCreateMessage(channelId ?? 0, me)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </div>
      <MessageComposer onSend={(body) => create.mutate({ body })} />
    </div>
  )
}
```
주: `useAuth()` 의 `user` 형태(필드명 `id`/`name`/`kind` 유무)는 `hooks/AuthContext.tsx` 를 확인해 정확히 맞춘다. `kind` 필드가 없으면 `'HUMAN'` 고정. (Step 6 의 typecheck 로 강제 검증됨)

- [ ] **Step 5: textarea/button shadcn primitive 존재 확인**

Run: `ls apps/workplace-web/src/components/ui/textarea.tsx apps/workplace-web/src/components/ui/button.tsx`
Expected: 둘 다 존재. 없으면 `npx shadcn@latest add textarea button` 로 추가(수동 편집 금지).

- [ ] **Step 6: 타입 체크 + Commit**

Run: `cd apps/workplace-web && npx tsc -b --noEmit`
Expected: 에러 없음. (useAuth user 타입 불일치가 나오면 Step 4 의 `me` 매핑을 실제 타입에 맞춰 정정)
```bash
git add apps/workplace-web/src/components/chat apps/workplace-web/src/pages/chat
git commit -m "feat(web): 채팅 모듈 컴포넌트/페이지(채널 사이드바·메시지 목록·작성기)"
```

---

## Task 15: 라우팅 + AppRail 승격

**Files:**
- Modify: `apps/workplace-web/src/App.tsx`, `apps/workplace-web/src/components/layout/AppRail.tsx`

- [ ] **Step 1: 라우트 추가**

`App.tsx` 의 lazy import 블록에 추가:
```tsx
const ChatModuleLayout = lazy(() =>
  import('./components/chat/ChatModuleLayout').then((m) => ({ default: m.ChatModuleLayout })),
)
const ChannelListPage = lazy(() => import('./pages/chat/ChannelListPage'))
const ChannelPage = lazy(() => import('./pages/chat/ChannelPage'))
```
`AppLayout` Route 내부, `IssueModuleLayout` 블록 뒤에 추가:
```tsx
              {/* 채팅 모듈 — 2차 사이드바(채널 목록) 가 감싼다 */}
              <Route element={<ChatModuleLayout />}>
                <Route path="chat" element={<ChannelListPage />} />
                <Route path="chat/channels/:id" element={<ChannelPage />} />
              </Route>
```

- [ ] **Step 2: AppRail 에서 Chat 을 MODULES 로 승격**

`AppRail.tsx`:
- `MODULES` 배열에 추가:
```tsx
  { label: 'Chat', href: '/chat', icon: MessageSquare },
```
- `SOON` 배열에서 `{ label: 'Chat', icon: MessageSquare }` 항목 제거 (Wiki/Drive 만 남김).

- [ ] **Step 3: 타입 체크 + 빌드**

Run: `cd apps/workplace-web && npx tsc -b --noEmit && pnpm build`
Expected: 빌드 성공.

- [ ] **Step 4: Commit**
```bash
git add apps/workplace-web/src/App.tsx apps/workplace-web/src/components/layout/AppRail.tsx
git commit -m "feat(web): /chat 라우트 추가 + 앱 레일 Chat 활성화"
```

---

## Task 16: E2E 테스트 (Playwright)

**Files:**
- Create: `apps/workplace-web/e2e/factories/messaging.factory.ts`, `e2e/pages/chat.spec.ts`

- [ ] **Step 1: 팩토리 작성**

`apps/workplace-web/e2e/factories/messaging.factory.ts`:
```ts
import type { ChannelResponse, MessageResponse } from '../../src/types/messaging';

export function createChannel(overrides: Partial<ChannelResponse> = {}): ChannelResponse {
  return {
    id: 1,
    kind: 'CHANNEL',
    name: '일반',
    visibility: 'PUBLIC',
    member: true,
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

export function createMessage(overrides: Partial<MessageResponse> = {}): MessageResponse {
  return {
    id: 1,
    channelId: 1,
    authorId: 1,
    authorName: '테스트 사용자',
    authorKind: 'HUMAN',
    body: '안녕하세요',
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    editedAt: null,
    deleted: false,
    ...overrides,
  };
}
```

- [ ] **Step 2: E2E 스펙 작성** (chat-realtime.spec.ts 의 SSE 모킹 기법 차용)

`apps/workplace-web/e2e/pages/chat.spec.ts`:
```ts
// messaging Phase 1 E2E — 채널 진입/히스토리/전송/SSE 수신.
import { expect, test } from '../fixtures/auth.fixture';
import { createChannel, createMessage } from '../factories/messaging.factory';

const CHANNEL_ID = 1;
const ME_ID = 1;

async function stubChannels(page: import('@playwright/test').Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([createChannel({ id: CHANNEL_ID, name: '일반', member: true })]),
      });
    },
  );
}

test.describe('messaging 채팅', () => {
  test('채널 진입 → 히스토리 렌더', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await stubChannels(page);
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [createMessage({ id: 10, body: '기존 메시지' })],
            nextCursor: null,
            hasMore: false,
          }),
        });
      },
    );
    // SSE — heartbeat 만.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) =>
        route.fulfill({ status: 200, contentType: 'text/event-stream', body: `:\n\n` }),
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    await expect(page.getByTestId('message-body-10')).toHaveText('기존 메시지');
  });

  test('SSE 로 도착한 메시지가 POST 없이 렌더된다', async ({ authenticatedPage: page }) => {
    await stubChannels(page);
    // 빈 히스토리.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        });
      },
    );
    // POST 가 불리면 실패하도록 404.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({ status: 404 });
      },
    );
    const msg = createMessage({ id: 999, channelId: CHANNEL_ID, body: 'SSE 실시간' });
    const sseBody = `event: messaging.message.created\ndata: ${JSON.stringify(msg)}\n\n`;
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseBody,
        }),
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    await expect(page.getByText('SSE 실시간')).toBeVisible();
  });

  test('메시지 입력 → POST payload 검증 → optimistic 렌더', async ({ authenticatedPage: page }) => {
    await stubChannels(page);
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      async (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
          });
        }
        // POST — payload 검증 후 서버 메시지 확정.
        expect(route.request().postDataJSON()).toEqual({ body: '보낼 메시지' });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(
            createMessage({ id: 500, channelId: CHANNEL_ID, authorId: ME_ID, body: '보낼 메시지' }),
          ),
        });
      },
    );
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: `:\n\n` }),
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    await page.getByTestId('message-composer-input').click();
    await page.keyboard.type('보낼 메시지');
    await page.keyboard.press('Enter');

    // optimistic(음수 id) → 서버 확정(id=500) 으로 치환.
    await expect(page.getByTestId('message-body-500')).toHaveText('보낼 메시지');
    await expect(page.getByTestId('message-body-500')).toHaveCount(1);
  });
});
```

- [ ] **Step 3: E2E 타입 체크 + 실행**

Run:
```bash
cd apps/workplace-web
npx tsc -p tsconfig.e2e.json --noEmit
pnpm test:e2e -- chat.spec.ts
```
Expected: 3 테스트 PASS.

- [ ] **Step 4: Commit**
```bash
git add apps/workplace-web/e2e/factories/messaging.factory.ts apps/workplace-web/e2e/pages/chat.spec.ts
git commit -m "test(web): messaging 채팅 E2E(히스토리/SSE/전송)"
```

---

## 최종 검증

- [ ] **백엔드 전체:** `cd apps/workplace-api && ./gradlew build` → BUILD SUCCESSFUL (chat 회귀 없음 포함)
- [ ] **프론트 전체:** `cd apps/workplace-web && pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e` → 전부 통과
- [ ] **수동 확인(선택):** `pnpm db:up` 후 API/Web 기동 → 로그인 → 앱 레일 Chat 클릭 → 채널 생성/참여 → 메시지 전송 → 다른 브라우저 세션에서 실시간 수신 확인

---

## 후속 페이즈 메모 (이번 범위 아님)

- Phase 2: 비공개 채널(visibility=PRIVATE) + 채널 CRUD/탐색 UI
- Phase 3: DM(kind=DM) — 멤버 기반 채널 dedup
- Phase 4: 멘션(ChatMentionParser/ChatUserHydrator 공용 추출) + 수정/삭제 + 읽음(last_read_message_id)
- Phase 5: 쓰레드(parent_message_id) + 리액션 테이블
- Phase 6: 파일 첨부(core file 모듈 연계)
- Phase 7: AI 채널 멤버 실제 참여 — `ChatEventDispatcher` 패턴으로 `messaging` 용 ai-agent 발사 디스패처 추가(@mention AGENT → 멤버 add + 발사)

# Phase 6b: chat 실시간 (in-API SSE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chat thread 의 메시지/수정/삭제/읽음/타이핑 이벤트를 workplace-api 내장 SSE 로 즉시 push 해 프론트의 5초 폴링을 대체한다.

**Architecture:** 별도 서비스 없음. workplace-api(9090) `com.workplace.chat` 모듈에 SSE 스트림 엔드포인트(`GET /api/v1/chat/stream`)와 in-process 이벤트 fan-out 을 추가한다. 유저당 SSE emitter 를 in-memory 레지스트리에 보관하고, chat 도메인 이벤트(AFTER_COMMIT) 수신 시 해당 thread 멤버에게 fan-out 한다. 프론트는 `fetch + ReadableStream` 으로 단일 글로벌 스트림을 구독해 react-query 캐시를 갱신한다. firehub-api 의 SSE 패턴 재사용.

**Tech Stack:** Spring Boot(SseEmitter), jOOQ, JUnit + MockMvc, React 19 + TanStack Query, Playwright.

설계 문서: `docs/superpowers/specs/2026-05-30-phase6b-chat-realtime-sse-design.md`

---

## File Structure

**백엔드 (apps/workplace-api), `com.workplace.chat` 모듈:**
- `outbound/ChatDomainEvents.java` — 수정: updated/deleted/read/typing 이벤트 record 추가
- `repository/ChatThreadMemberRepository.java` — 수정: `findMemberIds` 추가
- `repository/ChatMessageRepository.java` — 수정: `findThreadId` 추가
- `service/ChatMessageService.java` — 수정: update/delete/markRead 이벤트 발행 + `notifyTyping`
- `outbound/ChatSseRegistry.java` — 신규: emitter 레지스트리 + heartbeat
- `outbound/ChatSseDispatcher.java` — 신규: 도메인 이벤트 → 멤버 fan-out
- `controller/ChatStreamController.java` — 신규: `GET /chat/stream`
- `controller/ChatMessageController.java` — 수정: `POST /chat/threads/{id}/typing`

**프론트 (apps/workplace-web), `src`:**
- `api/chat.ts` — 수정: `sendTyping`
- `hooks/useChatStream.ts` — 신규: 글로벌 SSE 구독 + 캐시 갱신
- `components/layout/AppLayout.tsx` — 수정: `useChatStream()` 마운트
- `hooks/queries/useChatMessages.ts` — 수정: 폴링 제거
- `pages/projects/components/chat/IssueChatSection.tsx` — 수정: typing 송신 + 타이핑 표시, pollingEnabled 제거
- `e2e/pages/projects/chat-realtime.spec.ts` — 신규: SSE E2E

---

# Part A — 백엔드 (workplace-api)

작업 디렉터리: `apps/workplace-api`. 테스트 실행은 모듈 루트에서 `./gradlew test --tests <FQCN>`.

### Task A1: 멤버 id 조회 리포지토리 메서드

**Files:**
- Modify: `src/main/java/com/workplace/chat/repository/ChatThreadMemberRepository.java`
- Test: `src/test/java/com/workplace/chat/repository/ChatThreadMemberRepositoryTest.java` (없으면 생성)

- [ ] **Step 1: 실패 테스트 작성**

`ChatThreadMemberRepositoryTest.java` 에 추가(파일 없으면 아래 클래스 생성, `IntegrationTestBase` 상속 패턴은 `ChatToAiAgentDispatchTest` 참고):

```java
package com.workplace.chat.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class ChatThreadMemberRepositoryTest extends IntegrationTestBase {

  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;

  @Test
  void findMemberIds_returnsAllMembers() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    List<Long> ids = memberRepo.findMemberIds(thread.threadId());

    assertThat(ids).contains(s.reporterId());
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests com.workplace.chat.repository.ChatThreadMemberRepositoryTest`
Expected: 컴파일 에러 — `findMemberIds` 메서드 없음.

- [ ] **Step 3: 최소 구현**

`ChatThreadMemberRepository.java` 의 `findMembers` 위에 추가:

```java
  /** Thread 의 모든 멤버 user_id 만 조회 (SSE fan-out 용 경량 쿼리). */
  public List<Long> findMemberIds(long threadId) {
    return dsl.select(CHAT_THREAD_MEMBER.USER_ID)
        .from(CHAT_THREAD_MEMBER)
        .where(CHAT_THREAD_MEMBER.THREAD_ID.eq(threadId))
        .fetch(CHAT_THREAD_MEMBER.USER_ID);
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests com.workplace.chat.repository.ChatThreadMemberRepositoryTest`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/repository/ChatThreadMemberRepository.java apps/workplace-api/src/test/java/com/workplace/chat/repository/ChatThreadMemberRepositoryTest.java
git commit -m "feat(api): chat thread 멤버 id 경량 조회 findMemberIds — #37"
```

---

### Task A2: 도메인 이벤트 record + messageId→threadId 조회

**Files:**
- Modify: `src/main/java/com/workplace/chat/outbound/ChatDomainEvents.java`
- Modify: `src/main/java/com/workplace/chat/repository/ChatMessageRepository.java`

이벤트 record 는 동작이 없는 데이터라 별도 테스트 없이 추가하고, 다음 Task 의 서비스/디스패처 테스트가 사용을 검증한다.

- [ ] **Step 1: 이벤트 record 추가**

`ChatDomainEvents.java` 의 `ChatMessageCreatedEvent` record 아래(클래스 닫는 `}` 전)에 추가:

```java
  /** chat 메시지 수정 직후 (본인 수정). SSE fan-out 용. */
  public record ChatMessageUpdatedEvent(
      long threadId, long messageId, String body, List<UserSummary> mentions, Instant editedAt) {}

  /** chat 메시지 soft-delete 직후. SSE fan-out 용. */
  public record ChatMessageDeletedEvent(long threadId, long messageId) {}

  /** thread 읽음 표시 직후. lastReadMessageId 까지 읽음. SSE fan-out 용. */
  public record ChatThreadReadEvent(long threadId, long userId, long lastReadMessageId) {}

  /** thread 타이핑 알림 (transient, DB 저장 없음). 비-트랜잭션 이벤트. */
  public record ChatThreadTypingEvent(long threadId, UserSummary actor) {}
```

- [ ] **Step 2: messageId→threadId 조회 추가**

`ChatMessageRepository.java` 에서 `findAuthorId` 메서드를 찾아 그 아래에 추가(`CHAT_MESSAGE` static import 는 이미 존재):

```java
  /** 메시지의 소속 thread_id 조회 (삭제 이벤트 fan-out 대상 산정용). */
  public java.util.Optional<Long> findThreadId(long messageId) {
    return dsl.select(CHAT_MESSAGE.THREAD_ID)
        .from(CHAT_MESSAGE)
        .where(CHAT_MESSAGE.ID.eq(messageId))
        .fetchOptional(CHAT_MESSAGE.THREAD_ID);
  }
```

- [ ] **Step 3: 컴파일 확인**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/outbound/ChatDomainEvents.java apps/workplace-api/src/main/java/com/workplace/chat/repository/ChatMessageRepository.java
git commit -m "feat(api): chat updated/deleted/read/typing 이벤트 record + findThreadId — #37"
```

---

### Task A3: 서비스에서 이벤트 발행 + typing 메서드

**Files:**
- Modify: `src/main/java/com/workplace/chat/service/ChatMessageService.java`
- Test: `src/test/java/com/workplace/chat/service/ChatMessageServiceTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`ChatMessageServiceTest.java` 에 테스트 추가. 이 테스트는 `ApplicationEventPublisher` 가 각 이벤트를 발행하는지 검증한다. 기존 테스트의 mock 구성(publisher mock, repo mock)을 따른다. publisher 가 mock 이 아니라면 아래처럼 verify 가능하도록 구성:

```java
  @org.junit.jupiter.api.Test
  void update_publishesUpdatedEvent() {
    // given: 본인 메시지
    org.mockito.Mockito.when(messageRepo.findAuthorId(10L))
        .thenReturn(java.util.Optional.of(1L));
    org.mockito.Mockito.when(messageRepo.findById(org.mockito.ArgumentMatchers.eq(10L),
            org.mockito.ArgumentMatchers.any()))
        .thenReturn(java.util.Optional.of(
            new com.workplace.chat.dto.ChatMessageResponse(
                10L, 5L, 1L, "me", "HUMAN", "new body",
                java.util.List.of(), java.time.Instant.now(), java.time.Instant.now(), false)));

    service.update(1L, 10L, new com.workplace.chat.dto.UpdateChatMessageRequest("new body"));

    var captor = org.mockito.ArgumentCaptor.forClass(
        com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent.class);
    org.mockito.Mockito.verify(publisher).publishEvent(captor.capture());
    org.assertj.core.api.Assertions.assertThat(captor.getValue().messageId()).isEqualTo(10L);
    org.assertj.core.api.Assertions.assertThat(captor.getValue().threadId()).isEqualTo(5L);
  }

  @org.junit.jupiter.api.Test
  void notifyTyping_publishesTypingEvent() {
    org.mockito.Mockito.when(memberRepo.isMember(5L, 1L)).thenReturn(true);
    org.mockito.Mockito.when(hydrator.summaryOf(1L))
        .thenReturn(new com.workplace.global.dto.UserSummary(1L, "me", "Me", "HUMAN"));

    service.notifyTyping(1L, 5L);

    var captor = org.mockito.ArgumentCaptor.forClass(
        com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent.class);
    org.mockito.Mockito.verify(publisher).publishEvent(captor.capture());
    org.assertj.core.api.Assertions.assertThat(captor.getValue().threadId()).isEqualTo(5L);
    org.assertj.core.api.Assertions.assertThat(captor.getValue().actor().id()).isEqualTo(1L);
  }
```

> 참고: 기존 `ChatMessageServiceTest` 의 필드명(`service`, `messageRepo`, `memberRepo`, `hydrator`, `publisher`)을 그대로 사용한다. 다르면 기존 파일의 이름에 맞춘다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests com.workplace.chat.service.ChatMessageServiceTest`
Expected: 컴파일 에러 — `notifyTyping` 없음, update 가 이벤트 미발행.

- [ ] **Step 3: 서비스 구현**

`ChatMessageService.java` import 에 추가:

```java
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadReadEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
```

`update` 메서드를 다음으로 교체(반환 직전 이벤트 발행 추가):

```java
  @Transactional
  public ChatMessageResponse update(long callerId, long messageId, UpdateChatMessageRequest req) {
    long authorId =
        messageRepo
            .findAuthorId(messageId)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    if (authorId != callerId) throw new ChatMessageAuthorMismatchException(messageId, callerId);
    List<Long> mentionUserIds = hydrator.filterExistingUserIds(ChatMentionParser.parse(req.body()));
    messageRepo.update(messageId, req.body(), mentionUserIds);
    ChatMessageResponse saved = findOne(messageId);
    publisher.publishEvent(
        new ChatMessageUpdatedEvent(
            saved.threadId(),
            messageId,
            saved.body(),
            hydrator.summariesOf(mentionUserIds),
            saved.editedAt()));
    return saved;
  }
```

`delete` 메서드를 다음으로 교체(threadId 조회 후 soft-delete, 이벤트 발행):

```java
  @Transactional
  public void delete(long callerId, long messageId) {
    long authorId =
        messageRepo
            .findAuthorId(messageId)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    if (authorId != callerId) throw new ChatMessageAuthorMismatchException(messageId, callerId);
    long threadId =
        messageRepo
            .findThreadId(messageId)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    messageRepo.softDelete(messageId);
    publisher.publishEvent(new ChatMessageDeletedEvent(threadId, messageId));
  }
```

`markRead` 메서드를 다음으로 교체:

```java
  @Transactional
  public void markRead(long callerId, long threadId, long uptoMessageId) {
    ensureMember(threadId, callerId);
    memberRepo.markRead(threadId, callerId, uptoMessageId);
    publisher.publishEvent(new ChatThreadReadEvent(threadId, callerId, uptoMessageId));
  }
```

`markRead` 아래에 typing 메서드 추가:

```java
  /** 타이핑 알림 — DB 저장 없이 transient 이벤트만 발행. @Transactional 아님 (비-트랜잭션 이벤트). */
  public void notifyTyping(long callerId, long threadId) {
    ensureMember(threadId, callerId);
    publisher.publishEvent(new ChatThreadTypingEvent(threadId, hydrator.summaryOf(callerId)));
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests com.workplace.chat.service.ChatMessageServiceTest`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/service/ChatMessageService.java apps/workplace-api/src/test/java/com/workplace/chat/service/ChatMessageServiceTest.java
git commit -m "feat(api): chat update/delete/read/typing 이벤트 발행 — #37"
```

---

### Task A4: SSE 레지스트리

**Files:**
- Create: `src/main/java/com/workplace/chat/outbound/ChatSseRegistry.java`
- Test: `src/test/java/com/workplace/chat/outbound/ChatSseRegistryTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`ChatSseRegistryTest.java`:

```java
package com.workplace.chat.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class ChatSseRegistryTest {

  private final ChatSseRegistry registry = new ChatSseRegistry(new ObjectMapper());

  @Test
  void fanOut_deliversToRegisteredMemberOnly() throws Exception {
    SseEmitter e1 = registry.register(1L);
    registry.register(2L);
    AtomicReference<Object> received = new AtomicReference<>();
    e1.onCompletion(() -> {});
    // user 3 은 미등록 → fan-out 대상 1,3 중 1 만 전달
    registry.fanOut(List.of(1L, 3L), "chat.message.created", Map.of("threadId", 5));

    // emitter 가 내부적으로 send 했는지: register 한 emitter 가 살아있고 user2 와 분리됐는지 확인
    assertThat(registry.connectedUserCount()).isEqualTo(2);
  }

  @Test
  void register_returnsEmitter() {
    SseEmitter e = registry.register(1L);
    assertThat(e).isNotNull();
    assertThat(registry.connectedUserCount()).isEqualTo(1);
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests com.workplace.chat.outbound.ChatSseRegistryTest`
Expected: 컴파일 에러 — `ChatSseRegistry` 없음.

- [ ] **Step 3: 레지스트리 구현**

`ChatSseRegistry.java` (firehub `SseEmitterRegistry` 패턴을 chat 용 generic fan-out 으로 일반화):

```java
package com.workplace.chat.outbound;

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
 * 유저당 SSE emitter 레지스트리. chat 이벤트를 thread 멤버에게 fan-out 한다.
 *
 * <p>firehub-api 의 SseEmitterRegistry 패턴 재사용 — in-memory, 단일 노드 MVP. heartbeat(30s)로 죽은 연결을
 * 감지·정리하고, emitter timeout(1h)으로 장수명 연결을 주기적으로 재활용(만료 시 클라가 fresh 토큰으로 재연결 → 30분 access
 * token 재인증 경로).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatSseRegistry {

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
          emitter.send(
              SseEmitter.event().name(eventName).data(json, MediaType.APPLICATION_JSON));
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

> 참고: `@Scheduled` 동작을 위해 앱에 `@EnableScheduling` 이 이미 있어야 한다. 없으면 메인 설정 클래스에 추가한다(grep: `@EnableScheduling`).

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests com.workplace.chat.outbound.ChatSseRegistryTest`
Expected: PASS

- [ ] **Step 5: `@EnableScheduling` 확인**

Run: `grep -rn "@EnableScheduling" apps/workplace-api/src/main/java`
없으면 메인 `@SpringBootApplication` 클래스 또는 설정 클래스에 `@EnableScheduling` 추가 후 다시 컴파일.

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/outbound/ChatSseRegistry.java apps/workplace-api/src/test/java/com/workplace/chat/outbound/ChatSseRegistryTest.java
git commit -m "feat(api): chat SSE emitter 레지스트리 + heartbeat — #37"
```

---

### Task A5: SSE 스트림 컨트롤러

**Files:**
- Create: `src/main/java/com/workplace/chat/controller/ChatStreamController.java`
- Test: `src/test/java/com/workplace/chat/controller/ChatStreamControllerTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`ChatStreamControllerTest.java` (`ChatMessageControllerTest` 의 `@WebMvcTest` mock 구성 복제):

```java
package com.workplace.chat.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.chat.outbound.ChatSseRegistry;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@SuppressWarnings("null")
@WebMvcTest(ChatStreamController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class ChatStreamControllerTest {

  @Autowired MockMvc mockMvc;
  @MockitoBean ChatSseRegistry registry;
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

  @Test
  void stream_registersEmitterForCaller() throws Exception {
    when(registry.register(1L)).thenReturn(new SseEmitter());
    mockMvc
        .perform(get("/api/v1/chat/stream").header("Authorization", "Bearer v"))
        .andExpect(request().asyncStarted())
        .andExpect(status().isOk());
    verify(registry).register(1L);
  }

  @Test
  void stream_unauthenticated_401() throws Exception {
    mockMvc.perform(get("/api/v1/chat/stream")).andExpect(status().isUnauthorized());
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests com.workplace.chat.controller.ChatStreamControllerTest`
Expected: 컴파일 에러 — `ChatStreamController` 없음.

- [ ] **Step 3: 컨트롤러 구현**

`ChatStreamController.java`:

```java
package com.workplace.chat.controller;

import com.workplace.chat.outbound.ChatSseRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * chat 실시간 SSE 스트림. 유저당 글로벌 스트림 1개로 본인이 멤버인 모든 thread 이벤트를 수신한다.
 *
 * <p>프론트는 native EventSource 가 헤더를 못 싣으므로 fetch + ReadableStream 으로 Authorization 헤더를 실어 호출한다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/chat")
public class ChatStreamController {

  private final ChatSseRegistry registry;

  @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter stream(@AuthenticationPrincipal Long callerId) {
    return registry.register(callerId);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests com.workplace.chat.controller.ChatStreamControllerTest`
Expected: PASS. (만약 `stream_unauthenticated_401` 이 실패하면 `SecurityConfig` 에서 `/api/v1/chat/**` 가 authenticated 인지 확인 — 기존 chat 엔드포인트와 동일 정책이어야 한다.)

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/controller/ChatStreamController.java apps/workplace-api/src/test/java/com/workplace/chat/controller/ChatStreamControllerTest.java
git commit -m "feat(api): GET /chat/stream SSE 구독 엔드포인트 — #37"
```

---

### Task A6: SSE 디스패처 (이벤트 → 멤버 fan-out)

**Files:**
- Create: `src/main/java/com/workplace/chat/outbound/ChatSseDispatcher.java`
- Test: `src/test/java/com/workplace/chat/outbound/ChatSseDispatcherTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`ChatSseDispatcherTest.java` (`ChatEventDispatcherTest` 의 unit 스타일):

```java
package com.workplace.chat.outbound;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class ChatSseDispatcherTest {

  private ChatSseRegistry registry;
  private ChatThreadMemberRepository memberRepo;
  private ChatSseDispatcher dispatcher;

  private static final UserSummary HUMAN = new UserSummary(1L, "alice", "Alice", "HUMAN");

  @BeforeEach
  void setUp() {
    registry = Mockito.mock(ChatSseRegistry.class);
    memberRepo = Mockito.mock(ChatThreadMemberRepository.class);
    dispatcher = new ChatSseDispatcher(registry, memberRepo);
    when(memberRepo.findMemberIds(5L)).thenReturn(List.of(1L, 2L));
  }

  @Test
  void created_fansOutToAllMembers() {
    dispatcher.onCreated(
        new ChatMessageCreatedEvent(
            5L, 10L, 100L, "WP", "WP-1", HUMAN, "hi", List.of(), Instant.now()));
    verify(registry).fanOut(eq(List.of(1L, 2L)), eq("chat.message.created"), any());
  }

  @Test
  void deleted_fansOutToAllMembers() {
    dispatcher.onDeleted(new ChatMessageDeletedEvent(5L, 10L));
    verify(registry).fanOut(eq(List.of(1L, 2L)), eq("chat.message.deleted"), any());
  }

  @Test
  void typing_fansOutToAllMembers() {
    dispatcher.onTyping(new ChatThreadTypingEvent(5L, HUMAN));
    verify(registry).fanOut(eq(List.of(1L, 2L)), eq("chat.thread.typing"), any());
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests com.workplace.chat.outbound.ChatSseDispatcherTest`
Expected: 컴파일 에러 — `ChatSseDispatcher` 없음.

- [ ] **Step 3: 디스패처 구현**

`ChatSseDispatcher.java`:

```java
package com.workplace.chat.outbound;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadReadEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.dto.UserSummary;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * chat 도메인 이벤트를 thread 전 멤버에게 SSE fan-out 한다.
 *
 * <p>기존 {@link ChatEventDispatcher}(AGENT 멘션 시에만 ai-agent 발사)와 완전히 분리 — 본 디스패처는 멘션 필터를 거치지 않고
 * 모든 메시지/이벤트를 thread 전 멤버에게 보낸다. self-echo 는 허용(발신자 본인 포함) — 멀티기기 동기화 + 프론트가 messageId 로
 * optimistic dedup, read/typing 은 본인 userId 로 무시.
 *
 * <p>DB 를 바꾸는 이벤트(created/updated/deleted/read)는 AFTER_COMMIT 으로 커밋된 데이터만 push 하고, transient 한
 * typing 은 트랜잭션이 없으므로 일반 @EventListener 로 받는다.
 */
@Component
@RequiredArgsConstructor
public class ChatSseDispatcher {

  private final ChatSseRegistry registry;
  private final ChatThreadMemberRepository memberRepo;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(ChatMessageCreatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    p.put("authorId", e.actor().id());
    p.put("authorName", e.actor().name());
    p.put("authorKind", e.actor().kind());
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::mention).toList());
    p.put("createdAt", e.occurredAt().toString());
    p.put("editedAt", null);
    p.put("deleted", false);
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.message.created", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onUpdated(ChatMessageUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::mention).toList());
    p.put("editedAt", e.editedAt() == null ? null : e.editedAt().toString());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.message.updated", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onDeleted(ChatMessageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.message.deleted", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onRead(ChatThreadReadEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("userId", e.userId());
    p.put("lastReadMessageId", e.lastReadMessageId());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.thread.read", p);
  }

  @EventListener
  public void onTyping(ChatThreadTypingEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("userId", e.actor().id());
    p.put("name", e.actor().name());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.thread.typing", p);
  }

  private Map<String, Object> mention(UserSummary u) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", u.id());
    m.put("username", u.username());
    m.put("name", u.name());
    m.put("kind", u.kind());
    return m;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests com.workplace.chat.outbound.ChatSseDispatcherTest`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/outbound/ChatSseDispatcher.java apps/workplace-api/src/test/java/com/workplace/chat/outbound/ChatSseDispatcherTest.java
git commit -m "feat(api): chat 이벤트 SSE fan-out 디스패처 — #37"
```

---

### Task A7: 타이핑 엔드포인트

**Files:**
- Modify: `src/main/java/com/workplace/chat/controller/ChatMessageController.java`
- Test: `src/test/java/com/workplace/chat/controller/ChatMessageControllerTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`ChatMessageControllerTest.java` 에 추가:

```java
  @Test
  void typing_204() throws Exception {
    mockMvc
        .perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(
                    "/api/v1/chat/threads/1/typing")
                .header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    org.mockito.Mockito.verify(messageService).notifyTyping(1L, 1L);
  }
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./gradlew test --tests com.workplace.chat.controller.ChatMessageControllerTest`
Expected: 404 또는 컴파일 에러 — typing 핸들러 없음.

- [ ] **Step 3: 핸들러 구현**

`ChatMessageController.java` 의 마지막 핸들러 아래(클래스 닫기 전)에 추가:

```java
  /** 타이핑 알림 — DB 변경 없이 thread 멤버에게 SSE typing 이벤트 발행. */
  @PostMapping("/threads/{id}/typing")
  public ResponseEntity<Void> typing(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long threadId) {
    messageService.notifyTyping(callerId, threadId);
    return ResponseEntity.noContent().build();
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests com.workplace.chat.controller.ChatMessageControllerTest`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/controller/ChatMessageController.java apps/workplace-api/src/test/java/com/workplace/chat/controller/ChatMessageControllerTest.java
git commit -m "feat(api): POST /chat/threads/{id}/typing 엔드포인트 — #37"
```

---

### Task A8: 통합 테스트 — 메시지 작성 → SSE fan-out

**Files:**
- Test: `src/test/java/com/workplace/chat/integration/ChatSseFanOutTest.java`

end-to-end 로 메시지 작성/AGENT 멘션 시 SSE 디스패처가 멤버에게 fan-out 하고, 기존 ai-agent 발사와 공존함을 검증한다. `ChatToAiAgentDispatchTest` 패턴 복제, `ChatSseRegistry` 를 MockitoBean 으로 가로챈다.

- [ ] **Step 1: 통합 테스트 작성**

```java
package com.workplace.chat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.outbound.ChatSseRegistry;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.support.IntegrationTestBase;
import java.util.Collection;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** chat 메시지 작성 → SSE fan-out 통합. registry 를 mock 으로 가로채 멤버 fan-out 을 검증. */
class ChatSseFanOutTest extends IntegrationTestBase {

  @MockitoBean ChatSseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient; // ai-agent 실제 호출 차단
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;
  @Autowired ChatFixtures fx;

  @Test
  void messageCreate_fansOutToThreadMembers() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    messageService.create(
        s.reporterId(), thread.threadId(), new CreateChatMessageRequest("hello"));

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    verify(registry, timeout(2000))
        .fanOut(ids.capture(), eq("chat.message.created"), any());
    assertThat(ids.getValue()).contains(s.reporterId());
  }
}
```

- [ ] **Step 2: 테스트 실행 (실패 또는 통과 확인)**

Run: `./gradlew test --tests com.workplace.chat.integration.ChatSseFanOutTest`
Expected: PASS (A1–A7 구현 후이므로 통과해야 함). 실패 시 디스패처가 AFTER_COMMIT 에서 동작하는지(트랜잭션 경계) 확인.

- [ ] **Step 3: 전체 chat 백엔드 테스트**

Run: `./gradlew test --tests "com.workplace.chat.*"`
Expected: 전부 PASS (기존 ai-agent 발사 테스트 포함 — SSE 추가가 기존 동작을 깨지 않음).

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-api/src/test/java/com/workplace/chat/integration/ChatSseFanOutTest.java
git commit -m "test(api): chat 메시지 작성 SSE fan-out 통합 테스트 — #37"
```

---

# Part B — 프론트 (workplace-web)

작업 디렉터리: `apps/workplace-web`. 타입체크 `pnpm typecheck`, E2E `pnpm test:e2e -- <spec>` (기존 스크립트 확인).

### Task B1: 타이핑 API 클라이언트

**Files:**
- Modify: `src/api/chat.ts`

- [ ] **Step 1: 메서드 추가**

`chat.ts` 의 `markRead` 아래에 추가:

```typescript
  // 타이핑 알림 — DB 변경 없음, 204. thread 멤버에게 SSE typing 이벤트 fan-out 트리거.
  sendTyping: (threadId: number) =>
    client.post<void>(`/chat/threads/${threadId}/typing`),
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/api/chat.ts
git commit -m "feat(web): chat sendTyping API 클라이언트 — #37"
```

---

### Task B2: 글로벌 SSE 구독 훅

**Files:**
- Create: `src/hooks/useChatStream.ts`

react-query 캐시를 직접 갱신한다. 메시지 캐시 키는 `chatKeys.messages(threadId)`(InfiniteData<ChatMessagePage>), thread 캐시 키는 `chatKeys.thread(projectKey, issueNumber)` 이지만 SSE 는 threadId 만 알므로 read/typing 은 thread 캐시를 직접 못 찾는다 → read 는 messages 캐시와 무관하게 별도 처리하지 않고, **typing 은 모듈 스코프 이벤트 버스**로 컴포넌트에 전달한다(Task B4 에서 소비). 메시지 created/updated/deleted 는 threadId 로 messages 캐시를 직접 갱신.

- [ ] **Step 1: 훅 구현**

`useChatStream.ts`:

```typescript
// chat 글로벌 SSE 구독 훅 — 유저당 스트림 1개로 본인이 멤버인 모든 thread 이벤트 수신.
// firehub useNotificationStream 패턴 재사용: fetch + ReadableStream 으로 Authorization 헤더 전송
// (native EventSource 는 커스텀 헤더 미지원).
// 메시지 created/updated/deleted 는 react-query messages 캐시를 threadId 로 직접 갱신.
// typing 은 모듈 이벤트 버스(chatTypingBus)로 컴포넌트에 전달.

import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAccessToken } from '../api/client';
import type { ChatMessagePage, ChatMessageResponse } from '../types/chat';
import { chatKeys } from './queries/chatKeys';

// 타이핑 이벤트 버스 — SSE 훅(앱 1곳)에서 발행, IssueChatSection 에서 구독.
export interface ChatTypingEvent {
  threadId: number;
  userId: number;
  name: string;
}
type TypingListener = (e: ChatTypingEvent) => void;
const typingListeners = new Set<TypingListener>();
export function onChatTyping(listener: TypingListener): () => void {
  typingListeners.add(listener);
  return () => typingListeners.delete(listener);
}
function emitTyping(e: ChatTypingEvent) {
  typingListeners.forEach((l) => l(e));
}

// messages 캐시 첫 페이지에 메시지 prepend (없으면 무시 — 열려있지 않은 thread).
function upsertMessage(qc: QueryClient, threadId: number, msg: ChatMessageResponse) {
  const key = chatKeys.messages(threadId);
  qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
    if (!old) return old; // 해당 thread 미오픈 → 열 때 refetch 로 정합
    // 이미 존재(내 optimistic 의 서버 echo 또는 중복 수신)하면 교체, 아니면 prepend.
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

function patchMessage(
  qc: QueryClient,
  threadId: number,
  id: number,
  patch: Partial<ChatMessageResponse>,
) {
  const key = chatKeys.messages(threadId);
  qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        items: p.items.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    };
  });
}

function handleEvent(qc: QueryClient, eventName: string, data: unknown) {
  const d = data as Record<string, unknown>;
  const threadId = Number(d.threadId);
  if (!threadId) return;
  switch (eventName) {
    case 'chat.message.created':
      upsertMessage(qc, threadId, data as ChatMessageResponse);
      break;
    case 'chat.message.updated':
      patchMessage(qc, threadId, Number(d.id), {
        body: String(d.body),
        mentions: (d.mentions ?? []) as ChatMessageResponse['mentions'],
        editedAt: (d.editedAt as string | null) ?? null,
      });
      break;
    case 'chat.message.deleted':
      patchMessage(qc, threadId, Number(d.id), { deleted: true });
      break;
    case 'chat.thread.typing':
      emitTyping({ threadId, userId: Number(d.userId), name: String(d.name) });
      break;
    // chat.thread.read 는 현재 UI 에 읽음 표시가 없어 캐시 갱신 생략 (열 때 thread refetch 로 정합).
  }
}

export function useChatStream() {
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
        const response = await fetch('/api/v1/chat/stream', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          credentials: 'include',
        });
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

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/hooks/useChatStream.ts
git commit -m "feat(web): chat 글로벌 SSE 구독 훅 (메시지 캐시 갱신 + typing 버스) — #37"
```

---

### Task B3: 앱 셸에 스트림 마운트

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: 훅 호출 추가**

`AppLayout.tsx` import 에 추가:

```typescript
import { useChatStream } from '../../hooks/useChatStream'
```

`export function AppLayout() {` 본문 최상단(`const { resolvedTheme ... }` 위)에 추가:

```typescript
  // 인증된 앱 셸에서 chat 실시간 SSE 를 1회 구독 (유저당 글로벌 스트림).
  useChatStream()
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/components/layout/AppLayout.tsx
git commit -m "feat(web): AppLayout 에서 chat SSE 스트림 구독 — #37"
```

---

### Task B4: 폴링 제거 + 타이핑 송신/표시

**Files:**
- Modify: `src/hooks/queries/useChatMessages.ts`
- Modify: `src/pages/projects/components/chat/IssueChatSection.tsx`

- [ ] **Step 1: 폴링 제거**

`useChatMessages.ts` 에서 `pollingEnabled` 의존을 제거한다. `UseChatMessagesOptions` 에서 `pollingEnabled` 필드 삭제, `refetchInterval`/주석을 다음으로 교체:

```typescript
    // 실시간 갱신은 SSE(useChatStream)가 담당 → 폴링 제거. 재연결 catch-up 은 staleTime 만료 후 refetch.
    staleTime: 5_000,
    refetchOnWindowFocus: false,
```

(즉 `refetchInterval`, `refetchIntervalInBackground` 줄 삭제. `pollingEnabled` 파라미터 삭제.)

- [ ] **Step 2: IssueChatSection 갱신 — pollingEnabled 제거 + 타이핑**

`IssueChatSection.tsx`:

1) import 추가:

```typescript
import { chatApi } from '../../../../api/chat';
import { onChatTyping } from '../../../../hooks/useChatStream';
```

2) `useChatMessages` 호출에서 `pollingEnabled` 제거(여전히 viewport/visible 게이팅은 mark-read 용으로 남길 수 있으나 폴링용이 아니므로 단순화):

```typescript
  const messagesQ = useChatMessages({
    threadId: threadQ.data?.threadId,
    initialFirstPage,
  });
```

3) 타이핑 표시 상태 + 구독. `const [editingId, ...]` 선언 근처에 추가:

```typescript
  // 다른 멤버의 타이핑 표시 (SSE typing 버스 구독, 4초 TTL). 본인 이벤트는 무시.
  const [typingNames, setTypingNames] = useState<Map<number, { name: string; at: number }>>(
    new Map(),
  );
  useEffect(() => {
    const unsub = onChatTyping((e) => {
      if (e.threadId !== threadId || e.userId === (me?.id ?? 0)) return;
      setTypingNames((prev) => {
        const next = new Map(prev);
        next.set(e.userId, { name: e.name, at: Date.now() });
        return next;
      });
    });
    const ttl = setInterval(() => {
      setTypingNames((prev) => {
        const now = Date.now();
        const next = new Map([...prev].filter(([, v]) => now - v.at < 4000));
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => {
      unsub();
      clearInterval(ttl);
    };
  }, [threadId, me?.id]);
```

4) 타이핑 송신 — composer 입력 시 throttle. `onSubmit` 가까이에 throttle 송신 핸들러 추가:

```typescript
  // 입력 중 3초 throttle 로 typing 송신.
  const lastTypingRef = useRef(0);
  const handleTyping = () => {
    const now = Date.now();
    if (threadId > 0 && now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      chatApi.sendTyping(threadId).catch(() => {});
    }
  };
```

5) `ChatComposer` 에 타이핑 콜백 전달 + 타이핑 표시 렌더. `<ChatComposer ... onSubmit={...} />` 를 다음으로 교체:

```tsx
        {typingNames.size > 0 && (
          <div className="px-4 pb-1 text-xs text-muted-foreground" data-testid="chat-typing">
            {[...typingNames.values()].map((v) => v.name).join(', ')} 입력 중…
          </div>
        )}
        <ChatComposer
          members={thread.members}
          onSubmit={(body) => createMutation.mutate({ body })}
          onTyping={handleTyping}
        />
```

> `ChatComposer` 가 `onTyping` prop 을 받지 않으면 다음 Step 에서 추가한다.

- [ ] **Step 3: ChatComposer 에 onTyping prop 추가**

`src/pages/projects/components/chat/ChatComposer.tsx` 를 열어 props 인터페이스에 `onTyping?: () => void;` 추가하고, 입력 onChange/onUpdate 핸들러에서 `onTyping?.()` 를 호출한다(입력 콜백 위치는 `ChatRichInput` 의 onChange). 예:

```tsx
// props 타입에 추가
  onTyping?: () => void;
```
```tsx
// 입력 변경 콜백 안에서 호출 (기존 onChange 핸들러 본문에 한 줄 추가)
    onTyping?.();
```

- [ ] **Step 4: 타입체크 + lint**

Run: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web lint`
Expected: 에러 없음. (`useChatMessages` 호출처가 더 있으면 `pollingEnabled` 제거에 따라 모두 수정.)

- [ ] **Step 5: 기존 chat E2E 회귀 확인**

Run: `pnpm --filter workplace-web test:e2e -- chat.spec`
Expected: 기존 chat.spec.ts PASS (폴링 제거가 happy path 를 깨지 않음). 실패 시 폴링에 의존하던 단언을 SSE 흐름에 맞게 조정.

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useChatMessages.ts apps/workplace-web/src/pages/projects/components/chat/IssueChatSection.tsx apps/workplace-web/src/pages/projects/components/chat/ChatComposer.tsx
git commit -m "feat(web): chat 폴링 제거 + SSE 기반 실시간 + 타이핑 표시 — #37"
```

---

### Task B5: SSE E2E

**Files:**
- Create: `e2e/pages/projects/chat-realtime.spec.ts`

기존 `chat.spec.ts` 의 mock 스타일을 따른다. `/api/v1/chat/stream` 을 canned SSE 본문으로 fulfill 해 "SSE 로 들어온 메시지가 POST 없이 렌더되는지" 와 "타이핑 표시" 를 검증한다.

- [ ] **Step 1: E2E 작성**

```typescript
// Phase 6b — chat 실시간 SSE E2E.
// /chat/stream 을 canned text/event-stream 본문으로 모킹 → 메시지가 POST 없이 렌더되는지 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChatMessage, createChatThread } from '../../factories/chat.factory';
import { createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;

test('SSE 로 도착한 메시지가 폴링 없이 즉시 렌더된다', async ({ page }) => {
  // 공통 이슈/프로젝트 stub
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueDetail()),
      }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // thread + 초기 메시지(빈)
  await page.route(
    (u) => u.pathname.endsWith(`/issues/${ISSUE_NUMBER}/chat/thread`),
    (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createChatThread({ threadId: THREAD_ID, recentMessages: [] })),
      }),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
      }),
  );

  // SSE 스트림: created 이벤트 1개를 담은 canned 본문.
  const msg = createChatMessage({ id: 999, threadId: THREAD_ID, body: 'SSE 실시간 메시지' });
  const sseBody =
    `event: chat.message.created\n` +
    `data: ${JSON.stringify({ ...msg, authorId: msg.authorId, authorName: msg.authorName, authorKind: msg.authorKind })}\n\n`;
  await page.route(
    (u) => u.pathname === '/api/v1/chat/stream',
    (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody }),
  );

  await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

  // POST 없이 SSE 로 들어온 메시지가 보인다.
  await expect(page.getByText('SSE 실시간 메시지')).toBeVisible();
});
```

> `createChatMessage` 가 `authorId/authorName/authorKind` 를 이미 포함하면 spread 단순화 가능. `createIssueDetail` 시그니처는 기존 `issue.factory` 에 맞춘다.

- [ ] **Step 2: E2E 실행**

Run: `pnpm --filter workplace-web test:e2e -- chat-realtime`
Expected: PASS. 실패 시 SSE 본문 라인 종결(`\n\n`)과 `event:`/`data:` 필드 형식을 훅 파서와 대조.

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/e2e/pages/projects/chat-realtime.spec.ts
git commit -m "test(web): chat SSE 실시간 렌더 E2E — #37"
```

---

## 최종 검증

- [ ] **백엔드 전체 테스트**: `cd apps/workplace-api && ./gradlew test` → 전부 PASS
- [ ] **프론트 타입/lint/E2E**: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web lint && pnpm --filter workplace-web test:e2e` → 전부 PASS
- [ ] **수동 확인**(선택): `pnpm db:up && pnpm dev` 후 두 브라우저로 같은 이슈 chat 열기 → 한쪽 작성 → 다른 쪽 폴링 없이 즉시 수신, 타이핑 표시. (스크린샷: `test-results/exploratory/chat-realtime/<timestamp>/`)
- [ ] **이슈 #37 완료 기준 재확인**: 즉시 수신 / 재연결 catch-up(현재 thread) / 서버 재시작 후 자동 재연결.

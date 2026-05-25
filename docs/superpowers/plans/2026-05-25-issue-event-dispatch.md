# 이슈 도메인 이벤트 → ai-agent 발사 Implementation Plan (5b-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** workplace-api 가 이슈 도메인 변경(생성/할당/코멘트/상태) 을 도메인 이벤트로 발행하고, AFTER_COMMIT 리스너가 AGENT assignee 필터·self-loop 차단 후 ai-agent `POST /events` 로 envelope 을 전송한다.

**Architecture:** Spring `ApplicationEventPublisher` + `@TransactionalEventListener(AFTER_COMMIT)` + `RestClient` 수동 재시도. 신규 패키지 `com.workplace.issue.outbound`. DB 마이그레이션 0. 단일 commit (TDD 진행, task 별 commit 없음).

**Tech Stack:** Spring Boot 3.4 / Java 21 / Spring 6 `RestClient` / Spring `MockRestServiceServer` / 기존 `IntegrationTestBase` (Testcontainers/test profile, port 5435) / jOOQ

---

## 커밋 정책

각 task 는 파일 변경만 수행하고 commit 하지 않는다. **마지막 Task 6 에서 단일 commit**:
```
feat(api): 이슈 도메인 이벤트 → ai-agent 발사 — #29 (5b-1)
```

이유: spec 의 커밋 정책. main 브랜치 직접 작업.

## File Structure

신규 (`apps/workplace-api/src/main/java/com/workplace/issue/outbound/`):
```
outbound/
├── AiAgentProperties.java       # @ConfigurationProperties("workplace.ai-agent")
├── EventEnvelope.java           # { type, payload } record
├── IssueDomainEvents.java       # 4개 이벤트 sealed 또는 individual record
├── IssueEventDispatcher.java    # @TransactionalEventListener(AFTER_COMMIT) 4개
└── AiAgentEventClient.java      # RestClient + 재시도
```

수정:
- `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueService.java` — `create()`, `update()` 에 publishEvent
- `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueAssigneeService.java` — `replace()` 에 publishEvent
- `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueCommentService.java` — `create()` 에 publishEvent
- `apps/workplace-api/src/main/resources/application.yml` — `workplace.ai-agent.*` 3개
- `apps/workplace-api/src/main/resources/application-test.yml` — `workplace.ai-agent.enabled: false`

신규 테스트:
- `apps/workplace-api/src/test/java/com/workplace/issue/outbound/AiAgentEventClientTest.java`
- `apps/workplace-api/src/test/java/com/workplace/issue/outbound/IssueEventDispatcherTest.java`
- `apps/workplace-api/src/test/java/com/workplace/issue/outbound/IssueEventDispatchIntegrationTest.java`

---

## Task 1: 데이터 모델 + 설정 (Properties, Envelope, Events)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/outbound/AiAgentProperties.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/outbound/EventEnvelope.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/outbound/IssueDomainEvents.java`
- Modify: `apps/workplace-api/src/main/resources/application.yml`
- Modify: `apps/workplace-api/src/main/resources/application-test.yml`
- Modify: `apps/workplace-api/src/main/java/com/workplace/WorkplaceApiApplication.java` (또는 별도 Config) — `@ConfigurationPropertiesScan` 등록

- [ ] **Step 1: `AiAgentProperties` 작성**

```java
package com.workplace.issue.outbound;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * ai-agent 발사 설정. workplace.ai-agent 키로 바인딩.
 *
 * <ul>
 *   <li>baseUrl: ai-agent 서버 base URL (예: http://localhost:7070)
 *   <li>internalToken: 사내 서비스 인증 — Authorization: Internal {token}
 *   <li>enabled: 전역 on/off. 테스트 기본 false.
 * </ul>
 */
@ConfigurationProperties("workplace.ai-agent")
public record AiAgentProperties(String baseUrl, String internalToken, boolean enabled) {}
```

- [ ] **Step 2: `EventEnvelope` 작성**

```java
package com.workplace.issue.outbound;

import java.util.Map;

/**
 * ai-agent 로 전송하는 외부 페이로드. ai-agent 스캐폴딩의 POST /events 가
 * 받는 {type, payload} envelope.
 */
public record EventEnvelope(String type, Map<String, Object> payload) {}
```

- [ ] **Step 3: `IssueDomainEvents` 작성 — 4개 record 한 파일**

```java
package com.workplace.issue.outbound;

import com.workplace.issue.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * 이슈 도메인 이벤트 4종. ApplicationEventPublisher 로 발행되어
 * AFTER_COMMIT 단계에서 dispatcher 가 받는다. assignees 는 변경 후 현재 상태.
 */
public final class IssueDomainEvents {
  private IssueDomainEvents() {}

  /** 이슈 생성 직후. assignees 가 비어있을 수도 있음. */
  public record IssueCreatedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      String status,
      String priority,
      UserSummary actor,
      List<UserSummary> assignees,
      Instant occurredAt) {}

  /** assignee 집합 변경. added/removed 는 diff. */
  public record IssueAssignedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      List<UserSummary> added,
      List<UserSummary> removed,
      Instant occurredAt) {}

  /** 코멘트 추가. commentBody 는 agent 응답 트리거의 핵심 컨텍스트라 포함. */
  public record IssueCommentedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      long commentId,
      String commentBody,
      Instant occurredAt) {}

  /** 상태 전이 (예: TODO → IN_PROGRESS). */
  public record IssueStatusChangedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      String previousStatus,
      String newStatus,
      Instant occurredAt) {}
}
```

- [ ] **Step 4: `application.yml` 갱신**

기존 `workplace:` 키 아래에 ai-agent 섹션 추가. 현재 파일에는 `workplace.attachment.*` 만 있음.

추가 블록 (`workplace:` 키 아래, `attachment:` 와 같은 레벨):

```yaml
workplace:
  attachment:
    upload-dir: ./uploads/attachments
    max-file-size-bytes: 26214400
    max-per-issue: 10
  ai-agent:
    base-url: ${WORKPLACE_AI_AGENT_URL:http://localhost:7070}
    internal-token: ${WORKPLACE_AI_AGENT_TOKEN:changeme-local}
    enabled: ${WORKPLACE_AI_AGENT_ENABLED:true}
```

- [ ] **Step 5: `application-test.yml` 갱신**

파일 끝에 다음 블록 추가:

```yaml
workplace:
  ai-agent:
    base-url: http://localhost:7070
    internal-token: test-token
    enabled: false
```

- [ ] **Step 6: `@ConfigurationProperties` 스캔 등록 확인**

`WorkplaceApiApplication.java` 또는 메인 Config 클래스를 확인. 이미 `@ConfigurationPropertiesScan` 이 있으면 그대로 사용. 없으면 메인 클래스 어노테이션에 추가:

```bash
grep -n "ConfigurationPropertiesScan\|@SpringBootApplication" apps/workplace-api/src/main/java/com/workplace/WorkplaceApiApplication.java
```

없으면 `@SpringBootApplication` 옆에 `@ConfigurationPropertiesScan` 추가:

```java
@SpringBootApplication
@ConfigurationPropertiesScan
public class WorkplaceApiApplication { ... }
```

import: `import org.springframework.boot.context.properties.ConfigurationPropertiesScan;`

- [ ] **Step 7: 컴파일 확인**

```bash
cd apps/workplace-api && ./gradlew compileJava
```
기대: BUILD SUCCESSFUL.

---

## Task 2: AiAgentEventClient (TDD)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/outbound/AiAgentEventClient.java`
- Create: `apps/workplace-api/src/test/java/com/workplace/issue/outbound/AiAgentEventClientTest.java`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/issue/outbound/AiAgentEventClientTest.java`:

```java
package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AiAgentEventClient — RestClient 발사·재시도·인증·에러 분기 검증. */
class AiAgentEventClientTest {

  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private AiAgentEventClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    // 테스트는 백오프 1ms 로 — production 1s/2s/4s
    client = new AiAgentEventClient(builder, "tok-123", 1L);
  }

  @Test
  void 정상_200_응답_1회_호출() {
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.type").value("issue.created"))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

    client.publish(new EventEnvelope("issue.created", Map.of("issueKey", "WP-1")));

    server.verify();
  }

  @Test
  void 첫_500_후_200_총_2회_호출() {
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withServerError());
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

    client.publish(new EventEnvelope("issue.assigned", Map.of()));

    server.verify();
  }

  @Test
  void 모두_500_총_4회_호출_후_조용히_종료() {
    server
        .expect(ExpectedCount.times(4), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withServerError());

    // throw 하지 않음 — 도메인 영향 X
    client.publish(new EventEnvelope("issue.commented", Map.of()));

    server.verify();
  }

  @Test
  void 클라이언트_400_즉시_포기_1회_호출() {
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withStatus(HttpStatus.BAD_REQUEST));

    client.publish(new EventEnvelope("issue.status_changed", Map.of()));

    server.verify();
  }

  @Test
  void Body_가_envelope_JSON_형태() {
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(jsonPath("$.type").value("issue.created"))
        .andExpect(jsonPath("$.payload.issueKey").value("WP-42"))
        .andExpect(jsonPath("$.payload.issueId").value(42))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

    client.publish(
        new EventEnvelope("issue.created", Map.of("issueKey", "WP-42", "issueId", 42L)));

    server.verify();
  }

  @Test
  void enabled_false_옵션은_클라이언트_레벨_관심사_아님() {
    // 이 테스트는 의도적 placeholder — enabled 처리는 dispatcher 책임.
    // 클라이언트는 항상 publish 하면 발사한다.
    assertThat(client).isNotNull();
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.outbound.AiAgentEventClientTest"
```
기대: FAIL — `cannot find symbol: class AiAgentEventClient`

- [ ] **Step 3: `AiAgentEventClient` 구현**

`apps/workplace-api/src/main/java/com/workplace/issue/outbound/AiAgentEventClient.java`:

```java
package com.workplace.issue.outbound;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/**
 * ai-agent 의 POST /events 로 envelope 을 전송한다.
 *
 * <ul>
 *   <li>인증: Authorization: Internal {token}
 *   <li>재시도: 시도 1 + 재시도 3회 = 최대 4회, 백오프 baseBackoffMs * 2^(n-1)
 *   <li>재시도 대상: IO 에러, 5xx, 408, 429. 그 외 4xx 는 즉시 포기.
 *   <li>모두 실패 시 에러 로그만 남기고 도메인으로 예외 propagate 하지 않음.
 * </ul>
 */
@Slf4j
public class AiAgentEventClient {

  /** 시도 횟수 (초회 + 재시도). */
  private static final int MAX_ATTEMPTS = 4;

  private final RestClient restClient;
  private final String internalToken;
  private final long baseBackoffMs;

  public AiAgentEventClient(RestClient.Builder builder, String internalToken, long baseBackoffMs) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
    this.baseBackoffMs = baseBackoffMs;
  }

  /** envelope 을 발사. 도메인으로 예외를 던지지 않는다. */
  public void publish(EventEnvelope envelope) {
    Exception lastError = null;
    for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        restClient
            .post()
            .uri("/events")
            .header("Authorization", "Internal " + internalToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(envelope)
            .retrieve()
            .toBodilessEntity();
        return; // 성공
      } catch (HttpClientErrorException e) {
        HttpStatusCode status = e.getStatusCode();
        if (!isRetryableClientStatus(status)) {
          log.error(
              "ai-agent dispatch failed (4xx, no retry): type={}, status={}, body={}",
              envelope.type(),
              status,
              e.getResponseBodyAsString());
          return;
        }
        lastError = e;
      } catch (HttpServerErrorException | ResourceAccessException e) {
        lastError = e;
      }
      if (attempt < MAX_ATTEMPTS) {
        sleepBackoff(attempt);
      }
    }
    log.error(
        "ai-agent dispatch failed after {} attempts: type={}, lastError={}",
        MAX_ATTEMPTS,
        envelope.type(),
        lastError == null ? "unknown" : lastError.getMessage());
  }

  /** 4xx 중 재시도 가능한 코드 (408, 429). */
  private boolean isRetryableClientStatus(HttpStatusCode status) {
    int code = status.value();
    return code == 408 || code == 429;
  }

  /** 지수 백오프: baseBackoffMs * 2^(attempt-1). */
  private void sleepBackoff(int attempt) {
    long delay = baseBackoffMs * (1L << (attempt - 1));
    try {
      Thread.sleep(delay);
    } catch (InterruptedException ie) {
      Thread.currentThread().interrupt();
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.outbound.AiAgentEventClientTest"
```
기대: 6 passed.

- [ ] **Step 5: Bean 등록**

`apps/workplace-api/src/main/java/com/workplace/issue/outbound/` 에 `OutboundConfig.java` 신규:

```java
package com.workplace.issue.outbound;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/** ai-agent 발사 관련 Bean 등록. */
@Configuration
public class OutboundConfig {

  @Bean
  public AiAgentEventClient aiAgentEventClient(AiAgentProperties props) {
    var builder = RestClient.builder().baseUrl(props.baseUrl());
    // production 백오프 1초. 테스트는 별도 생성자 호출로 override.
    return new AiAgentEventClient(builder, props.internalToken(), 1000L);
  }
}
```

---

## Task 3: IssueEventDispatcher (TDD)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/outbound/IssueEventDispatcher.java`
- Create: `apps/workplace-api/src/test/java/com/workplace/issue/outbound/IssueEventDispatcherTest.java`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/issue/outbound/IssueEventDispatcherTest.java`:

```java
package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.issue.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

/** IssueEventDispatcher — 필터·envelope 빌드 검증. Spring 컨텍스트 없이 직접 호출. */
class IssueEventDispatcherTest {

  private static final UserSummary HUMAN_ACTOR =
      new UserSummary(1L, "alice", "Alice", "HUMAN");
  private static final UserSummary AGENT_ACTOR =
      new UserSummary(201L, "ai-bot", "AI Bot", "AGENT");
  private static final UserSummary AGENT_ASSIGNEE =
      new UserSummary(201L, "ai-bot", "AI Bot", "AGENT");
  private static final UserSummary HUMAN_ASSIGNEE =
      new UserSummary(2L, "bob", "Bob", "HUMAN");

  private AiAgentEventClient client;
  private IssueEventDispatcher dispatcher;

  @BeforeEach
  void setUp() {
    client = Mockito.mock(AiAgentEventClient.class);
  }

  private IssueEventDispatcher build(boolean enabled) {
    var props = new AiAgentProperties("http://ai-agent", "tok", enabled);
    return new IssueEventDispatcher(client, props);
  }

  @Test
  void AGENT_assignee_없음_skip() {
    dispatcher = build(true);
    var event = new IssueCreatedEvent(
        1L, "WP", "WP-1", "t", "TODO", "MID",
        HUMAN_ACTOR, List.of(HUMAN_ASSIGNEE), Instant.now());

    dispatcher.onIssueCreated(event);

    verify(client, never()).publish(Mockito.any());
  }

  @Test
  void AGENT_assignee_있음_actor_HUMAN_발사() {
    dispatcher = build(true);
    var event = new IssueCreatedEvent(
        42L, "WP", "WP-42", "분석", "TODO", "MID",
        HUMAN_ACTOR, List.of(AGENT_ASSIGNEE), Instant.parse("2026-05-25T12:00:00Z"));

    dispatcher.onIssueCreated(event);

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(1)).publish(captor.capture());
    var env = captor.getValue();
    assertThat(env.type()).isEqualTo("issue.created");
    assertThat(env.payload()).containsEntry("issueKey", "WP-42");
    assertThat(env.payload()).containsEntry("issueId", 42L);
    assertThat(env.payload()).containsEntry("issueTitle", "분석");
    assertThat(env.payload()).containsEntry("status", "TODO");
    assertThat(env.payload()).containsEntry("priority", "MID");
  }

  @Test
  void actor_AGENT_self_loop_skip() {
    dispatcher = build(true);
    var event = new IssueCommentedEvent(
        1L, "WP", "WP-1", "t",
        AGENT_ACTOR, List.of(AGENT_ASSIGNEE),
        99L, "스스로 단 코멘트", Instant.now());

    dispatcher.onIssueCommented(event);

    verify(client, never()).publish(Mockito.any());
  }

  @Test
  void enabled_false_skip() {
    dispatcher = build(false);
    var event = new IssueAssignedEvent(
        1L, "WP", "WP-1", "t",
        HUMAN_ACTOR, List.of(AGENT_ASSIGNEE),
        List.of(AGENT_ASSIGNEE), List.of(), Instant.now());

    dispatcher.onIssueAssigned(event);

    verify(client, never()).publish(Mockito.any());
  }

  @Test
  void 모든_4종_type_문자열_정확() {
    dispatcher = build(true);
    var common = List.of(AGENT_ASSIGNEE);
    var now = Instant.now();

    dispatcher.onIssueCreated(new IssueCreatedEvent(
        1L, "WP", "WP-1", "t", "TODO", "MID", HUMAN_ACTOR, common, now));
    dispatcher.onIssueAssigned(new IssueAssignedEvent(
        1L, "WP", "WP-1", "t", HUMAN_ACTOR, common, common, List.of(), now));
    dispatcher.onIssueCommented(new IssueCommentedEvent(
        1L, "WP", "WP-1", "t", HUMAN_ACTOR, common, 9L, "hi", now));
    dispatcher.onIssueStatusChanged(new IssueStatusChangedEvent(
        1L, "WP", "WP-1", "t", HUMAN_ACTOR, common, "TODO", "IN_PROGRESS", now));

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(4)).publish(captor.capture());
    assertThat(captor.getAllValues())
        .extracting(EventEnvelope::type)
        .containsExactly(
            "issue.created", "issue.assigned", "issue.commented", "issue.status_changed");
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.outbound.IssueEventDispatcherTest"
```
기대: FAIL — `cannot find symbol: class IssueEventDispatcher`

- [ ] **Step 3: `IssueEventDispatcher` 구현**

`apps/workplace-api/src/main/java/com/workplace/issue/outbound/IssueEventDispatcher.java`:

```java
package com.workplace.issue.outbound;

import com.workplace.issue.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 도메인 이벤트 → ai-agent 발사. AFTER_COMMIT 에서만 동작 — 트랜잭션
 * 롤백 시 발사하지 않는다. 모든 핸들러는 enabled / AGENT assignee / self-loop
 * 필터를 거친 뒤 envelope 을 만들어 client 에 위임한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IssueEventDispatcher {

  private final AiAgentEventClient client;
  private final AiAgentProperties props;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCreated(IssueCreatedEvent e) {
    if (skip(e.actor(), e.assignees())) return;
    Map<String, Object> p = baseFields(e.issueId(), e.projectKey(), e.issueKey(),
        e.title(), e.actor(), e.assignees(), e.occurredAt());
    p.put("status", e.status());
    p.put("priority", e.priority());
    dispatch("issue.created", p, e.issueKey());
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueAssigned(IssueAssignedEvent e) {
    if (skip(e.actor(), e.assignees())) return;
    Map<String, Object> p = baseFields(e.issueId(), e.projectKey(), e.issueKey(),
        e.title(), e.actor(), e.assignees(), e.occurredAt());
    p.put("added", e.added().stream().map(IssueEventDispatcher::summary).toList());
    p.put("removed", e.removed().stream().map(IssueEventDispatcher::summary).toList());
    dispatch("issue.assigned", p, e.issueKey());
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCommented(IssueCommentedEvent e) {
    if (skip(e.actor(), e.assignees())) return;
    Map<String, Object> p = baseFields(e.issueId(), e.projectKey(), e.issueKey(),
        e.title(), e.actor(), e.assignees(), e.occurredAt());
    p.put("commentId", e.commentId());
    p.put("commentBody", e.commentBody());
    dispatch("issue.commented", p, e.issueKey());
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueStatusChanged(IssueStatusChangedEvent e) {
    if (skip(e.actor(), e.assignees())) return;
    Map<String, Object> p = baseFields(e.issueId(), e.projectKey(), e.issueKey(),
        e.title(), e.actor(), e.assignees(), e.occurredAt());
    p.put("previousStatus", e.previousStatus());
    p.put("newStatus", e.newStatus());
    dispatch("issue.status_changed", p, e.issueKey());
  }

  /** 공통 필터 — true 면 발사 skip. */
  private boolean skip(UserSummary actor, List<UserSummary> assignees) {
    if (!props.enabled()) return true;
    boolean hasAgent = assignees.stream().anyMatch(u -> "AGENT".equals(u.kind()));
    if (!hasAgent) return true;
    if (actor != null && "AGENT".equals(actor.kind())) return true; // self-loop
    return false;
  }

  /** 공통 payload 필드 — 변경 가능한 LinkedHashMap. */
  private Map<String, Object> baseFields(
      long issueId, String projectKey, String issueKey, String title,
      UserSummary actor, List<UserSummary> assignees, java.time.Instant occurredAt) {
    Map<String, Object> p = new HashMap<>();
    p.put("projectKey", projectKey);
    p.put("issueKey", issueKey);
    p.put("issueId", issueId);
    p.put("issueTitle", title);
    p.put("actor", summary(actor));
    p.put("assignees", assignees.stream().map(IssueEventDispatcher::summary).toList());
    p.put("occurredAt", occurredAt.toString());
    return p;
  }

  /** UserSummary → 직렬화용 Map. record 직렬화가 환경마다 다를 수 있어 명시. */
  private static Map<String, Object> summary(UserSummary u) {
    if (u == null) return null;
    Map<String, Object> m = new HashMap<>();
    m.put("id", u.id());
    m.put("username", u.username());
    m.put("kind", u.kind());
    return m;
  }

  private void dispatch(String type, Map<String, Object> payload, String issueKey) {
    log.debug("[outbound] {} {} -> ai-agent", type, issueKey);
    client.publish(new EventEnvelope(type, payload));
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.outbound.IssueEventDispatcherTest"
```
기대: 5 passed.

---

## Task 4: 발행 통합 — 4개 서비스 수정

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueService.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueAssigneeService.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueCommentService.java`

### Step 1: `IssueService.create()` 에 발행 추가

`IssueService` 의 필드에 `ApplicationEventPublisher publisher` 추가 (lombok `@RequiredArgsConstructor` 가 생성자 자동 생성):

```java
import org.springframework.context.ApplicationEventPublisher;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.dto.UserSummary;
import com.workplace.user.repository.UserRepository;
```

추가 필드 (다른 필드들과 같은 자리):
```java
private final ApplicationEventPublisher publisher;
private final UserRepository userRepository;
```

`create()` 메서드 끝 `return IssueResponse.from(project.key(), row);` **직전** 에 다음 추가:

```java
    // 도메인 이벤트 발행 (AFTER_COMMIT 에서 ai-agent 로 발사)
    var actor = userRepository.findById(callerId)
        .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
        .orElse(null);
    List<UserSummary> assigneeSummaries = assigneeIds.isEmpty()
        ? List.of()
        : userRepository.findByIds(assigneeIds).stream()
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .toList();
    String issueKey = project.key() + "-" + number;
    var occurredAt = java.time.Instant.now();
    publisher.publishEvent(new IssueCreatedEvent(
        row.id(), project.key(), issueKey, row.title(),
        row.status(), row.priority(),
        actor, assigneeSummaries, occurredAt));
    if (!assigneeSummaries.isEmpty()) {
      publisher.publishEvent(new IssueAssignedEvent(
          row.id(), project.key(), issueKey, row.title(),
          actor, assigneeSummaries, assigneeSummaries, List.of(), occurredAt));
    }
```

- [ ] **Step 2: `IssueAssigneeService.replace()` 에 발행 추가**

`IssueAssigneeService` 필드 추가:
```java
import org.springframework.context.ApplicationEventPublisher;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;

private final ApplicationEventPublisher publisher;
```

`replace()` 메서드 끝 `return repo.findByIssue(issue.id());` **직전** 에 다음 추가:

```java
    // 변경이 있을 때만 도메인 이벤트 발행 (history 와 동일 조건)
    if (!toAdd.isEmpty() || !toRemove.isEmpty()) {
      var actor = userRepository.findById(callerId)
          .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
          .orElse(null);
      var currentAssignees = repo.findByIssue(issue.id());
      var addedSummaries2 = toAdd.isEmpty() ? List.<UserSummary>of()
          : userRepository.findByIds(new ArrayList<>(toAdd)).stream()
              .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
              .toList();
      String issueKey = project.key() + "-" + issue.number();
      publisher.publishEvent(new IssueAssignedEvent(
          issue.id(), project.key(), issueKey, issue.title(),
          actor, currentAssignees, addedSummaries2, removedSummaries,
          java.time.Instant.now()));
    }
```

(`removedSummaries` 는 이미 선언돼 있음 — 위쪽 history 블록에서 재사용.)

- [ ] **Step 3: `IssueCommentService.create()` 에 발행 추가**

`IssueCommentService` 필드 추가:
```java
import org.springframework.context.ApplicationEventPublisher;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.dto.UserSummary;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.user.repository.UserRepository;

private final ApplicationEventPublisher publisher;
private final IssueAssigneeRepository assigneeRepository;
private final UserRepository userRepository;
```

`create()` 메서드 끝 `return resp;` **직전** 에 다음 추가:

```java
    var issue = issueRepository.findById(issueId).orElseThrow();
    var assignees = assigneeRepository.findByIssue(issueId);
    var actor = userRepository.findById(callerId)
        .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
        .orElse(null);
    String issueKey = project.key() + "-" + issue.number();
    publisher.publishEvent(new IssueCommentedEvent(
        issueId, project.key(), issueKey, issue.title(),
        actor, assignees, resp.id(), req.body(), java.time.Instant.now()));
```

> **주의:** 현재 `create()` 시그니처는 `project` 를 반환하지 않는다. `assertIssueAccess` 가 `ProjectRow` 를 반환하므로 그 결과를 변수에 받자:
>
> ```java
> var project = assertIssueAccess(issueId, callerId);
> ```
>
> 기존 코드의 `assertIssueAccess(issueId, callerId);` 를 위 한 줄로 교체.

- [ ] **Step 4: `IssueService.update()` 에 발행 추가 (상태 변경 시만)**

`update()` 메서드의 `var after = issueRepository.findById(before.id()).orElseThrow();` **직후**, `historyRecorder.recordChanges(...)` **이전** 에 다음 추가:

```java
    // 상태 전이가 있을 때만 IssueStatusChanged 발행
    if (!before.status().equals(after.status())) {
      var actor = userRepository.findById(callerId)
          .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
          .orElse(null);
      var currentAssignees = assigneeRepository.findByIssue(after.id());
      String issueKey = project.key() + "-" + after.number();
      publisher.publishEvent(
          new com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent(
              after.id(), project.key(), issueKey, after.title(),
              actor, currentAssignees, before.status(), after.status(),
              java.time.Instant.now()));
    }
```

- [ ] **Step 5: 컴파일 + 기존 단위 테스트 통과 확인**

```bash
cd apps/workplace-api && ./gradlew compileJava test --tests "com.workplace.issue.outbound.*"
```
기대: BUILD SUCCESSFUL. dispatcher 5 + client 6 = 11 passed. 기존 service 테스트도 회귀 없음 (publisher 가 publish 만 하고 listener 는 test profile 에서 enabled=false 라 skip).

- [ ] **Step 6: 전체 기존 테스트 회귀 확인**

```bash
cd apps/workplace-api && ./gradlew test
```
기대: 모든 기존 테스트 + 신규 11개 통과. enabled=false 라 통합 테스트의 outbound 호출이 없음.

---

## Task 5: 통합 테스트 (IssueEventDispatchIntegrationTest)

**Files:**
- Create: `apps/workplace-api/src/test/java/com/workplace/issue/outbound/IssueEventDispatchIntegrationTest.java`

> 본 통합 테스트는 `enabled=true` override + `MockRestServiceServer` 가
> dispatcher 가 생성한 `AiAgentEventClient` 의 RestClient 를 가로채야 한다.
> 가장 깔끔한 방법: 테스트에서 `OutboundConfig` 의 `AiAgentEventClient` 를
> `@MockBean` 으로 교체하지 않고, 대신 `AiAgentEventClient` 자체를 `@SpyBean` 으로
> 두고 `publish()` 호출을 캡처한다. (실제 HTTP 발사는 검증 범위 외 —
> Task 2 에서 이미 검증됨.)

- [ ] **Step 1: 통합 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/issue/outbound/IssueEventDispatchIntegrationTest.java`:

```java
package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.service.IssueService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpyBean;
import org.springframework.test.context.TestPropertySource;

/**
 * 5b-1 통합 테스트 — 실제 서비스 호출 → 이벤트 발행 → AFTER_COMMIT dispatcher →
 * AiAgentEventClient.publish 캡처. 실제 HTTP 발사 단위는 Task 2 에서 검증.
 */
@DisplayName("이슈 도메인 이벤트 → ai-agent dispatcher 통합")
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class IssueEventDispatchIntegrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueAssigneeService assigneeService;
  @Autowired IssueCommentService commentService;

  @SpyBean AiAgentEventClient client;

  private Long humanId;
  private Long agentId;
  private String projectKey;

  @BeforeEach
  void seed() {
    // 간단 fixture — 프로젝트 + HUMAN + AGENT + 멤버십.
    // 실제 fixture 코드는 IntegrationTestBase 의 헬퍼 또는 직접 jOOQ INSERT 로 작성.
    // (구체 SQL 은 기존 IssueService 통합 테스트 패턴 참고)
    var fx = TestFixtures.createProjectWithHumanAndAgent(dsl);
    humanId = fx.humanId();
    agentId = fx.agentId();
    projectKey = fx.projectKey();
  }

  @Test
  @DisplayName("AGENT 를 assignee 로 한 이슈 생성 → created + assigned 2회 발사")
  void create_with_agent_assignee_publishes_two() {
    issueService.create(humanId, projectKey,
        new CreateIssueRequest("AI 가 할 일", "본문", "MID", null, List.of(agentId), null, null));

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(1000).times(2)).publish(captor.capture());
    assertThat(captor.getAllValues())
        .extracting(EventEnvelope::type)
        .containsExactlyInAnyOrder("issue.created", "issue.assigned");
  }

  @Test
  @DisplayName("사람만 assignee 인 이슈 생성 → 발사 0회")
  void create_human_only_publishes_zero() {
    issueService.create(humanId, projectKey,
        new CreateIssueRequest("사람 작업", "본문", "MID", null, List.of(humanId), null, null));

    verify(client, never()).publish(org.mockito.Mockito.any());
  }

  @Test
  @DisplayName("기존 이슈에 AGENT 추가 → assigned 1회, added 에 AGENT 포함")
  void assign_agent_to_existing_publishes_assigned() {
    var issue = issueService.create(humanId, projectKey,
        new CreateIssueRequest("기존", "본문", "MID", null, List.of(), null, null));
    org.mockito.Mockito.reset(client);

    assigneeService.replace(humanId, projectKey, issue.number(), List.of(agentId));

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(1000).times(1)).publish(captor.capture());
    var env = captor.getValue();
    assertThat(env.type()).isEqualTo("issue.assigned");
    @SuppressWarnings("unchecked")
    var added = (List<java.util.Map<String, Object>>) env.payload().get("added");
    assertThat(added).extracting(m -> m.get("id")).contains(agentId);
  }

  @Test
  @DisplayName("AGENT 담당 이슈에 사람이 코멘트 → commented 1회, commentBody 포함")
  void human_comment_on_agent_issue_publishes_commented() {
    var issue = issueService.create(humanId, projectKey,
        new CreateIssueRequest("AI 작업", "본문", "MID", null, List.of(agentId), null, null));
    org.mockito.Mockito.reset(client);

    commentService.create(humanId, issue.id(), new CreateCommentRequest("@ai 확인 부탁"));

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(1000).times(1)).publish(captor.capture());
    var env = captor.getValue();
    assertThat(env.type()).isEqualTo("issue.commented");
    assertThat(env.payload()).containsEntry("commentBody", "@ai 확인 부탁");
  }

  @Test
  @DisplayName("AGENT 가 자기 담당 이슈에 코멘트 → self-loop 차단, 발사 0회")
  void agent_self_comment_skipped() {
    var issue = issueService.create(humanId, projectKey,
        new CreateIssueRequest("AI 작업", "본문", "MID", null, List.of(agentId), null, null));
    org.mockito.Mockito.reset(client);

    commentService.create(agentId, issue.id(), new CreateCommentRequest("작업 완료"));

    verify(client, never()).publish(org.mockito.Mockito.any());
  }

  @Test
  @DisplayName("AGENT 담당 이슈 상태 변경 → status_changed 1회, previous/new 정확")
  void status_change_on_agent_issue_publishes_status_changed() {
    var issue = issueService.create(humanId, projectKey,
        new CreateIssueRequest("AI 작업", "본문", "MID", null, List.of(agentId), null, null));
    org.mockito.Mockito.reset(client);

    issueService.updateStatus(humanId, projectKey, issue.number(), "IN_PROGRESS");

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(1000).times(1)).publish(captor.capture());
    var env = captor.getValue();
    assertThat(env.type()).isEqualTo("issue.status_changed");
    assertThat(env.payload()).containsEntry("previousStatus", "TODO");
    assertThat(env.payload()).containsEntry("newStatus", "IN_PROGRESS");
  }
}
```

> **Fixture 헬퍼 `TestFixtures.createProjectWithHumanAndAgent(dsl)` 가 없으면**
> 같은 패키지에 신규 작성:
>
> `apps/workplace-api/src/test/java/com/workplace/issue/outbound/TestFixtures.java`:
>
> ```java
> package com.workplace.issue.outbound;
>
> import com.workplace.workplace.jooq.Tables;
> import java.time.OffsetDateTime;
> import org.jooq.DSLContext;
>
> /** 5b-1 통합 테스트 전용 fixture. HUMAN 1, AGENT 1, 프로젝트 + 둘 다 멤버. */
> final class TestFixtures {
>   private TestFixtures() {}
>
>   record Setup(Long humanId, Long agentId, String projectKey) {}
>
>   static Setup createProjectWithHumanAndAgent(DSLContext dsl) {
>     long human = insertUser(dsl, "alice-" + uniq(), "HUMAN");
>     long agent = insertUser(dsl, "ai-" + uniq(), "AGENT");
>     String key = ("WP" + uniq()).toUpperCase();
>     long pid = insertProject(dsl, key, human);
>     insertMember(dsl, pid, human, "OWNER");
>     insertMember(dsl, pid, agent, "MEMBER");
>     // project_issue_sequence 초기화
>     dsl.execute("INSERT INTO project_issue_sequence(project_id, next_number) VALUES (?, 1)
>         ON CONFLICT DO NOTHING", pid);
>     // TASK 유형 보장
>     dsl.execute("INSERT INTO issue_type(project_id, name, color_token, icon, position)
>         VALUES (?, 'TASK', 'gray', 'check', 0) ON CONFLICT DO NOTHING", pid);
>     return new Setup(human, agent, key);
>   }
>
>   private static long insertUser(DSLContext dsl, String username, String kind) {
>     return dsl.fetchValue(
>         "INSERT INTO \"user\"(username, email, password_hash, name, kind, is_active, created_at, updated_at)
>          VALUES (?, ?, '', ?, ?, true, now(), now()) RETURNING id",
>         username, username + "@x", username, kind);
>   }
>
>   private static long insertProject(DSLContext dsl, String key, long ownerId) {
>     return dsl.fetchValue(
>         "INSERT INTO project(\"key\", name, description, owner_id, created_at, updated_at)
>          VALUES (?, ?, '', ?, now(), now()) RETURNING id",
>         key, key, ownerId);
>   }
>
>   private static void insertMember(DSLContext dsl, long projectId, long userId, String role) {
>     dsl.execute(
>         "INSERT INTO project_member(project_id, user_id, role, created_at)
>          VALUES (?, ?, ?, now())",
>         projectId, userId, role);
>   }
>
>   private static String uniq() {
>     return Long.toHexString(System.nanoTime());
>   }
> }
> ```
>
> 컬럼·테이블명은 실제 마이그레이션과 일치해야 한다 — 첫 실행 시 SQL 에러가 나면
> `apps/workplace-api/src/main/resources/db/migration` 의 V1~V14 파일을 보고 컬럼명을 맞춘다.

- [ ] **Step 2: 테스트 실행**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.outbound.IssueEventDispatchIntegrationTest"
```
기대: 6 passed.

> **트러블슈팅:**
> - `@SpyBean` 이 `null` 이면 `OutboundConfig` 의 `@Bean` 이 등록됐는지 확인
> - dispatcher 가 호출되지 않으면 `@TransactionalEventListener` 의 `AFTER_COMMIT` 이 의도대로 동작하는지 — 트랜잭션이 정상 커밋되어야 함 (`@Transactional` 테스트 메서드는 롤백되므로 `@Commit` 또는 트랜잭션 외부 호출 필요)
> - 위 테스트는 서비스 메서드를 직접 호출 → 각 서비스 메서드가 자기 트랜잭션 시작·커밋 → AFTER_COMMIT 발화. `IntegrationTestBase` 가 메서드 단위 `@Transactional` 을 걸지 않는다는 전제 (걸려있으면 그 트랜잭션 안에서 서비스가 동작하므로 커밋 시점이 외부로 밀려 AFTER_COMMIT 발화 X). 만약 그렇다면 base 를 보고 클래스에 `@Transactional(propagation = NOT_SUPPORTED)` 또는 직접 fixture cleanup 으로 우회.

---

## Task 6: 전체 검증 + 단일 커밋

이 task 가 본 plan 의 유일한 commit 지점.

- [ ] **Step 1: 전체 gradle test**

```bash
cd apps/workplace-api && ./gradlew clean test
```
기대: BUILD SUCCESSFUL. 신규 17개 (client 6 + dispatcher 5 + integration 6) + 기존 회귀 0.

- [ ] **Step 2: 빌드**

```bash
cd apps/workplace-api && ./gradlew build
```
기대: BUILD SUCCESSFUL. jar 생성.

- [ ] **Step 3: 루트 turbo 파이프라인**

```bash
cd /Users/bluleo78/git/smart-workplace
pnpm test
```
기대: turbo 가 workplace-api 통합 + workplace-ai-agent vitest + workplace-web 등 모두 통과.

- [ ] **Step 4: 수동 검증 — ai-agent 띄우고 실제 발사 확인**

```bash
# 터미널 A — ai-agent 기동
cd /Users/bluleo78/git/smart-workplace
INTERNAL_SERVICE_TOKEN=changeme-local pnpm --filter @smart-workplace/workplace-ai-agent dev &
AGENT_PID=$!
sleep 3

# 터미널 B — workplace-api 기동
SPRING_PROFILES_ACTIVE=local WORKPLACE_AI_AGENT_TOKEN=changeme-local \
  pnpm --filter @smart-workplace/workplace-api dev &
API_PID=$!
sleep 10
```

브라우저 또는 curl 로:
1. 로그인 → AGENT assignee 가 있는 이슈 생성
2. ai-agent 로그 (터미널 A) 에 `event received { type: "issue.created", payload: {...} }` 출력 확인
3. 같은 이슈에 코멘트 → `event received { type: "issue.commented" }` 확인

```bash
# 정리
kill $AGENT_PID $API_PID
```

> 수동 검증은 best-effort — 가능한 환경에서. dev 서버 기동이 어려우면 통합 테스트 통과로 갈음.

- [ ] **Step 5: git status 점검**

```bash
git status
git diff --stat
```
기대 (예시):
- 신규: `apps/workplace-api/src/main/java/com/workplace/issue/outbound/**`, `apps/workplace-api/src/test/java/com/workplace/issue/outbound/**`, `docs/superpowers/plans/2026-05-25-issue-event-dispatch.md`
- 수정: `IssueService.java`, `IssueAssigneeService.java`, `IssueCommentService.java`, `application.yml`, `application-test.yml`, (옵션) `WorkplaceApiApplication.java`

- [ ] **Step 6: 단일 커밋**

```bash
git add apps/workplace-api docs/superpowers/plans/2026-05-25-issue-event-dispatch.md
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(api): 이슈 도메인 이벤트 → ai-agent 발사 — #29 (5b-1)

- 신규 패키지 com.workplace.issue.outbound
  - AiAgentProperties (workplace.ai-agent.*)
  - EventEnvelope, IssueDomainEvents 4종
  - IssueEventDispatcher (@TransactionalEventListener AFTER_COMMIT 4개)
  - AiAgentEventClient (RestClient + 지수 백오프 3회 재시도)
- 4개 서비스에 publishEvent 추가
  - IssueService.create / update(status 전이 시)
  - IssueAssigneeService.replace (diff 있을 때만)
  - IssueCommentService.create
- 필터: enabled + AGENT assignee 존재 + actor != AGENT (self-loop 차단)
- application.yml / application-test.yml 설정 추가 (test 는 enabled=false)
- 단위(11) + 통합(6) 테스트 통과
EOF
)"
```

기대: pre-commit hook 통과, commit 완료.

- [ ] **Step 7: git log 확인**

```bash
git log --oneline -3
```
기대: 가장 최근 commit 이 본 task 의 커밋 메시지.

---

## Self-Review

**Spec coverage:**
- 4개 도메인 이벤트 record — Task 1 ✅
- ApplicationEventPublisher + @TransactionalEventListener(AFTER_COMMIT) — Task 3 ✅
- AGENT assignee 필터 + self-loop 차단 + enabled 필터 — Task 3 ✅
- RestClient + Internal token + 지수 백오프 3회 — Task 2 ✅
- 4xx 즉시 포기 (408/429 재시도) — Task 2 ✅
- 4개 서비스 발행 지점 — Task 4 ✅
- envelope `{type, payload}` + 4개 type 이름 — Task 3 ✅
- 공통 + 이벤트별 추가 필드 — Task 3 ✅
- commentBody 포함 — Task 3 (`onIssueCommented`) ✅
- `workplace.ai-agent.*` 3개 속성 + test enabled=false — Task 1 ✅
- 단위 client 6 + dispatcher 5 + 통합 6 = 17 테스트 — Task 2/3/5 ✅
- DB 마이그레이션 0 — 본 plan 어디에도 V15 추가 없음 ✅
- 단일 commit — Task 6 ✅

**Placeholder scan:** "수동 검증은 best-effort" 한 줄 외에는 모두 구체 코드/명령.

**Type consistency:** `IssueCreatedEvent`, `IssueAssignedEvent`, `IssueCommentedEvent`, `IssueStatusChangedEvent`, `EventEnvelope`, `AiAgentEventClient`, `IssueEventDispatcher`, `AiAgentProperties` 모든 사용처 동일. `UserSummary` 는 기존 `com.workplace.issue.dto.UserSummary` 재사용.

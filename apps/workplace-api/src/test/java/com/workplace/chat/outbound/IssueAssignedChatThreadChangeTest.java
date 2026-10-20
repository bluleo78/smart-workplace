package com.workplace.chat.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mockingDetails;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.ResourceChangedCapture;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** 담당자 변경(추가·제거) → 이슈 챗 chat-thread resource.changed 발행 통합 — 열린 챗의 작성창 안내가 타인 변경에도 갱신되도록. */
@DisplayName("담당자 변경 → chat-thread resource.changed 통합")
class IssueAssignedChatThreadChangeTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient;

  @Autowired IssueAssigneeService assigneeService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;

  /**
   * 담당자 변경 커밋 뒤 비동기로 도는 실행기 — 알림 insert(→ user FK 잠금)와 ai-agent 발사. 정리가 이 작업보다 먼저 user 를 지우면 교착이
   * 나므로, 스파이로 이번 테스트의 제출 수를 세어 그만큼 끝날 때까지 기다린 뒤 정리한다.
   */
  @MockitoSpyBean(name = "notifyEventExecutor")
  Executor notifyExecutor;

  @MockitoSpyBean(name = "aiAgentEventExecutor")
  Executor aiAgentExecutor;

  private ChatFixtures.AgentSetup s;
  private long notifyBaseline;
  private long aiAgentBaseline;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    notifyBaseline = pool(notifyExecutor).getCompletedTaskCount();
    aiAgentBaseline = pool(aiAgentExecutor).getCompletedTaskCount();
    s = fx.setupWithAgent();
    // 스레드가 있어야 알림이 나간다.
    threadService.getOrCreate(s.base().reporterId(), s.base().projectKey(), s.base().issueNumber());
  }

  @AfterEach
  void cleanup() {
    try {
      awaitSubmittedDone(notifyExecutor, notifyBaseline);
      awaitSubmittedDone(aiAgentExecutor, aiAgentBaseline);
    } finally {
      fx.cleanupAll();
      TenantContext.clear();
    }
  }

  /**
   * 스파이가 기록한 제출(@Async 는 submit) 수만큼 완료 수가 늘 때까지 기다린다 — 제출 수를 스파이에서 세므로, 막 생성된 워커의 첫 작업이 큐·활성 수에
   * 잡히지 않는 틈과 무관하다(결정적).
   */
  private static void awaitSubmittedDone(Executor executor, long baseline) {
    long submitted =
        mockingDetails(executor).getInvocations().stream()
            .filter(i -> Set.of("execute", "submit").contains(i.getMethod().getName()))
            .count();
    var pool = pool(executor);
    await()
        .atMost(Duration.ofSeconds(10))
        .until(() -> pool.getCompletedTaskCount() - baseline >= submitted);
  }

  /** 빈은 Executor 로 선언돼 있지만 실체(와 그 스파이)는 ThreadPoolTaskExecutor 다. */
  private static ThreadPoolExecutor pool(Executor executor) {
    return ((ThreadPoolTaskExecutor) executor).getThreadPoolExecutor();
  }

  private void assertChatThreadReceived() {
    var c =
        ResourceChangedCapture.capture(
            registry, p -> "chat-thread".equals(p.get("resource")), "chat-thread");
    assertThat(c.payload())
        .containsEntry("projectKey", s.base().projectKey())
        .containsEntry("issueNumber", s.base().issueNumber());
    assertThat(c.recipients()).contains(s.base().reporterId(), s.base().watcherId());
  }

  @Test
  @DisplayName("담당자 추가는 프로젝트 멤버에게 chat-thread 변경을 알린다")
  void assigneeAdd_publishesChatThreadChange() {
    clearInvocations(registry);
    var b = s.base();
    assigneeService.replace(
        b.reporterId(), b.projectKey(), b.issueNumber(), List.of(b.assigneeId(), s.agentId()));
    assertChatThreadReceived();
  }

  @Test
  @DisplayName("담당자 제거도 chat-thread 변경을 알린다")
  void assigneeRemove_publishesChatThreadChange() {
    var b = s.base();
    assigneeService.replace(
        b.reporterId(), b.projectKey(), b.issueNumber(), List.of(b.assigneeId(), s.agentId()));
    clearInvocations(registry);
    assigneeService.replace(
        b.reporterId(), b.projectKey(), b.issueNumber(), List.of(b.assigneeId()));
    assertChatThreadReceived();
  }
}

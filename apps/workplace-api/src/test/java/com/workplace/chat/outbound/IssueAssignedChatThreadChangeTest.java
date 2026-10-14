package com.workplace.chat.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.ResourceChangedCapture;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 담당자 변경(추가·제거) → 이슈 챗 chat-thread resource.changed 발행 통합 — 열린 챗의 작성창 안내가 타인 변경에도 갱신되도록. */
@DisplayName("담당자 변경 → chat-thread resource.changed 통합")
class IssueAssignedChatThreadChangeTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient;

  @Autowired IssueAssigneeService assigneeService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;

  private ChatFixtures.AgentSetup s;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    s = fx.setupWithAgent();
    // 스레드가 있어야 알림이 나간다.
    threadService.getOrCreate(s.base().reporterId(), s.base().projectKey(), s.base().issueNumber());
  }

  @AfterEach
  void cleanup() {
    fx.cleanupAll();
    TenantContext.clear();
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

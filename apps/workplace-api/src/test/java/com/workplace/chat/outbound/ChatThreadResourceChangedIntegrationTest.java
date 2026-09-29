package com.workplace.chat.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMembershipService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.ResourceChangedCapture;
import java.util.Collection;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** WP-64 통합 — 이슈 채팅 멤버 추가·나가기 → 프로젝트 멤버(+나간 본인)에게 resource.changed (커밋 필요). */
@DisplayName("이슈 채팅 멤버 변경 → resource.changed 통합")
class ChatThreadResourceChangedIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient;

  @Autowired ChatMembershipService membershipService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;

  private ChatFixtures.Setup s;
  private long threadId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    s = fx.setup();
    threadId =
        threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber()).threadId();
  }

  @AfterEach
  void cleanup() {
    fx.cleanupAll();
    TenantContext.clear();
  }

  private Collection<Long> captureChatThread() {
    var c =
        ResourceChangedCapture.capture(
            registry, p -> "chat-thread".equals(p.get("resource")), "chat-thread");
    assertThat(c.payload())
        .containsEntry("projectKey", s.projectKey())
        .containsEntry("issueNumber", s.issueNumber());
    return c.recipients();
  }

  @Test
  @DisplayName("멤버 추가는 프로젝트 멤버 전원에게, 비멤버 제외")
  void chatAdd_reachesProjectMembers() {
    clearInvocations(registry);
    membershipService.add(s.reporterId(), threadId, s.watcherId());
    assertThat(captureChatThread())
        .contains(s.reporterId(), s.assigneeId(), s.watcherId())
        .doesNotContain(s.outsiderId());
  }

  @Test
  @DisplayName("나가기는 나간 본인도 받는다")
  void chatLeave_includesLeaver() {
    clearInvocations(registry);
    membershipService.leave(s.assigneeId(), threadId);
    assertThat(captureChatThread()).contains(s.reporterId(), s.assigneeId());
  }
}

package com.workplace.notify.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import java.util.Collection;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** WP-64 통합 — 알림 읽음 → 수신자 본인에게만 resource.changed. 읽을 것이 0건이면 발행하지 않는다(커밋 필요). */
@DisplayName("알림 읽음 → resource.changed 통합")
class NotificationReadResourceChangedIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;

  @Autowired NotificationService service;
  @Autowired ChatFixtures fx;

  private ChatFixtures.Setup s;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    s = fx.setup();
  }

  @AfterEach
  void cleanup() {
    fx.cleanupAll();
    TenantContext.clear();
  }

  @Test
  @DisplayName("안읽은 알림이 있으면 수신자에게만 발행")
  void markAllRead_reachesRecipientOnly_whenChanged() {
    service.createAndFanOut(
        NotificationType.ASSIGNED, List.of(s.assigneeId()), s.reporterId(), s.issueId(), null);
    clearInvocations(registry);

    assertThat(service.markAllRead(s.assigneeId())).isPositive();

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    verify(registry, timeout(2000)).fanOut(ids.capture(), eq("resource.changed"), any());
    assertThat(ids.getValue()).containsExactly(s.assigneeId());
  }

  @Test
  @DisplayName("읽을 것이 0건이면 발행하지 않는다")
  void markAllRead_noop_whenNothingToRead() {
    clearInvocations(registry);
    assertThat(service.markAllRead(s.assigneeId())).isZero();
    verify(registry, after(500).never()).fanOut(any(), eq("resource.changed"), any());
  }
}

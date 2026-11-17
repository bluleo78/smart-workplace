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
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.Collection;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-1689 통합 — 읽은 알림 보관·되돌리기 → 읽음과 같은 resource.changed 를 수신자 본인에게만 보낸다(다른 탭·기기의 알림 창이 바로 줄거나 늘게).
 * 바뀐 것이 없으면 보내지 않는다. 커밋이 있어야 발행되므로 트랜잭션 롤백 없이 서비스를 직접 부른다.
 */
@DisplayName("알림 보관·되돌리기 → resource.changed 통합")
class NotificationArchiveResourceChangedIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired SseRegistry registry;

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

  /** 수신자에게 resource.changed 가 한 번 갔고 그 대상이 수신자 본인뿐인지. */
  private void verifyReachedRecipientOnly() {
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    verify(registry, timeout(2000)).fanOut(ids.capture(), eq("resource.changed"), any());
    assertThat(ids.getValue()).containsExactly(s.assigneeId());
  }

  @Test
  @DisplayName("모두 읽음 → 읽은 알림 보관 → 되돌리기: 목록이 비었다 돌아오고, 매번 수신자에게만 발행")
  void archiveRead_then_unarchive_reachRecipientOnly() {
    service.createAndFanOut(
        NotificationType.ASSIGNED, List.of(s.assigneeId()), s.reporterId(), s.issueId(), null);
    service.markAllRead(s.assigneeId());
    clearInvocations(registry);

    List<Long> archived = service.archiveRead(s.assigneeId());

    assertThat(archived).hasSize(1);
    assertThat(service.listRecent(s.assigneeId(), 20, 0)).isEmpty();
    assertThat(service.countUnread(s.assigneeId())).isZero();
    verifyReachedRecipientOnly();

    clearInvocations(registry);
    assertThat(service.unarchive(s.assigneeId(), archived)).isEqualTo(archived);
    assertThat(service.listRecent(s.assigneeId(), 20, 0)).hasSize(1);
    verifyReachedRecipientOnly();
  }

  @Test
  @DisplayName("보관할 것·되돌릴 것이 없으면 발행하지 않는다")
  void noop_whenNothingChanged() {
    service.createAndFanOut(
        NotificationType.ASSIGNED, List.of(s.assigneeId()), s.reporterId(), s.issueId(), null);
    long unreadId = service.listRecent(s.assigneeId(), 20, 0).get(0).id();
    clearInvocations(registry);

    // 안 읽은 알림뿐이라 보관할 것이 없다. 보관 안 된 id 를 되돌려도 바뀌는 것이 없다.
    assertThat(service.archiveRead(s.assigneeId())).isEmpty();
    assertThat(service.unarchive(s.assigneeId(), List.of(unreadId))).isEmpty();
    verify(registry, after(500).never()).fanOut(any(), eq("resource.changed"), any());
  }
}

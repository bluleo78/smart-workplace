package com.workplace.notify;

import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 「메일을 보내지 못함」 알림의 SSE 시점(WP-1786 코드 리뷰) — 이 알림은 동기 리스너가 대기열 상태 전환 트랜잭션 안에서 만든다. SSE {@code
 * notify.created} 는 커밋 뒤에만 나가야 한다(커밋 전에 보내면 웹이 아직 보이지 않는 알림을 다시 읽어 놓치고, 롤백되면 없는 알림을 알린다). SSE 는 목
 * {@link SseRegistry} 로 본다. 커밋을 확인해야 해 테스트 트랜잭션 없이 돌고 시드는 {@link #cleanup} 에서 지운다.
 */
class MailSendFailedFanOutAfterCommitTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired SseRegistry registry;
  @Autowired PlatformTransactionManager txManager;

  private long user;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    user = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, user, 1L);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(NOTIFICATION).where(NOTIFICATION.RECIPIENT_ID.eq(user)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(user)).execute();
        });
    TenantContext.clear();
  }

  @Test
  void 트랜잭션_안에서는_보내지_않고_커밋_뒤에_notify_created_를_한_번_보낸다() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              service.createMailSendFailedAndFanOut(user, 4242L, "분기 보고", false);
              // 아직 커밋 전 — 웹에 알리지 않는다.
              verify(registry, never()).fanOut(any(), eq("notify.created"), any());
            });

    verify(registry, times(1)).fanOut(eq(List.of(user)), eq("notify.created"), any());
  }

  @Test
  void 롤백되면_notify_created_를_보내지_않는다() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              service.createMailSendFailedAndFanOut(user, 4242L, "분기 보고", true);
              status.setRollbackOnly();
            });

    verify(registry, never()).fanOut(any(), eq("notify.created"), any());
  }
}

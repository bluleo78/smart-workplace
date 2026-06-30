package com.workplace.calendar;

import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.calendar.service.CalendarSyncService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.MailDomainEvents.MailAccountConnectedEvent;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정 연결 직후 캘린더 즉시 동기화 production 경로 통합 (#556).
 *
 * <p>MailAccountConnectedEvent 가 커밋되면 AFTER_COMMIT 리스너({@code CalendarAccountSyncDispatcher})
 * → @Async 로 {@code CalendarSyncService.sync} 가 1회 호출되는지 검증한다. 10분 주기 {@code
 * CalendarAutoSyncScheduler}(initialDelay 90s)를 기다리지 않고도 연결 직후 캘린더 동기화가 시작되는지 확인하는 회귀 가드.
 *
 * <p>이 클래스는 @Transactional 을 붙이지 않는다 — 외부 트랜잭션 안에서는 AFTER_COMMIT 이 발화하지 않는다(#476/#514 교훈). {@link
 * CalendarSyncService} 는 mock 으로 두어 실제 Graph 호출 없이 디스패처 배선만 결정적으로 검증한다. 동일 이벤트를 받는 메일 디스패처의 노이즈를 막기
 * 위해 {@link MailSyncService} 도 mock 으로 둔다.
 */
@DisplayName("계정 연결 직후 → 커밋 → AFTER_COMMIT → 캘린더 즉시 동기화 (#556)")
class CalendarImmediateSyncOnConnectTest extends IntegrationTestBase {

  /** SUT 협력자 — 호출 여부만 검증(실제 Graph 동기화 미수행). */
  @MockitoBean CalendarSyncService calendarSyncService;

  /** 동일 연결 이벤트를 받는 메일 즉시 동기화 디스패처가 실제 IMAP/Graph 를 건드리지 않도록 차단. */
  @MockitoBean MailSyncService mailSyncService;

  @Autowired ApplicationEventPublisher events;
  @Autowired PlatformTransactionManager txManager;

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("연결 이벤트 커밋 직후 스케줄러 없이 캘린더 sync 가 즉시 호출된다")
  void connect_triggersImmediateCalendarSync() {
    long userId = 1L;
    long accountId = 999_001L; // 스케줄러가 다룰 실제 계정과 겹치지 않는 합성 id → exact-arg verify 안전

    // production 경로: 이벤트 발행 → 트랜잭션 커밋 → AFTER_COMMIT → @Async 캘린더 sync.
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> events.publishEvent(new MailAccountConnectedEvent(userId, accountId)));

    // 스케줄러(initialDelay 90s)는 이 윈도우에 발화 불가 → 즉시 트리거의 증거.
    verify(calendarSyncService, timeout(10_000)).sync(userId, accountId);
  }
}

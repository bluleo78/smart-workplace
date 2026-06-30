package com.workplace.calendar.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.MailDomainEvents.MailAccountConnectedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 계정 연결 직후 캘린더 즉시 동기화 디스패처 (#556).
 *
 * <p>{@link MailAccountConnectedEvent} 를 AFTER_COMMIT 에서 받아 {@link CalendarSyncService#sync} 를 1회
 * 호출한다. 메일은 {@link com.workplace.mail.outbound.MailAccountSyncDispatcher} 로 이미 연결 즉시 동기화되지만, 캘린더는
 * 트리거가 없어 10분 주기 {@link CalendarAutoSyncScheduler} 틱까지 첫 동기화가 시작조차 안 되던 비대칭을 해소한다. 연결 직후 캘린더 동기화를
 * 즉시 시작하고, 스케줄러는 백스톱(주기 갱신 + 즉시 호출 유실·실패 시 재시도)으로 유지한다.
 *
 * <p>설계 근거(메일 연결-즉시동기화 #514 와 동일 패턴):
 *
 * <ul>
 *   <li><b>AFTER_COMMIT</b> — 신규/전환된 계정 행이 커밋된 뒤에만 sync 가 그 행을 본다. 트랜잭션 내부 @Async 호출은 미커밋 행을 못 봐
 *       레이스가 난다(#476 교훈).
 *   <li><b>@Async("aiAgentEventExecutor")</b> — Graph 네트워크 I/O 를 연결(요청) 스레드와 분리. 메일 즉시 동기화와 동일
 *       executor 라 TenantContextTaskDecorator 가 워커 스레드로 테넌트 컨텍스트를 전파한다.
 *   <li><b>best-effort</b> — 즉시 동기화 실패는 연결 흐름(계정은 이미 저장됨)을 막지 않는다. 로그만 남기면 스케줄러가 다음 사이클에 처리한다.
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CalendarAccountSyncDispatcher {

  private final CalendarSyncService syncService;

  /**
   * 계정 연결 커밋 직후 캘린더 즉시 동기화. TenantContext 는 TenantContextTaskDecorator 가 전파 — 전파 실패(null)면 GUC
   * 미주입으로 RLS fail-closed 되므로 경고 후 skip(스케줄러가 다음 사이클에 처리).
   */
  @Async("aiAgentEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onAccountConnected(MailAccountConnectedEvent e) {
    if (TenantContext.get() == null) {
      log.warn("계정 연결 직후 캘린더 즉시 동기화 skip — TenantContext 없음 accountId={}", e.accountId());
      return;
    }
    try {
      syncService.sync(e.userId(), e.accountId());
    } catch (Exception ex) {
      // 즉시 동기화 실패는 best-effort — 스케줄러가 다음 사이클에 재시도하므로 로그만 남긴다.
      log.warn("계정 연결 직후 캘린더 즉시 동기화 실패 — 스케줄러 다음 사이클에 재시도 accountId={}", e.accountId(), ex);
    }
  }
}

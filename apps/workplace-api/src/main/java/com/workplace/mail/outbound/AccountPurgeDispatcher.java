package com.workplace.mail.outbound;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.MailDomainEvents.MailAccountDisconnectedEvent;
import com.workplace.mail.service.AccountPurgeService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 계정 삭제 직후 즉시 물리 purge 디스패처 (#555).
 *
 * <p>{@link MailAccountDisconnectedEvent} 를 AFTER_COMMIT 에서 받아 {@link
 * AccountPurgeService#purgeAccount} 를 1회 호출한다. 삭제 시점이 5분 주기 {@link
 * com.workplace.mail.service.AccountPurgeScheduler} 사이클의 어디에 걸리든 실제 데이터가 즉시 정리되게 한다(스케줄러는 백스톱으로 유지
 * — 이 즉시 호출이 유실·실패해도 다음 사이클에 재시도).
 *
 * <p>설계 근거({@link MailAccountSyncDispatcher} 와 동일 패턴):
 *
 * <ul>
 *   <li><b>AFTER_COMMIT</b> — soft-delete(disabled_at) 가 커밋된 뒤에만 purge 가 일관된 상태를 본다. 트랜잭션 내부 호출은
 *       미커밋 상태와 레이스가 난다.
 *   <li><b>@Async("aiAgentEventExecutor")</b> — purge 의 DB I/O·디스크 삭제를 요청(삭제 API) 스레드와 분리.
 *       TenantContextTaskDecorator 가 워커 스레드로 테넌트 컨텍스트를 전파한다.
 *   <li><b>best-effort</b> — 즉시 purge 실패는 사용자 흐름(계정은 이미 숨겨짐)을 막지 않는다. 로그만 남기면 스케줄러가 백스톱으로 처리한다.
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountPurgeDispatcher {

  private final AccountPurgeService purgeService;

  /**
   * 계정 삭제 커밋 직후 즉시 purge. TenantContext 는 TenantContextTaskDecorator 가 전파 — 전파 실패(null)면 GUC 미주입으로
   * RLS fail-closed 되므로 경고 후 skip(스케줄러가 다음 사이클에 처리).
   */
  @Async("aiAgentEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onAccountDisconnected(MailAccountDisconnectedEvent e) {
    if (TenantContext.get() == null) {
      log.warn("계정 삭제 직후 즉시 purge skip — TenantContext 없음 accountId={}", e.accountId());
      return;
    }
    try {
      purgeService.purgeAccount(e.userId(), e.accountId());
    } catch (Exception ex) {
      // 즉시 purge 실패는 best-effort — 스케줄러가 백스톱으로 다음 사이클에 재시도하므로 로그만 남긴다.
      log.warn("계정 삭제 직후 즉시 purge 실패 — 스케줄러 다음 사이클에 재시도 accountId={}", e.accountId(), ex);
    }
  }
}

package com.workplace.mail.outbound;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.MailDomainEvents.MailAccountConnectedEvent;
import com.workplace.mail.service.MailSyncService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 메일 계정 연결 직후 즉시 동기화 디스패처 (#514).
 *
 * <p>{@link MailAccountConnectedEvent} 를 AFTER_COMMIT 에서 받아 {@link MailSyncService#sync} 를 1회 호출한다.
 * 계정 추가 시점이 3분 주기 스케줄러 사이클의 어디에 걸리든 첫 메일이 즉시 적재되게 한다(스케줄러는 이후 주기적 동기화를 계속 담당).
 *
 * <p>설계 근거:
 *
 * <ul>
 *   <li><b>AFTER_COMMIT</b> — 신규 계정 행이 커밋된 뒤에만 {@code sync} 의 {@code findByIdAndUser} 가 그 행을 본다.
 *       트랜잭션 내부 @Async 호출은 미커밋 행을 못 봐 레이스가 난다(#476 교훈).
 *   <li><b>@Async("aiAgentEventExecutor")</b> — IMAP/Graph 네트워크 I/O 를 호출(요청) 스레드와 분리. 기존 메일 비동기
 *       백필(분류·요약)과 동일 executor 라 TenantContextTaskDecorator 가 워커 스레드로 테넌트 컨텍스트를 전파한다.
 *   <li><b>best-effort</b> — 즉시 동기화 실패는 사용자 흐름(계정은 이미 저장됨)을 막지 않는다. 로그만 남기고 삼키면 스케줄러가 다음 사이클에
 *       재시도한다.
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailAccountSyncDispatcher {

  private final MailSyncService syncService;

  /**
   * 계정 연결 커밋 직후 즉시 동기화. TenantContext 는 TenantContextTaskDecorator 가 전파 — 전파 실패(null)면 GUC 미주입으로
   * RLS fail-closed 되므로 경고 후 skip(스케줄러가 다음 사이클에 처리).
   */
  @Async("aiAgentEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onAccountConnected(MailAccountConnectedEvent e) {
    if (TenantContext.get() == null) {
      log.warn("계정 연결 직후 즉시 동기화 skip — TenantContext 없음 accountId={}", e.accountId());
      return;
    }
    try {
      syncService.sync(e.userId(), e.accountId());
    } catch (Exception ex) {
      // 즉시 동기화 실패는 best-effort — 스케줄러가 다음 사이클에 재시도하므로 로그만 남긴다.
      log.warn("계정 연결 직후 즉시 동기화 실패 — 스케줄러 다음 사이클에 재시도 accountId={}", e.accountId(), ex);
    }
  }
}

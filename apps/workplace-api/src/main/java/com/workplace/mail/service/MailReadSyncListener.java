package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.event.MessageMarkedReadEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 읽음표시 서버 역동기화 이벤트 리스너.
 *
 * <p>첫 열람(seen false→true) 커밋 후 비동기로 원본 서버(Graph/IMAP)에 isRead 를 반영한다.
 *
 * <ul>
 *   <li>{@code @Async("mailReadSyncExecutor")}: 열람 응답 지연 없이 백그라운드 실행 — {@link
 *       com.workplace.global.outbound.OutboundConfig#mailReadSyncExecutor()} 전용 빈을 사용한다. IMAP STORE
 *       / Graph PATCH 는 스레드를 수 초간 점유하므로 경량 aiAgentEventExecutor 와 분리가 필수이며, bare {@code @Async} 는
 *       SimpleAsyncTaskExecutor 로 폴백하여 스레드를 무제한 생성한다.
 *   <li>{@code phase=AFTER_COMMIT}: markSeen 커밋이 확정된 뒤에만 역동기화 시도.
 *   <li>{@code fallbackExecution=true}: {@link MailMessageService#get} 이 비-@Transactional 이므로 주변
 *       트랜잭션이 없을 때에도 발화한다.
 * </ul>
 *
 * <p>비동기 스레드는 TenantContext 가 비어 있으므로 이벤트의 tenantId 로 재주입한 뒤 {@link
 * MailReadSyncDispatcher#dispatch} 를 호출한다(#444/#492, MailAutoSyncScheduler 패턴). best-effort — 예외를
 * 흡수해 열람 UX 에 영향 없음. 민감 데이터를 로그에 남기지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailReadSyncListener {

  private final MailReadSyncDispatcher dispatcher;

  /**
   * markSeen 커밋 후 비동기 호출. TenantContext 를 이벤트의 tenantId 로 세팅하고 {@link
   * MailReadSyncDispatcher#dispatch} 에 위임한 뒤 finally 에서 반드시 clear 한다.
   */
  @Async("mailReadSyncExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
  public void onMarkedRead(MessageMarkedReadEvent ev) {
    // 비동기 스레드 풀은 TenantContext 가 없으므로 이벤트의 tenantId 로 명시 주입
    TenantContext.set(ev.tenantId());
    try {
      dispatcher.dispatch(ev);
    } catch (Exception e) {
      // best-effort: 역동기화 실패가 읽음 UX 에 영향을 주지 않도록 흡수
      log.debug("읽음 역동기화 실패(best-effort): messageId={}", ev.messageId());
    } finally {
      // 스레드 풀 재사용 시 TenantContext 누수 방지
      TenantContext.clear();
    }
  }
}

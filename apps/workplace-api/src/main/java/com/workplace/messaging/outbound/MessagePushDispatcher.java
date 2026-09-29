package com.workplace.messaging.outbound;

import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushCandidateEvent;
import com.workplace.messaging.service.MessagePushRecipientResolver;
import com.workplace.notify.push.MessagePushRequest;
import com.workplace.notify.push.PushDispatcher;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 메시지 푸시 후보 → 수신 대상 계산 → notify 발송. 커밋 후(AFTER_COMMIT)에만, pushExecutor 스레드에서 실행한다.
 *
 * <p>커밋 후에 대상을 계산하는 이유: 작성 트랜잭션 안에서 조회하다 SQL 오류가 나면 PostgreSQL 이 트랜잭션 전체를 abort 시켜 메시지 작성까지 롤백될 수
 * 있다(#866). 커밋 후 별도 트랜잭션(resolver)으로 옮겨 그 결합을 없앴다. 롤백된 메시지는 발송되지 않는다.
 *
 * <p>pushExecutor 는 TenantContextTaskDecorator 로 발행 스레드의 테넌트를 복원하므로, resolver 의
 * {@code @Transactional} 이 tenant GUC 를 주입해 RLS 조회가 동작한다. 발송은 {@link
 * PushDispatcher#dispatchMessage} 직접 호출 — 여기는 트랜잭션 밖이라 트랜잭션 이벤트로 재발행하면 리스너가 실행되지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MessagePushDispatcher {

  private final MessagePushRecipientResolver resolver;
  private final PushDispatcher pushDispatcher;

  @Async("pushExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onMessagePushCandidate(MessagePushCandidateEvent e) {
    // 푸시는 best-effort — 실패는 로그만 남긴다. (@Async 라 예외가 메시지 작성에 전파되진 않지만, 원인 추적을 위해 여기서 기록한다.)
    try {
      MessagePushRequest request = resolver.resolve(e);
      if (request != null) pushDispatcher.dispatchMessage(request);
    } catch (Exception ex) {
      log.warn("[push] 메시지 푸시 실패 channelId={}: {}", e.channelId(), ex.getMessage());
    }
  }
}

package com.workplace.notify.push;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 도메인 이벤트 → 푸시 발송. AFTER_COMMIT 에서만 동작(롤백 시 미발송)하고 pushExecutor 에서 실행해 인박스 SSE·도메인 응답과 분리한다. 모든 예외는
 * 로그만 남긴다(푸시는 best-effort).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PushDispatcher {

  private final PushContentService content;
  private final PushSender sender;

  /** 인박스 알림(이슈·캘린더) → 푸시. */
  @Async("pushExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onInboxPush(InboxPushRequestedEvent e) {
    try {
      PushMessage m = content.forInbox(e);
      if (m != null) sender.send(e.recipientIds(), m);
    } catch (Exception ex) {
      log.warn("[push] 인박스 푸시 실패 type={}: {}", e.type(), ex.getMessage());
    }
  }
}

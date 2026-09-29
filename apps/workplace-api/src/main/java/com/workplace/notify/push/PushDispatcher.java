package com.workplace.notify.push;

import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushRequestedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 도메인 이벤트 → 푸시 발송. AFTER_COMMIT 에서만 동작(롤백 시 미발송)하고 pushExecutor 에서 실행해 인박스 SSE·도메인 응답과 분리한다. 모든 예외는
 * 로그만 남긴다(푸시는 best-effort). 인박스(이슈·캘린더)와 메시지(DM·멘션) 두 경로를 처리한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PushDispatcher {

  /** 메시지 푸시 TTL(초) — 하루. 인박스보다 짧게 잡아 오래된 대화 알림이 뒤늦게 뜨지 않도록 한다. */
  static final int MESSAGE_TTL = 86400;

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

  /** 메시지(DM·멘션) → 푸시. 한 사람이 DM 과 멘션에 모두 해당하면 DM 으로 1회만. */
  @Async("pushExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onMessagePush(MessagePushRequestedEvent e) {
    try {
      java.util.LinkedHashSet<Long> dm = new java.util.LinkedHashSet<>(e.dmRecipientIds());
      java.util.List<Long> mention =
          e.mentionedUserIds().stream().filter(id -> !dm.contains(id)).distinct().toList();
      boolean isDm = "DM".equals(e.channelKind());
      // channelName 이 null 이면(레이스로 채널이 지워졌거나 조회 실패) "#null · 작성자" 로 새지 않도록 대체 문구.
      String channelName = e.channelName() != null ? e.channelName() : "채널";
      String title = isDm ? e.authorName() : "#" + channelName + " · " + e.authorName();
      String url =
          isDm
              ? "/chat/dms/" + e.channelId()
              : "/chat/channels/"
                  + e.channelId()
                  + (e.parentMessageId() != null ? "?thread=" + e.parentMessageId() : "");
      if (!dm.isEmpty())
        sender.send(java.util.List.copyOf(dm), message(e, PushCategory.DM, title, url));
      if (!mention.isEmpty()) sender.send(mention, message(e, PushCategory.MENTION, title, url));
    } catch (Exception ex) {
      log.warn("[push] 메시지 푸시 실패 channelId={}: {}", e.channelId(), ex.getMessage());
    }
  }

  /** DM/MENTION 공통 PushMessage 조립 — 카테고리·제목·url 만 다르고 tag(대화 단위 교체)·urgency·TTL 은 동일. */
  private static PushMessage message(
      MessagePushRequestedEvent e, PushCategory c, String title, String url) {
    return new PushMessage(
        e.tenantId(),
        c,
        PushMessage.truncate(title, 120),
        e.preview(),
        url,
        "ch-" + e.channelId(),
        "high",
        MESSAGE_TTL);
  }
}

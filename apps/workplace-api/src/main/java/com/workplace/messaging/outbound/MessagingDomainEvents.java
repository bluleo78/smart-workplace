package com.workplace.messaging.outbound;

import com.workplace.global.dto.MentionResponse;
import com.workplace.messaging.dto.MessageResponse;
import java.time.Instant;
import java.util.List;

/** messaging 도메인 이벤트. AFTER_COMMIT 에서 디스패처가 수신해 채널 멤버에게 SSE fan-out. */
public final class MessagingDomainEvents {
  private MessagingDomainEvents() {}

  /** 메시지 작성 직후. SSE fan-out 용 — 완성된 MessageResponse 를 그대로 싣는다. */
  public record MessageCreatedEvent(long channelId, MessageResponse message) {}

  /** 메시지 수정 직후. SSE fan-out 용. */
  public record MessageUpdatedEvent(
      long channelId,
      long messageId,
      String body,
      List<MentionResponse> mentions,
      Instant editedAt) {}

  /** 메시지 soft-delete 직후. SSE fan-out 용. */
  public record MessageDeletedEvent(long channelId, long messageId) {}

  /** 읽음 표시 직후. SSE fan-out 용. */
  public record MessageReadEvent(long channelId, long userId, long lastReadMessageId) {}
}

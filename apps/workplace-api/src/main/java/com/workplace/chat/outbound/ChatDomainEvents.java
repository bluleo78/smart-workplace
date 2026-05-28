package com.workplace.chat.outbound;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/** chat 도메인 이벤트. AFTER_COMMIT 단계에서 dispatcher 가 수신해 ai-agent 로 발사한다. */
public final class ChatDomainEvents {
  private ChatDomainEvents() {}

  /**
   * chat 메시지 작성 직후 (생성에만 발행. 수정/삭제는 본 epic 범위 외).
   *
   * <p>mentions 는 resolve 후 UserSummary 로 hydrate 된 결과. AGENT 가 포함되었는지 dispatcher 가 판단한다.
   */
  public record ChatMessageCreatedEvent(
      long threadId,
      long messageId,
      long issueId,
      String projectKey,
      String issueKey,
      UserSummary actor,
      String body,
      List<UserSummary> mentions,
      Instant occurredAt) {}
}

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

  /** chat 메시지 수정 직후 (본인 수정). SSE fan-out 용. */
  public record ChatMessageUpdatedEvent(
      long threadId, long messageId, String body, List<UserSummary> mentions, Instant editedAt) {}

  /** chat 메시지 soft-delete 직후. SSE fan-out 용. */
  public record ChatMessageDeletedEvent(long threadId, long messageId) {}

  /** thread 읽음 표시 직후. lastReadMessageId 까지 읽음. SSE fan-out 용. */
  public record ChatThreadReadEvent(long threadId, long userId, long lastReadMessageId) {}

  /** thread 타이핑 알림 (transient, DB 저장 없음). 비-트랜잭션 이벤트. */
  public record ChatThreadTypingEvent(long threadId, UserSummary actor) {}

  /** thread 진행(progress) 알림 — AI 작업 단계 표시용 transient 이벤트(DB 저장 없음). */
  public record ChatThreadProgressEvent(
      long threadId, long agentId, String agentName, String streamId, String phase, Object steps) {}
}

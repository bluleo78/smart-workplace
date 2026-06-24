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

  /** 리액션 추가 직후. SSE fan-out 용. */
  public record ReactionAddedEvent(long channelId, long messageId, String emoji, long userId) {}

  /** 리액션 제거 직후. SSE fan-out 용. */
  public record ReactionRemovedEvent(long channelId, long messageId, String emoji, long userId) {}

  /** 채널 진행(progress) 알림 — AI 작업 단계 표시용 transient 이벤트(DB 저장 없음). */
  public record MessagingChannelProgressEvent(
      long channelId,
      long agentId,
      String agentName,
      String streamId,
      String phase,
      Object steps) {}

  /**
   * messaging 메시지가 AI 응답을 유발할 때만 발행. MessageService.create 가 트리거 조건을 판단해(채널 kind·멤버 정보 보유)
   * respondAsAgentId 를 확정하고 발행한다. AFTER_COMMIT async 디스패처는 단순 forward.
   *
   * @param channelKind "CHANNEL" 또는 "DM"
   * @param respondAsAgentId 응답을 작성할 AGENT user id
   */
  public record MessageAiTriggerEvent(
      long channelId,
      String channelKind,
      long messageId,
      long respondAsAgentId,
      long actorId,
      String actorName,
      String actorKind,
      String body,
      List<MentionResponse> mentions,
      // 트리거 메시지의 parentMessageId(스레드 루트). null 이면 채널 인라인 멘션 — AI 답도 인라인.
      // 비-null 이면 AI 답이 그 스레드에 들어가도록 ai-agent 가 MCP 세션에 바인딩(mirror).
      Long triggerParentMessageId,
      Instant occurredAt) {}

  /** 채널 멤버십 변경 — 연동 드라이브 공간 멤버 reconcile 소스. members 는 변경 후 현재 전체 roster. */
  public record ChannelMembershipChangedEvent(
      long channelId, String channelName, List<Member> members, Instant occurredAt) {
    /** roster 1건 — role 은 채널 역할 OWNER/ADMIN/MEMBER. */
    public record Member(long userId, String role) {}
  }

  /** 채널 보관 토글 — 연동 공간 읽기전용 반영 소스. */
  public record ChannelArchivedEvent(long channelId, boolean archived, Instant occurredAt) {}
}

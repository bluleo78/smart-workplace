package com.workplace.messaging.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageDeletedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageReadEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageUpdatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionAddedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionRemovedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * messaging 메시지 이벤트를 채널 전 멤버에게 SSE fan-out. self-echo 허용(발신자 포함) — 멀티기기 동기화 + 프론트가 messageId 로
 * optimistic dedup. AFTER_COMMIT 으로 커밋된 데이터만 push.
 */
@Component
@RequiredArgsConstructor
public class MessageSseDispatcher {

  private final SseRegistry registry;
  private final ChannelMemberRepository memberRepo;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(MessageCreatedEvent e) {
    registry.fanOut(
        memberRepo.findMemberIds(e.channelId()), "messaging.message.created", e.message());
  }

  /** 메시지 수정 이벤트를 채널 전 멤버에게 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onUpdated(MessageUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("id", e.messageId());
    p.put("body", e.body());
    p.put("mentions", e.mentions());
    p.put("editedAt", e.editedAt() == null ? null : e.editedAt().toString());
    registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.updated", p);
  }

  /** 메시지 삭제 이벤트를 채널 전 멤버에게 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onDeleted(MessageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("id", e.messageId());
    registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.deleted", p);
  }

  /** 읽음 표시 이벤트를 채널 전 멤버에게 fan-out(멀티기기 unread 동기화). */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onRead(MessageReadEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("userId", e.userId());
    p.put("lastReadMessageId", e.lastReadMessageId());
    registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.read", p);
  }

  /** 리액션 추가 이벤트를 채널 전 멤버에게 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onReactionAdded(ReactionAddedEvent e) {
    registry.fanOut(
        memberRepo.findMemberIds(e.channelId()),
        "messaging.reaction.added",
        reactionPayload(e.channelId(), e.messageId(), e.emoji(), e.userId()));
  }

  /** 리액션 제거 이벤트를 채널 전 멤버에게 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onReactionRemoved(ReactionRemovedEvent e) {
    registry.fanOut(
        memberRepo.findMemberIds(e.channelId()),
        "messaging.reaction.removed",
        reactionPayload(e.channelId(), e.messageId(), e.emoji(), e.userId()));
  }

  /** 리액션 SSE payload {channelId, messageId, emoji, userId}. */
  private Map<String, Object> reactionPayload(
      long channelId, long messageId, String emoji, long userId) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", channelId);
    p.put("messageId", messageId);
    p.put("emoji", emoji);
    p.put("userId", userId);
    return p;
  }
}

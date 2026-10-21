package com.workplace.messaging.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.util.AfterCommit;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageDeletedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageReadEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageUpdatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagingChannelProgressEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionAddedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionRemovedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * messaging 메시지 이벤트를 채널 전 멤버에게 SSE fan-out. self-echo 허용(발신자 포함) — 멀티기기 동기화 + 프론트가 messageId 로
 * optimistic dedup.
 *
 * <p>수신자는 커밋 직전(BEFORE_COMMIT)에 요청 트랜잭션 안에서 조회하고(커넥션·GUC 를 그대로 써 RLS 가 맞게 걸린다), 전송만 {@link
 * AfterCommit} 로 커밋 뒤로 미뤄 커밋된 변경만 알린다(롤백되면 보내지 않는다). 예전처럼 커밋 뒤 REQUIRES_NEW 로 다시 조회하면 요청 커넥션을 쥔 채 두
 * 번째 커넥션을 빌려, 동시 쓰기가 풀 크기를 넘으면 모두가 서로를 기다리며 멈췄다(WP-751). 진행(progress)은 transient 라 발행한 트랜잭션에 그대로
 * 합류한다.
 */
@Component
@RequiredArgsConstructor
public class MessageSseDispatcher {

  private final SseRegistry registry;
  private final ChannelMemberRepository memberRepo;

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onCreated(MessageCreatedEvent e) {
    Collection<Long> to = memberRepo.findMemberIds(e.channelId());
    AfterCommit.run(() -> registry.fanOut(to, "messaging.message.created", e.message()));
  }

  /** 메시지 수정 이벤트를 채널 전 멤버에게 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onUpdated(MessageUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("id", e.messageId());
    p.put("body", e.body());
    p.put("mentions", e.mentions());
    p.put("editedAt", e.editedAt() == null ? null : e.editedAt().toString());
    Collection<Long> to = memberRepo.findMemberIds(e.channelId());
    AfterCommit.run(() -> registry.fanOut(to, "messaging.message.updated", p));
  }

  /** 메시지 삭제 이벤트를 채널 전 멤버에게 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onDeleted(MessageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("id", e.messageId());
    Collection<Long> to = memberRepo.findMemberIds(e.channelId());
    AfterCommit.run(() -> registry.fanOut(to, "messaging.message.deleted", p));
  }

  /** 읽음 표시 이벤트를 채널 전 멤버에게 fan-out(멀티기기 unread 동기화). */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onRead(MessageReadEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("userId", e.userId());
    p.put("lastReadMessageId", e.lastReadMessageId());
    Collection<Long> to = memberRepo.findMemberIds(e.channelId());
    AfterCommit.run(() -> registry.fanOut(to, "messaging.message.read", p));
  }

  /** 리액션 추가 이벤트를 채널 전 멤버에게 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onReactionAdded(ReactionAddedEvent e) {
    Collection<Long> to = memberRepo.findMemberIds(e.channelId());
    AfterCommit.run(
        () ->
            registry.fanOut(
                to,
                "messaging.reaction.added",
                reactionPayload(e.channelId(), e.messageId(), e.emoji(), e.userId())));
  }

  /** 리액션 제거 이벤트를 채널 전 멤버에게 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onReactionRemoved(ReactionRemovedEvent e) {
    Collection<Long> to = memberRepo.findMemberIds(e.channelId());
    AfterCommit.run(
        () ->
            registry.fanOut(
                to,
                "messaging.reaction.removed",
                reactionPayload(e.channelId(), e.messageId(), e.emoji(), e.userId())));
  }

  /**
   * 진행 이벤트를 채널 전 멤버에게 fan-out. typing 과 동일하게 일반 @EventListener 사용(transient — DB commit 없음).
   * notifyProgress 의 readOnly 트랜잭션에 합류해 같은 커넥션·GUC 로 수신자를 읽는다(REQUIRES_NEW 면 두 번째 커넥션이 필요해진다,
   * WP-751).
   */
  @Transactional
  @EventListener
  public void onProgress(MessagingChannelProgressEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("streamId", e.streamId());
    p.put("agentId", e.agentId());
    p.put("agentName", e.agentName());
    p.put("phase", e.phase());
    p.put("steps", e.steps());
    registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.progress", p);
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

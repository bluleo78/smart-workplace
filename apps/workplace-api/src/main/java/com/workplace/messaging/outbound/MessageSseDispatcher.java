package com.workplace.messaging.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageDeletedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageReadEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageUpdatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagingChannelProgressEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionAddedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionRemovedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * messaging 메시지 이벤트를 채널 전 멤버에게 SSE fan-out. self-echo 허용(발신자 포함) — 멀티기기 동기화 + 프론트가 messageId 로
 * optimistic dedup. AFTER_COMMIT 으로 커밋된 데이터만 push.
 *
 * <p>모든 핸들러에 {@code @Transactional(REQUIRES_NEW)} 를 부여한다. AFTER_COMMIT 은 원래 트랜잭션이 이미 커밋된 후 동기 실행되므로
 * 활성 트랜잭션이 없다. 트랜잭션 없이 jOOQ 가 연결을 가져오면 autocommit 연결에 GUC 가 없어 RLS 가 channel_member 를 전부 차단한다
 * (fail-closed). REQUIRES_NEW 로 새 트랜잭션을 시작하면 TenantAwareTransactionManager.doBegin 이 아직 요청 스레드에 설정된
 * TenantContext 를 읽어 트랜잭션-로컬 GUC 를 재주입하고, findMemberIds 가 올바른 테넌트 멤버를 반환한다.
 */
@Component
@RequiredArgsConstructor
public class MessageSseDispatcher {

  private final SseRegistry registry;
  private final ChannelMemberRepository memberRepo;

  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(MessageCreatedEvent e) {
    registry.fanOut(
        memberRepo.findMemberIds(e.channelId()), "messaging.message.created", e.message());
  }

  /** 메시지 수정 이벤트를 채널 전 멤버에게 fan-out. */
  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
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
  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onDeleted(MessageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("id", e.messageId());
    registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.deleted", p);
  }

  /** 읽음 표시 이벤트를 채널 전 멤버에게 fan-out(멀티기기 unread 동기화). */
  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onRead(MessageReadEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("userId", e.userId());
    p.put("lastReadMessageId", e.lastReadMessageId());
    registry.fanOut(memberRepo.findMemberIds(e.channelId()), "messaging.message.read", p);
  }

  /** 리액션 추가 이벤트를 채널 전 멤버에게 fan-out. */
  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onReactionAdded(ReactionAddedEvent e) {
    registry.fanOut(
        memberRepo.findMemberIds(e.channelId()),
        "messaging.reaction.added",
        reactionPayload(e.channelId(), e.messageId(), e.emoji(), e.userId()));
  }

  /** 리액션 제거 이벤트를 채널 전 멤버에게 fan-out. */
  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onReactionRemoved(ReactionRemovedEvent e) {
    registry.fanOut(
        memberRepo.findMemberIds(e.channelId()),
        "messaging.reaction.removed",
        reactionPayload(e.channelId(), e.messageId(), e.emoji(), e.userId()));
  }

  /**
   * 진행 이벤트를 채널 전 멤버에게 fan-out. typing 과 동일하게 일반 @EventListener 사용(transient — DB commit 없음).
   * notifyProgress 의 readOnly 트랜잭션 안에서 동기 발행 → REQUIRES_NEW 가 그 트랜잭션을 보류하고 새 트랜잭션으로 GUC 재주입.
   */
  // progress 는 transient 이벤트 — notifyProgress readOnly tx 안에서 동기 발행됨.
  // REQUIRES_NEW 로 그 트랜잭션을 보류하고 새 트랜잭션을 열어 GUC 재주입(fail-closed 방지).
  @Transactional(propagation = Propagation.REQUIRES_NEW)
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

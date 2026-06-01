package com.workplace.messaging.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
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
}

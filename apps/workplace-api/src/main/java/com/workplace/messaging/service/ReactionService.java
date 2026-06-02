package com.workplace.messaging.service;

import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionAddedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionRemovedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.repository.ReactionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이모지 리액션 토글. 채널 멤버만, 실제 변경 시에만 AFTER_COMMIT SSE 이벤트 발행. */
@Service
@RequiredArgsConstructor
public class ReactionService {

  private final ReactionRepository reactionRepo;
  private final MessageRepository messageRepo;
  private final ChannelMemberRepository memberRepo;
  private final ApplicationEventPublisher publisher;

  /** 리액션 추가(멱등 — 이미 있으면 이벤트 미발행). */
  @Transactional
  public void add(long callerId, long messageId, String emoji) {
    long channelId = ensureMessageMember(callerId, messageId);
    if (reactionRepo.add(messageId, callerId, emoji))
      publisher.publishEvent(new ReactionAddedEvent(channelId, messageId, emoji, callerId));
  }

  /** 리액션 제거(멱등 — 없으면 이벤트 미발행). */
  @Transactional
  public void remove(long callerId, long messageId, String emoji) {
    long channelId = ensureMessageMember(callerId, messageId);
    if (reactionRepo.remove(messageId, callerId, emoji))
      publisher.publishEvent(new ReactionRemovedEvent(channelId, messageId, emoji, callerId));
  }

  /** 메시지의 채널 멤버 여부 검증 후 channelId 반환. */
  private long ensureMessageMember(long callerId, long messageId) {
    long channelId =
        messageRepo
            .findChannelId(messageId)
            .orElseThrow(() -> new MessageNotFoundException(messageId));
    if (!memberRepo.isMember(channelId, callerId))
      throw new ChannelNotMemberException(channelId, callerId);
    return channelId;
  }
}

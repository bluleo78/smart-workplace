package com.workplace.messaging.service;

import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.util.MentionParser;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 메시지 작성/조회 + MessageCreatedEvent 발행 (AFTER_COMMIT SSE fan-out). */
@Service
@RequiredArgsConstructor
public class MessageService {

  private final MessageRepository messageRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelRepository channelRepo;
  private final ApplicationEventPublisher publisher;
  private final UserMentionHydrator mentionHydrator;

  /** 채널 멤버가 메시지 작성. 본문 @멘션 파싱·검증 후 INSERT, AFTER_COMMIT 이벤트 발행. */
  @Transactional
  public MessageResponse create(long callerId, long channelId, CreateMessageRequest req) {
    ensureMember(channelId, callerId);
    // 아카이브된 채널에는 새 메시지를 작성할 수 없다 (409).
    if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
    // 본문에서 멘션 토큰 추출 → 실제 존재하는 user.id 만 남긴다.
    java.util.List<Long> mentionIds =
        mentionHydrator.filterExistingUserIds(MentionParser.parse(req.body()));
    long messageId = messageRepo.insert(channelId, callerId, req.body(), mentionIds);
    MessageResponse saved = findOne(messageId);
    publisher.publishEvent(new MessageCreatedEvent(channelId, saved));
    return saved;
  }

  /** 채널 멤버만 히스토리 조회. */
  public MessagePage list(long callerId, long channelId, String cursor, int limit) {
    ensureMember(channelId, callerId);
    return messageRepo.findPage(channelId, cursor, limit, mentionHydrator::asMentionResponses);
  }

  private MessageResponse findOne(long messageId) {
    return messageRepo
        .findById(messageId, mentionHydrator::asMentionResponses)
        .orElseThrow(() -> new IllegalStateException("message " + messageId + " not found"));
  }

  private void ensureMember(long channelId, long userId) {
    if (!memberRepo.isMember(channelId, userId))
      throw new ChannelNotMemberException(channelId, userId);
  }
}

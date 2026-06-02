package com.workplace.messaging.service;

import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.util.MentionParser;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.MessageAuthorMismatchException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageDeletedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageReadEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageUpdatedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageRepository;
import java.util.List;
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

  /** 작성자만 자신의 메시지 수정. 본문 @멘션 재파싱, AFTER_COMMIT SSE 발행. */
  @Transactional
  public MessageResponse update(long callerId, long messageId, UpdateMessageRequest req) {
    long authorId =
        messageRepo
            .findAuthorId(messageId)
            .orElseThrow(() -> new MessageNotFoundException(messageId));
    if (authorId != callerId) throw new MessageAuthorMismatchException(messageId, callerId);
    List<Long> mentionIds = mentionHydrator.filterExistingUserIds(MentionParser.parse(req.body()));
    messageRepo.update(messageId, req.body(), mentionIds);
    MessageResponse saved = findOne(messageId);
    publisher.publishEvent(
        new MessageUpdatedEvent(
            saved.channelId(),
            messageId,
            saved.body(),
            mentionHydrator.asMentionResponses(mentionIds),
            saved.editedAt()));
    return saved;
  }

  /** 작성자만 자신의 메시지 soft-delete. AFTER_COMMIT SSE 발행. */
  @Transactional
  public void delete(long callerId, long messageId) {
    long authorId =
        messageRepo
            .findAuthorId(messageId)
            .orElseThrow(() -> new MessageNotFoundException(messageId));
    if (authorId != callerId) throw new MessageAuthorMismatchException(messageId, callerId);
    long channelId =
        messageRepo
            .findChannelId(messageId)
            .orElseThrow(() -> new MessageNotFoundException(messageId));
    messageRepo.softDelete(messageId);
    publisher.publishEvent(new MessageDeletedEvent(channelId, messageId));
  }

  /** 채널 멤버가 uptoMessageId 까지 읽음 표시. watermark 갱신 후 AFTER_COMMIT SSE 발행. */
  @Transactional
  public void markRead(long callerId, long channelId, long uptoMessageId) {
    ensureMember(channelId, callerId);
    memberRepo.markRead(channelId, callerId, uptoMessageId);
    publisher.publishEvent(new MessageReadEvent(channelId, callerId, uptoMessageId));
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

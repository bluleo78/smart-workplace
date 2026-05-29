package com.workplace.chat.service;

import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** chat 메시지 CRUD + @mention 파싱 + ChatMessageCreatedEvent 발행. */
@Service
@RequiredArgsConstructor
public class ChatMessageService {

  private final ChatMessageRepository messageRepo;
  private final ChatThreadMemberRepository memberRepo;
  private final ChatUserHydrator hydrator;
  private final ChatThreadContextResolver contextResolver;
  private final ApplicationEventPublisher publisher;

  /** Thread member 가 메시지 작성. mention 파싱 후 INSERT, AFTER_COMMIT 이벤트 발행. */
  @Transactional
  public ChatMessageResponse create(long callerId, long threadId, CreateChatMessageRequest req) {
    ensureMember(threadId, callerId);
    List<Long> mentionUserIds = hydrator.filterExistingUserIds(ChatMentionParser.parse(req.body()));
    long messageId = messageRepo.insert(threadId, callerId, req.body(), mentionUserIds);

    publisher.publishEvent(buildEvent(threadId, messageId, callerId, req.body(), mentionUserIds));
    return findOne(messageId);
  }

  /** 본인만 수정. mention 재파싱. edited_at 갱신. */
  @Transactional
  public ChatMessageResponse update(long callerId, long messageId, UpdateChatMessageRequest req) {
    long authorId =
        messageRepo
            .findAuthorId(messageId)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    if (authorId != callerId) throw new ChatMessageAuthorMismatchException(messageId, callerId);
    List<Long> mentionUserIds = hydrator.filterExistingUserIds(ChatMentionParser.parse(req.body()));
    messageRepo.update(messageId, req.body(), mentionUserIds);
    return findOne(messageId);
  }

  /** 본인만 soft-delete. */
  @Transactional
  public void delete(long callerId, long messageId) {
    long authorId =
        messageRepo
            .findAuthorId(messageId)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    if (authorId != callerId) throw new ChatMessageAuthorMismatchException(messageId, callerId);
    messageRepo.softDelete(messageId);
  }

  public ChatMessagePage list(long callerId, long threadId, String cursor, int limit) {
    ensureMember(threadId, callerId);
    return messageRepo.findPage(threadId, cursor, limit, hydrator::asMentionResponses);
  }

  @Transactional
  public void markRead(long callerId, long threadId, long uptoMessageId) {
    ensureMember(threadId, callerId);
    memberRepo.markRead(threadId, callerId, uptoMessageId);
  }

  private ChatMessageResponse findOne(long messageId) {
    return messageRepo
        .findById(messageId, hydrator::asMentionResponses)
        .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
  }

  private void ensureMember(long threadId, long userId) {
    if (!memberRepo.isMember(threadId, userId))
      throw new ChatThreadNotMemberException(threadId, userId);
  }

  private ChatMessageCreatedEvent buildEvent(
      long threadId, long messageId, long actorId, String body, List<Long> mentionUserIds) {
    var context = contextResolver.resolve(threadId);
    UserSummary actor = hydrator.summaryOf(actorId);
    List<UserSummary> mentions = hydrator.summariesOf(mentionUserIds);
    return new ChatMessageCreatedEvent(
        threadId,
        messageId,
        context.issueId(),
        context.projectKey(),
        context.issueKey(),
        actor,
        body,
        mentions,
        Instant.now());
  }
}

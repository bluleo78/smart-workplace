package com.workplace.chat.service;

import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadReadEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.util.MentionParser;
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
    List<Long> mentionUserIds = hydrator.filterExistingUserIds(MentionParser.parse(req.body()));

    // 멘션된 AGENT 는 thread 멤버로 add-only 추가 — AI 가 답을 작성하려면 멤버여야 함(6c).
    List<Long> agentMentionIds =
        hydrator.summariesOf(mentionUserIds).stream()
            .filter(u -> "AGENT".equals(u.kind()))
            .map(UserSummary::id)
            .toList();
    if (!agentMentionIds.isEmpty()) {
      memberRepo.insertIgnoreConflict(threadId, agentMentionIds);
    }

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
    List<Long> mentionUserIds = hydrator.filterExistingUserIds(MentionParser.parse(req.body()));
    messageRepo.update(messageId, req.body(), mentionUserIds);
    ChatMessageResponse saved = findOne(messageId);
    // SSE fan-out 용 수정 이벤트 발행 (mention 은 hydrate 후 전달).
    publisher.publishEvent(
        new ChatMessageUpdatedEvent(
            saved.threadId(),
            messageId,
            saved.body(),
            hydrator.summariesOf(mentionUserIds),
            saved.editedAt()));
    return saved;
  }

  /** 본인만 soft-delete. */
  @Transactional
  public void delete(long callerId, long messageId) {
    long authorId =
        messageRepo
            .findAuthorId(messageId)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    if (authorId != callerId) throw new ChatMessageAuthorMismatchException(messageId, callerId);
    // soft-delete 전 threadId 를 조회해 둔다 (이벤트 fan-out 에 필요).
    long threadId =
        messageRepo
            .findThreadId(messageId)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    messageRepo.softDelete(messageId);
    publisher.publishEvent(new ChatMessageDeletedEvent(threadId, messageId));
  }

  public ChatMessagePage list(long callerId, long threadId, String cursor, int limit) {
    ensureMember(threadId, callerId);
    return messageRepo.findPage(threadId, cursor, limit, hydrator::asMentionResponses);
  }

  @Transactional
  public void markRead(long callerId, long threadId, long uptoMessageId) {
    ensureMember(threadId, callerId);
    memberRepo.markRead(threadId, callerId, uptoMessageId);
    publisher.publishEvent(new ChatThreadReadEvent(threadId, callerId, uptoMessageId));
  }

  /** 타이핑 알림 — DB 저장 없이 transient 이벤트만 발행. @Transactional 아님 (비-트랜잭션 이벤트). */
  public void notifyTyping(long callerId, long threadId) {
    ensureMember(threadId, callerId);
    publisher.publishEvent(new ChatThreadTypingEvent(threadId, hydrator.summaryOf(callerId)));
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

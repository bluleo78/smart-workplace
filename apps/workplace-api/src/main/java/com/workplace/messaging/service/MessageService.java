package com.workplace.messaging.service;

import com.workplace.global.dto.MentionResponse;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.MentionParser;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.ReactionResponse;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.EmptyMessageException;
import com.workplace.messaging.exception.InvalidThreadParentException;
import com.workplace.messaging.exception.MessageAuthorMismatchException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageAiTriggerEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageDeletedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageReadEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageUpdatedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagingChannelProgressEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageAttachmentRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.repository.MessageRepository.MessageRef;
import com.workplace.messaging.repository.ReactionRepository;
import com.workplace.tenant.repository.MembershipRepository;
import java.util.List;
import java.util.Map;
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
  private final ReactionRepository reactionRepo;
  private final MessageAttachmentService attachmentService;
  private final MessageAttachmentRepository attachmentRepo;
  private final AiAgentProperties aiAgentProps;
  private final MembershipRepository membershipRepo;

  /** 채널 멤버가 메시지 작성. 본문 @멘션 파싱·검증 후 INSERT, AFTER_COMMIT 이벤트 발행. */
  @Transactional
  public MessageResponse create(long callerId, long channelId, CreateMessageRequest req) {
    ensureMember(channelId, callerId);
    // 아카이브된 채널에는 새 메시지를 작성할 수 없다 (409).
    if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
    // 빈 메시지 거부: 본문도 첨부도 없으면 작성 불가 (400).
    boolean bodyEmpty = req.body() == null || req.body().isBlank();
    if (bodyEmpty && req.fileIds().isEmpty()) {
      throw new EmptyMessageException();
    }
    // 스레드 답글이면 부모 검증: 존재 + 같은 채널 + 최상위(대댓글 금지).
    Long parentId = req.parentMessageId();
    if (parentId != null) {
      MessageRef ref =
          messageRepo
              .findRef(parentId)
              .orElseThrow(() -> new InvalidThreadParentException(parentId));
      if (ref.channelId() != channelId || ref.parentMessageId() != null)
        throw new InvalidThreadParentException(parentId);
    }
    // 본문에서 멘션 토큰 추출 → 실제 존재하는 user.id 만 남긴다. body 가 null 일 수 있어 빈 문자열로 방어.
    java.util.List<Long> mentionIds =
        mentionHydrator.filterExistingUserIds(
            MentionParser.parse(req.body() == null ? "" : req.body()));
    // body 는 nullable (첨부만 있는 메시지). jOOQ 가 NULL 로 INSERT.
    long messageId = messageRepo.insert(channelId, callerId, req.body(), mentionIds, parentId);
    // 선업로드된 첨부를 이 메시지에 바인딩 + 영구 승격 (같은 트랜잭션).
    attachmentService.bindToMessage(callerId, messageId, req.fileIds());
    MessageResponse saved = findOne(messageId, callerId);
    publisher.publishEvent(new MessageCreatedEvent(channelId, saved)); // SSE fan-out (기존)
    maybeTriggerAi(callerId, channelId, saved); // AI 응답 트리거 (신규)
    return saved;
  }

  /**
   * AI 응답 트리거 판단. self-loop 차단(작성자 AGENT 면 무발사). 채널이면 멘션된 AGENT 를 add-only 멤버추가 후 첫 AGENT 를 응답자로,
   * 1:1 DM 이면 상대 AGENT 를, 그룹 DM 이면 멤버인 멘션 AGENT 를 응답자로 선정한다. 응답자가 있으면 MessageAiTriggerEvent 발행 →
   * AFTER_COMMIT 디스패처가 ai-agent 로 forward.
   */
  private void maybeTriggerAi(long callerId, long channelId, MessageResponse saved) {
    // AI 비활성 시 트리거뿐 아니라 AGENT 자동 멤버추가도 하지 않는다(비활성 환경에서 응답 없는 유령 멤버 방지).
    if (!aiAgentProps.enabled()) return;
    if ("AGENT".equals(saved.authorKind())) return; // self-loop 가드 (1:1 DM 의 유일한 가드)
    String kind = channelRepo.findKind(channelId);
    Long respondAsAgentId;
    if ("DM".equals(kind)) {
      java.util.List<ChannelMemberResponse> members = memberRepo.listMembers(channelId);
      if (members.size() == 2) {
        // 1:1 DM: caller 제외 상대가 AGENT 면 멘션 없이도 응답.
        respondAsAgentId =
            members.stream()
                .filter(m -> m.userId() != callerId && "AGENT".equals(m.kind()))
                .map(ChannelMemberResponse::userId)
                .findFirst()
                .orElse(null);
      } else {
        // 그룹 DM: 멤버가 고정 — 멘션된 AGENT 가 이미 멤버일 때만.
        java.util.Set<Long> memberIds =
            members.stream()
                .map(ChannelMemberResponse::userId)
                .collect(java.util.stream.Collectors.toSet());
        respondAsAgentId =
            saved.mentions().stream()
                .filter(m -> "AGENT".equals(m.kind()) && memberIds.contains(m.id()))
                .map(MentionResponse::id)
                .findFirst()
                .orElse(null);
      }
    } else {
      // 채널: 멘션된 AGENT 를 add-only 멤버추가 후 첫 AGENT 를 응답자로.
      java.util.List<Long> agentMentionIds =
          saved.mentions().stream()
              .filter(m -> "AGENT".equals(m.kind()))
              .map(MentionResponse::id)
              .toList();
      Long tenantId = TenantContext.get();
      // 멘션된 AGENT 중 현재 테넌트의 활성 멤버만 채널에 추가·트리거 — 교차테넌트 에이전트 멘션은 조용히 무시(메시지 전송은 막지 않음).
      // (tenantId == null 이면 어떤 에이전트도 추가하지 않음 — fail-closed)
      java.util.List<Long> eligibleAgentIds =
          agentMentionIds.stream()
              .filter(aid -> tenantId != null && membershipRepo.hasActiveMembership(aid, tenantId))
              .toList();
      for (Long agentId : eligibleAgentIds) memberRepo.add(channelId, agentId, "MEMBER");
      respondAsAgentId = eligibleAgentIds.isEmpty() ? null : eligibleAgentIds.get(0);
    }
    if (respondAsAgentId == null) return;
    publisher.publishEvent(
        new MessageAiTriggerEvent(
            channelId,
            kind,
            saved.id(),
            respondAsAgentId,
            saved.authorId(),
            saved.authorName(),
            saved.authorKind(),
            saved.body(),
            saved.mentions(),
            saved.createdAt()));
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
    MessageResponse saved = findOne(messageId, callerId);
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

  /** 채널 멤버만 히스토리 조회. 리액션 집계 batch enrich 포함. RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public MessagePage list(long callerId, long channelId, String cursor, int limit) {
    ensureMember(channelId, callerId);
    MessagePage page =
        messageRepo.findPage(channelId, cursor, limit, mentionHydrator::asMentionResponses);
    return enrichReactions(page, callerId);
  }

  /** 채널 멤버만 특정 부모 메시지의 답글 조회. RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public MessagePage listThread(long callerId, long parentMessageId, String cursor, int limit) {
    MessageRef ref =
        messageRepo
            .findRef(parentMessageId)
            .orElseThrow(() -> new MessageNotFoundException(parentMessageId));
    ensureMember(ref.channelId(), callerId);
    MessagePage page =
        messageRepo.findThreadPage(
            parentMessageId, cursor, limit, mentionHydrator::asMentionResponses);
    return enrichReactions(page, callerId);
  }

  /** 페이지 내 모든 메시지의 리액션 집계 + 첨부 목록을 batch 로 채운다(N+1 회피). */
  private MessagePage enrichReactions(MessagePage page, long callerId) {
    java.util.List<Long> ids = page.items().stream().map(MessageResponse::id).toList();
    Map<Long, java.util.List<ReactionResponse>> rmap = reactionRepo.summariesFor(ids, callerId);
    var amap = attachmentRepo.findByMessageIds(ids);
    java.util.List<MessageResponse> enriched =
        page.items().stream()
            .map(
                m ->
                    m.withReactions(rmap.getOrDefault(m.id(), java.util.List.of()))
                        .withAttachments(amap.getOrDefault(m.id(), java.util.List.of())))
            .toList();
    return new MessagePage(enriched, page.nextCursor(), page.hasMore());
  }

  private MessageResponse findOne(long messageId, long callerId) {
    MessageResponse m =
        messageRepo
            .findById(messageId, mentionHydrator::asMentionResponses)
            .orElseThrow(() -> new IllegalStateException("message " + messageId + " not found"));
    MessageResponse response =
        m.withReactions(
            reactionRepo
                .summariesFor(java.util.List.of(messageId), callerId)
                .getOrDefault(messageId, java.util.List.of()));
    // 첨부 목록 batch hydrate (단건이라도 동일 메서드 재사용).
    var attMap = attachmentRepo.findByMessageIds(java.util.List.of(messageId));
    return response.withAttachments(attMap.getOrDefault(messageId, java.util.List.of()));
  }

  /**
   * 진행 알림 — DB 저장 없이 transient 이벤트만 발행. ai-agent 가 X-On-Behalf-Of 로 AGENT 자격을 받아 호출한다. readOnly
   * 트랜잭션으로 ensureMember(RLS 보호 테이블 읽기)를 감싼다(GUC 재주입).
   */
  @Transactional(readOnly = true)
  public void notifyProgress(
      long callerId, long channelId, String streamId, String phase, Object steps) {
    ensureMember(channelId, callerId);
    String name = mentionHydrator.summaryOf(callerId).name();
    publisher.publishEvent(
        new MessagingChannelProgressEvent(channelId, callerId, name, streamId, phase, steps));
  }

  private void ensureMember(long channelId, long userId) {
    if (!memberRepo.isMember(channelId, userId))
      throw new ChannelNotMemberException(channelId, userId);
  }
}

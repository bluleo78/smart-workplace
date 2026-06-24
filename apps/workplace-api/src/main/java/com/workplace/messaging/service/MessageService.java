package com.workplace.messaging.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.file.service.FileUploadService;
import com.workplace.global.dto.MentionResponse;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.MentionParser;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageProposalResponse;
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
import com.workplace.messaging.repository.MessageActionProposalRepository;
import com.workplace.messaging.repository.MessageAttachmentRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.repository.MessageRepository.MessageRef;
import com.workplace.messaging.repository.ReactionRepository;
import com.workplace.messaging.repository.ThreadReadStateRepository;
import com.workplace.tenant.repository.MembershipRepository;
import java.io.IOException;
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
  private final ThreadReadStateRepository threadReadRepo;
  private final DriveLinkService driveLinkService;
  // L3 위임 제안 enrich 용 의존성
  private final MessageActionProposalRepository proposalRepo;
  private final ObjectMapper objectMapper;

  /** 채널 멤버가 메시지 작성. 본문 @멘션 파싱·검증 후 INSERT, AFTER_COMMIT 이벤트 발행. */
  @Transactional
  public MessageResponse create(long callerId, long channelId, CreateMessageRequest req) {
    ensureMember(channelId, callerId);
    // 아카이브된 채널에는 새 메시지를 작성할 수 없다 (409).
    if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
    // 빈 메시지 거부: 본문도 첨부도 드라이브 링크도 없으면 작성 불가 (400).
    boolean bodyEmpty = req.body() == null || req.body().isBlank();
    if (bodyEmpty && req.fileIds().isEmpty() && req.driveFileIds().isEmpty()) {
      throw new EmptyMessageException();
    }
    // 스레드 답글이면 부모 검증: 존재 + 같은 채널 + 최상위(대댓글 금지).
    Long parentId = req.parentMessageId();
    // 자동 팔로우를 위해 parentId != null 일 때 ref 를 블록 밖에서 참조할 수 있도록 미리 선언.
    final MessageRef parentRef;
    if (parentId != null) {
      MessageRef ref =
          messageRepo
              .findRef(parentId)
              .orElseThrow(() -> new InvalidThreadParentException(parentId));
      if (ref.channelId() != channelId || ref.parentMessageId() != null)
        throw new InvalidThreadParentException(parentId);
      parentRef = ref;
    } else {
      parentRef = null;
    }
    // 본문에서 멘션 토큰 추출 → 실제 존재하는 user.id 만 남긴다. body 가 null 일 수 있어 빈 문자열로 방어.
    java.util.List<Long> mentionIds =
        mentionHydrator.filterExistingUserIds(
            MentionParser.parse(req.body() == null ? "" : req.body()));
    // body 는 nullable (첨부만 있는 메시지). jOOQ 가 NULL 로 INSERT.
    long messageId = messageRepo.insert(channelId, callerId, req.body(), mentionIds, parentId);
    // 선업로드된 첨부를 이 메시지에 바인딩 + 영구 승격 (같은 트랜잭션).
    attachmentService.bindToMessage(callerId, messageId, req.fileIds());
    // 드라이브 파일 교차링크 생성 — 발신자 채널 멤버(ensureMember 통과) + 각 파일 ≥VIEWER 권한 검증.
    for (Long driveFileId : req.driveFileIds()) {
      driveLinkService.createLink(callerId, driveFileId, "MESSAGE", messageId);
    }
    // 스레드 답글이면 자동 팔로우: 루트 작성자(읽음 보존)·본인(읽음 처리)·답글 멘션 대상(읽음 보존).
    if (parentId != null && parentRef != null) {
      threadReadRepo.followIfAbsent(parentId, parentRef.authorId());
      threadReadRepo.markRead(parentId, callerId, messageId);
      for (Long mentioned : mentionIds) {
        if (!mentioned.equals(callerId) && !mentioned.equals(parentRef.authorId())) {
          threadReadRepo.followIfAbsent(parentId, mentioned);
        }
      }
    }
    MessageResponse saved = findOne(messageId, callerId);
    // SSE fan-out(기존) + 어텐션 AI 발굴(AFTER_COMMIT 리스너). 커밋 전 직접 호출은 워커 재조회 레이스를 유발하므로
    // 암묵적 관련성 발굴은 MessagingAttentionDispatcher 가 커밋 후에 발사한다(directed 제외 판정 포함).
    publisher.publishEvent(new MessageCreatedEvent(channelId, saved));
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
            // mirror: AI 답이 트리거와 같은 자리(스레드/인라인)에 떨어지도록 트리거의 parent 운반.
            saved.parentMessageId(),
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
    // 메시지 삭제 시 연결된 드라이브 ref 정리 (source_id 는 비-FK 이므로 명시적 purge 필요)
    driveLinkService.purgeSource("MESSAGE", messageId);
    publisher.publishEvent(new MessageDeletedEvent(channelId, messageId));
  }

  /** 스레드 패널 열기 시 호출 — 해당 스레드를 최신 답글까지 읽음 처리. 비멤버=403. */
  @Transactional
  public void markThreadRead(long callerId, long rootId) {
    MessageRef ref =
        messageRepo.findRef(rootId).orElseThrow(() -> new MessageNotFoundException(rootId));
    ensureMember(ref.channelId(), callerId);
    long maxReply = messageRepo.maxReplyId(rootId);
    // 답글이 0개여도 팔로우 행은 보장(watermark=0). 이후 새 답글이 미읽음으로 잡힌다.
    threadReadRepo.markRead(rootId, callerId, maxReply);
  }

  /** 채널 멤버가 uptoMessageId 까지 읽음 표시. watermark 갱신 후 AFTER_COMMIT SSE 발행. */
  @Transactional
  public void markRead(long callerId, long channelId, long uptoMessageId) {
    ensureMember(channelId, callerId);
    memberRepo.markRead(channelId, callerId, uptoMessageId);
    publisher.publishEvent(new MessageReadEvent(channelId, callerId, uptoMessageId));
  }

  /** 채널 멤버만 히스토리 조회. 리액션 집계 + 제안 batch enrich 포함. RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public MessagePage list(long callerId, long channelId, String cursor, int limit) {
    ensureMember(channelId, callerId);
    MessagePage page =
        messageRepo.findPage(channelId, cursor, limit, mentionHydrator::asMentionResponses);
    return enrichProposals(enrichThreadUnread(enrichReactions(page, callerId), callerId));
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
    return enrichProposals(enrichReactions(page, callerId));
  }

  /** 페이지 내 top-level 메시지에 스레드 미읽음 수/팔로우 여부를 batch hydrate. */
  private MessagePage enrichThreadUnread(MessagePage page, long callerId) {
    java.util.List<Long> rootIds =
        page.items().stream()
            .filter(m -> m.parentMessageId() == null)
            .map(MessageResponse::id)
            .toList();
    if (rootIds.isEmpty()) return page;
    var unread = threadReadRepo.countUnreadForRoots(rootIds, callerId);
    var followed = threadReadRepo.followedRoots(rootIds, callerId);
    java.util.List<MessageResponse> items =
        page.items().stream()
            .map(
                m ->
                    m.parentMessageId() == null
                        ? m.withThreadUnread(
                            unread.getOrDefault(m.id(), 0), followed.contains(m.id()))
                        : m)
            .toList();
    return new MessagePage(items, page.nextCursor(), page.hasMore());
  }

  /** 페이지 내 모든 메시지의 리액션 집계 + 첨부 목록 + 드라이브 링크를 batch 로 채운다(N+1 회피). */
  private MessagePage enrichReactions(MessagePage page, long callerId) {
    java.util.List<Long> ids = page.items().stream().map(MessageResponse::id).toList();
    Map<Long, java.util.List<ReactionResponse>> rmap = reactionRepo.summariesFor(ids, callerId);
    var amap = attachmentRepo.findByMessageIds(ids);
    var dmap = driveLinkService.listLinksBatch("MESSAGE", ids);
    java.util.List<MessageResponse> enriched =
        page.items().stream()
            .map(
                m ->
                    m.withReactions(rmap.getOrDefault(m.id(), java.util.List.of()))
                        .withAttachments(amap.getOrDefault(m.id(), java.util.List.of()))
                        .withDriveLinks(dmap.getOrDefault(m.id(), java.util.List.of())))
            .toList();
    return new MessagePage(enriched, page.nextCursor(), page.hasMore());
  }

  /** 제안(L3 위임) batch enrich — 메시지 id 들로 proposal 을 한 번에 조회해 매핑(N+1 회피). 제안이 없는 메시지는 그대로 반환. */
  private MessagePage enrichProposals(MessagePage page) {
    if (page.items().isEmpty()) return page;
    java.util.List<Long> ids = page.items().stream().map(MessageResponse::id).toList();
    var byMessageId =
        proposalRepo.findByMessageIds(ids).stream()
            .collect(
                java.util.stream.Collectors.toMap(
                    MessageActionProposalRepository.ProposalRow::messageId,
                    this::toProposalResponse));
    java.util.List<MessageResponse> enriched =
        page.items().stream()
            .map(m -> byMessageId.containsKey(m.id()) ? m.withProposal(byMessageId.get(m.id())) : m)
            .toList();
    return new MessagePage(enriched, page.nextCursor(), page.hasMore());
  }

  /**
   * payload(JSON)에서 title/priority/projectName/projectKey/candidates 추출해 MessageProposalResponse 로
   * 변환. 누락 필드는 null.
   */
  private MessageProposalResponse toProposalResponse(
      MessageActionProposalRepository.ProposalRow r) {
    JsonNode p;
    try {
      p = objectMapper.readTree(r.payloadJson());
    } catch (Exception e) {
      p = objectMapper.createObjectNode();
    }
    // L3 후보 라우팅: payload 에 저장된 projectKey + candidates 배열 복원.
    String projectKey = p.path("projectKey").asText(null);
    java.util.List<com.workplace.messaging.dto.ProjectCandidateDto> cands =
        new java.util.ArrayList<>();
    if (p.has("candidates") && p.get("candidates").isArray()) {
      for (JsonNode c : p.get("candidates")) {
        cands.add(
            new com.workplace.messaging.dto.ProjectCandidateDto(
                c.path("key").asText(null), c.path("name").asText(null)));
      }
    }
    // 일정(calendar.create_event) 전용 필드 — payload 에서 추출(없으면 null).
    java.util.List<com.workplace.messaging.dto.EventConflictDto> conflicts =
        new java.util.ArrayList<>();
    if (p.has("conflicts") && p.get("conflicts").isArray()) {
      for (JsonNode c : p.get("conflicts")) {
        conflicts.add(
            new com.workplace.messaging.dto.EventConflictDto(
                c.path("id").asLong(),
                c.path("title").asText(null),
                c.path("startsAt").asText(null),
                c.path("endsAt").asText(null)));
      }
    }

    return new MessageProposalResponse(
        r.id(),
        r.proposedByUserId(),
        r.actionType(),
        r.status(),
        p.path("title").asText(null),
        p.path("priority").asText(null),
        p.path("projectName").asText(null),
        r.resultIssueKey(),
        projectKey,
        cands,
        p.path("startsAt").asText(null),
        p.path("endsAt").asText(null),
        p.path("location").asText(null),
        p.has("allDay") ? p.path("allDay").asBoolean(false) : null,
        conflicts.isEmpty() ? null : conflicts);
  }

  /**
   * L3 위임 제안용 단건 조회 — findOne 에 proposal enrich 를 추가로 통과시켜 반환. MessagingProposalService 에서 INSERT
   * proposal 직후 호출하므로 proposal 이 포함된 응답을 보장. 패키지-가시(package-private): 동일 패키지인
   * MessagingProposalService 에서만 사용.
   */
  MessageResponse findOneForProposal(long messageId, long callerId) {
    MessageResponse m = findOne(messageId, callerId);
    // enrichProposals 는 MessagePage 를 받으므로 단건 래핑 후 첫 번째 아이템 반환.
    return enrichProposals(new MessagePage(java.util.List.of(m), null, false)).items().get(0);
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
    // 드라이브 링크 단건 hydrate.
    var driveLinks = driveLinkService.listLinks("MESSAGE", messageId);
    return response
        .withAttachments(attMap.getOrDefault(messageId, java.util.List.of()))
        .withDriveLinks(driveLinks);
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

  /**
   * 채널 멤버십 검증 후 메시지에 첨부된 드라이브 파일 콘텐츠 반환. 채널 멤버십이 다운로드 인가 기준이다.
   *
   * <p>보안: messageId 가 channelId 에 속하는지 추가 검증 — 순차 ID 를 이용한 크로스채널 정보 유출 차단.
   */
  @Transactional(readOnly = true)
  public FileUploadService.FileContentResult driveLinkContent(
      long callerId, long channelId, long messageId, long driveFileId) throws IOException {
    ensureMember(channelId, callerId); // 채널 멤버십 = 다운로드 인가
    // 메시지가 해당 채널 소속인지 확인 — 다른 채널의 messageId 를 주입한 크로스채널 접근 차단
    if (!messageRepo.belongsToChannel(messageId, channelId))
      throw new MessageNotFoundException(messageId);
    return driveLinkService.getLinkContent("MESSAGE", messageId, driveFileId);
  }

  private void ensureMember(long channelId, long userId) {
    if (!memberRepo.isMember(channelId, userId))
      throw new ChannelNotMemberException(channelId, userId);
  }
}

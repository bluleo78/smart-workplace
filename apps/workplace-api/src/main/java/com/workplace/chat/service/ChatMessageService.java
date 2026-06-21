package com.workplace.chat.service;

import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.exception.EmptyChatMessageException;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadProgressEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadReadEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.service.UserMentionHydrator;
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
  private final UserMentionHydrator userMentionHydrator;
  private final ChatThreadContextResolver contextResolver;
  private final ApplicationEventPublisher publisher;
  // #358: 첨부 바인딩 + 하이드레이션용 서비스/레포.
  private final ChatMessageAttachmentService attachmentService;
  private final ChatMessageAttachmentRepository attachmentRepo;
  // #358: 드라이브 교차링크 생성/조회. DriveLinkService 는 drive 도메인이나 messaging 과 동일하게 직접 주입.
  private final DriveLinkService driveLinkService;

  /**
   * Thread member 가 메시지 작성. 빈 메시지(본문도 첨부도 드라이브링크도 없음) 거부. 첨부/드라이브링크 바인딩 후 하이드레이트된 응답 반환. mention 파싱
   * 후 INSERT, AFTER_COMMIT 이벤트 발행.
   */
  @Transactional
  public ChatMessageResponse create(long callerId, long threadId, CreateChatMessageRequest req) {
    ensureMember(threadId, callerId);
    // 빈 메시지 거부: 본문·첨부·드라이브 링크가 모두 없으면 작성 불가 (400).
    boolean bodyEmpty = req.body() == null || req.body().isBlank();
    if (bodyEmpty && req.fileIds().isEmpty() && req.driveFileIds().isEmpty()) {
      throw new EmptyChatMessageException();
    }
    // body 가 null 일 수 있어 빈 문자열로 방어 후 멘션 파싱.
    List<Long> mentionUserIds =
        userMentionHydrator.filterExistingUserIds(
            MentionParser.parse(req.body() == null ? "" : req.body()));

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
    // 선업로드 첨부 바인딩 + 영구 승격(같은 트랜잭션 — RLS 컨텍스트 공유).
    attachmentService.bindToMessage(callerId, messageId, req.fileIds());
    // 드라이브 파일 교차링크 — 발신자 thread 멤버 + 각 파일 ≥VIEWER 검증은 createLink 내부.
    for (Long driveFileId : req.driveFileIds()) {
      driveLinkService.createLink(callerId, driveFileId, "CHAT_MESSAGE", messageId);
    }

    // 첨부·드라이브 링크 하이드레이트 포함 응답 생성(같은 트랜잭션 내 — RLS 안전).
    ChatMessageResponse saved = findOne(messageId);
    publisher.publishEvent(
        buildEvent(threadId, messageId, callerId, req.body(), mentionUserIds, saved));
    return saved;
  }

  /** 본인만 수정. mention 재파싱. edited_at 갱신. */
  @Transactional
  public ChatMessageResponse update(long callerId, long messageId, UpdateChatMessageRequest req) {
    long authorId =
        messageRepo
            .findAuthorId(messageId)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    if (authorId != callerId) throw new ChatMessageAuthorMismatchException(messageId, callerId);
    List<Long> mentionUserIds =
        userMentionHydrator.filterExistingUserIds(MentionParser.parse(req.body()));
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

  // readOnly 트랜잭션 — ensureMember(chat_thread_member)·findPage(chat_message) 가 모두 RLS 보호 테이블이라,
  // 트랜잭션이 없으면 GUC 미주입 autocommit 연결로 fail-closed(빈 결과/멤버 아님)된다. doBegin 이 readOnly 트랜잭션에도
  // GUC 를 주입하므로 @Transactional(readOnly) 로 RLS 컨텍스트를 확보한다.
  @Transactional(readOnly = true)
  public ChatMessagePage list(long callerId, long threadId, String cursor, int limit) {
    ensureMember(threadId, callerId);
    ChatMessagePage page =
        messageRepo.findPage(threadId, cursor, limit, userMentionHydrator::asMentionResponses);
    return enrichAttachments(page);
  }

  @Transactional
  public void markRead(long callerId, long threadId, long uptoMessageId) {
    ensureMember(threadId, callerId);
    memberRepo.markRead(threadId, callerId, uptoMessageId);
    publisher.publishEvent(new ChatThreadReadEvent(threadId, callerId, uptoMessageId));
  }

  /**
   * 타이핑 알림 — DB 저장 없이 transient 이벤트만 발행. 단, 이벤트 발행 전 ensureMember 가 RLS 보호 테이블 chat_thread_member 를
   * 읽으므로 readOnly 트랜잭션으로 감싸 GUC(app.tenant_id)를 주입한다. 트랜잭션이 없으면 이 멤버십 조회가 fail-closed 되어 매 호출이
   * NotMember 로 예외 발생한다. onTyping 은 일반 @EventListener(AFTER_COMMIT 아님)라 트랜잭션화해도 이벤트가 유실되지 않는다(트랜잭션
   * 종료 전 동기 발행).
   */
  @Transactional(readOnly = true)
  public void notifyTyping(long callerId, long threadId) {
    ensureMember(threadId, callerId);
    publisher.publishEvent(new ChatThreadTypingEvent(threadId, hydrator.summaryOf(callerId)));
  }

  /**
   * 진행 알림 — DB 저장 없이 transient 이벤트만 발행. ai-agent 가 X-On-Behalf-Of 로 AGENT 자격을 받아 호출한다. notifyTyping
   * 과 동일하게 readOnly 트랜잭션으로 ensureMember(RLS 보호 테이블 읽기)를 감싼다.
   */
  @Transactional(readOnly = true)
  public void notifyProgress(
      long callerId, long threadId, String streamId, String phase, Object steps) {
    ensureMember(threadId, callerId);
    String name = hydrator.summaryOf(callerId).name();
    publisher.publishEvent(
        new ChatThreadProgressEvent(threadId, callerId, name, streamId, phase, steps));
  }

  /** 단일 메시지 조회 + 첨부·드라이브 링크 하이드레이션. RLS 트랜잭션 내에서만 호출해야 첨부가 보인다. */
  private ChatMessageResponse findOne(long messageId) {
    ChatMessageResponse base =
        messageRepo
            .findById(messageId, userMentionHydrator::asMentionResponses)
            .orElseThrow(() -> new ChatMessageNotFoundException(messageId));
    var amap = attachmentRepo.findByMessageIds(List.of(messageId));
    var dlinks = driveLinkService.listLinks("CHAT_MESSAGE", messageId);
    return base.withAttachments(amap.getOrDefault(messageId, List.of())).withDriveLinks(dlinks);
  }

  /** 페이지의 모든 메시지에 첨부·드라이브 링크를 배치 하이드레이트(N+1 회피). RLS 트랜잭션(@Transactional(readOnly)) 내에서 호출된다. */
  private ChatMessagePage enrichAttachments(ChatMessagePage page) {
    List<Long> ids = page.items().stream().map(ChatMessageResponse::id).toList();
    if (ids.isEmpty()) return page;
    var amap = attachmentRepo.findByMessageIds(ids);
    var dmap = driveLinkService.listLinksBatch("CHAT_MESSAGE", ids);
    List<ChatMessageResponse> items =
        page.items().stream()
            .map(
                m ->
                    m.withAttachments(amap.getOrDefault(m.id(), List.of()))
                        .withDriveLinks(dmap.getOrDefault(m.id(), List.of())))
            .toList();
    return new ChatMessagePage(items, page.nextCursor(), page.hasMore());
  }

  /**
   * 스레드 멤버가 메시지에 링크된 드라이브 파일 콘텐츠를 조회한다. 멤버십 검증 + 메시지-스레드 정합성 확인 후 DriveLinkService 에 위임. messaging
   * 의 MessageService.driveLinkContent 미러.
   */
  @Transactional(readOnly = true)
  public com.workplace.file.service.FileUploadService.FileContentResult driveLinkContent(
      long callerId, long threadId, long messageId, long driveFileId) throws java.io.IOException {
    ensureMember(threadId, callerId);
    if (!messageRepo.belongsToThread(messageId, threadId)) {
      throw new ChatMessageNotFoundException(messageId);
    }
    return driveLinkService.getLinkContent("CHAT_MESSAGE", messageId, driveFileId);
  }

  private void ensureMember(long threadId, long userId) {
    if (!memberRepo.isMember(threadId, userId))
      throw new ChatThreadNotMemberException(threadId, userId);
  }

  /** 메시지 생성 이벤트 빌드. 하이드레이트된 saved 에서 첨부/드라이브링크를 꺼내 이벤트에 동봉 — SSE 수신자가 추가 조회 없이 렌더 가능. */
  private ChatMessageCreatedEvent buildEvent(
      long threadId,
      long messageId,
      long actorId,
      String body,
      List<Long> mentionUserIds,
      ChatMessageResponse saved) {
    var context = contextResolver.resolve(threadId);
    UserSummary actor = hydrator.summaryOf(actorId);
    List<UserSummary> mentions = hydrator.summariesOf(mentionUserIds);
    return new ChatMessageCreatedEvent(
        threadId,
        messageId,
        context.issueId(),
        context.projectKey(),
        context.issueKey(),
        context.issueTitle(),
        context.issueStatus(),
        context.issueBody(),
        actor,
        body,
        mentions,
        saved.attachments(),
        saved.driveLinks(),
        Instant.now());
  }
}

package com.workplace.chat.service;

import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.chat.exception.ChatThreadIssueDeletedException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.exception.EmptyChatMessageException;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadProgressEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadReadEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.outbound.ChatMessageOrigin;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.util.MentionParser;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.user.dto.UserKind;
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
  // #358: 첨부 바인딩.
  private final ChatMessageAttachmentService attachmentService;
  // 첨부·드라이브 링크 하이드레이션(WP-102 — 스레드 최근 메시지와 공용).
  private final ChatMessageHydrator messageHydrator;
  // #358: 드라이브 교차링크 생성·원본 조회(목록 하이드레이션은 messageHydrator). messaging 과 동일하게 직접 주입.
  private final DriveLinkService driveLinkService;
  // #621: 스레드에 연결된 이슈가 삭제됐는지 확인하는 가드용 조회.
  private final IssueStakeholderLookup issueLookup;
  // WP-213: 이슈 토크 읽기/쓰기 접근 판정 + 보낼 때 자동 참여.
  private final ChatThreadAccess threadAccess;

  /** 메시지 작성(화면·일반 API). 질문 표시는 받지 않는다 — 질문은 report_agent_work 만 만든다(스펙 §3.1). */
  @Transactional
  public ChatMessageResponse create(long callerId, long threadId, CreateChatMessageRequest req) {
    return doCreate(callerId, threadId, req, ChatMessageOrigin.USER);
  }

  /**
   * AI 작업 보고(report_agent_work)의 글(WP-373). question 을 생성과 함께 저장하고, 작성자가 사람이어도 "사람의 답"
   * (IssueHumanReplyPosted)으로 치지 않는다 — 사람이 자기 AI 도구로 남긴 진행 보고가 다른 AI 의 답변 필요를 풀면 안 된다(스펙 §3.2).
   */
  @Transactional
  public ChatMessageResponse createFromReport(
      long callerId, long threadId, String body, boolean question) {
    return doCreate(
        callerId,
        threadId,
        new CreateChatMessageRequest(body),
        question ? ChatMessageOrigin.REPORT_QUESTION : ChatMessageOrigin.REPORT);
  }

  /**
   * 메시지 작성 본체. 스레드 멤버가 아니어도 댓글 작성 권한이 있으면 이 시점에 대화에 자동 참여한다(WP-213). 빈 메시지(본문도 첨부도 드라이브링크도 없음) 거부.
   * 첨부/드라이브링크 바인딩 후 하이드레이트된 응답 반환. mention 파싱 후 INSERT, AFTER_COMMIT 이벤트 발행.
   */
  private ChatMessageResponse doCreate(
      long callerId, long threadId, CreateChatMessageRequest req, ChatMessageOrigin origin) {
    // 거부될 요청(권한 없음·삭제된 이슈·빈 메시지)으로는 대화에 참여시키지 않도록 쓰기 권한부터 확인하고, 참여는 검증을 모두 통과한 뒤 한다.
    var joinCtx = threadAccess.ensureCanWrite(threadId, callerId);
    // #621: 원본 이슈가 소프트삭제됐으면 스레드가 남아있어도 메시지 전송을 막는다.
    if (issueLookup.isIssueDeletedByThreadId(threadId)) {
      throw new ChatThreadIssueDeletedException(threadId);
    }
    // 빈 메시지 거부: 본문·첨부·드라이브 링크가 모두 없으면 작성 불가 (400).
    boolean bodyEmpty = req.body() == null || req.body().isBlank();
    if (bodyEmpty && req.fileIds().isEmpty() && req.driveFileIds().isEmpty()) {
      throw new EmptyChatMessageException();
    }
    // 같은 트랜잭션에서 먼저 참여시켜야 아래 드라이브 링크 생성의 멤버십 검사가 새 멤버를 본다.
    threadAccess.join(joinCtx, threadId, callerId);
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

    long messageId =
        messageRepo.insert(threadId, callerId, req.body(), mentionUserIds, origin.question());
    // 선업로드 첨부 바인딩 + 영구 승격(같은 트랜잭션 — RLS 컨텍스트 공유).
    attachmentService.bindToMessage(callerId, messageId, req.fileIds());
    // 드라이브 파일 교차링크 — 발신자 thread 멤버 + 각 파일 ≥VIEWER 검증은 createLink 내부.
    for (Long driveFileId : req.driveFileIds()) {
      driveLinkService.createLink(
          callerId, driveFileId, ChatMessageHydrator.SOURCE_TYPE, messageId);
    }

    // 첨부·드라이브 링크 하이드레이트 포함 응답 생성(같은 트랜잭션 내 — RLS 안전).
    ChatMessageResponse saved = findOne(messageId);
    var created =
        buildEvent(threadId, messageId, callerId, req.body(), mentionUserIds, saved, origin);
    publisher.publishEvent(created);
    // WP-377: 사람이 올린 글이면 답변 필요로 멈춘 AI 구성원 작업을 작업 중으로 되돌리도록 알린다. 보고 경로의 글은 제외(WP-373).
    if (!origin.fromReport() && UserKind.HUMAN.equals(created.actor().kind())) {
      publisher.publishEvent(new IssueHumanReplyPosted(created.issueId()));
    }
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

  /** cursor 모드(최신순 위로 스크롤) 기본 크기 — 화면이 쓰는 현행 값. */
  private static final int DEFAULT_PAGE = 50;

  /** after·afterMine 모드 기본 크기(스펙 §3.3). */
  private static final int DEFAULT_AFTER_PAGE = 30;

  private static final int MAX_PAGE = 100;

  /**
   * 메시지 목록. cursor(최신순 이전 페이지)·after(그 뒤 오름차순)·afterMine(내 마지막 글 직전 5개 + 그 뒤) 셋 중 하나만 쓴다 — 둘 이상이면
   * IllegalArgumentException(400). 읽기는 스레드 조회(getOrCreate)와 같은 권한 — 비멤버도 과거 메시지를 스크롤해 볼 수 있어야
   * 한다(WP-213). readOnly 트랜잭션 — 읽기 권한 확인(chat_thread_member 등)·조회(chat_message)가 모두 RLS 보호 테이블이라,
   * 트랜잭션이 없으면 GUC 미주입 autocommit 연결로 fail-closed(빈 결과/멤버 아님)된다. doBegin 이 readOnly 트랜잭션에도 GUC 를
   * 주입한다.
   */
  @Transactional(readOnly = true)
  public ChatMessagePage list(
      long callerId, long threadId, String cursor, Long after, boolean afterMine, Integer limit) {
    boolean hasCursor = cursor != null && !cursor.isEmpty();
    int modes = (hasCursor ? 1 : 0) + (after != null ? 1 : 0) + (afterMine ? 1 : 0);
    if (modes > 1) {
      throw new IllegalArgumentException("cursor·after·afterMine 은 하나만 줄 수 있습니다");
    }
    threadAccess.ensureCanRead(threadId, callerId);
    boolean ascending = after != null || afterMine;
    int requested = limit == null ? (ascending ? DEFAULT_AFTER_PAGE : DEFAULT_PAGE) : limit;
    int size = Math.max(1, Math.min(requested, MAX_PAGE));
    ChatMessageRepository.MentionResolver resolver = userMentionHydrator::asMentionResponses;
    ChatMessagePage page =
        after != null
            ? messageRepo.findAfter(threadId, after, size, resolver)
            : afterMine
                ? messageRepo.findAroundOwnLast(threadId, callerId, size, resolver)
                : messageRepo.findPage(threadId, cursor, size, resolver);
    return messageHydrator.hydrate(page);
  }

  @Transactional
  public void markRead(long callerId, long threadId, long uptoMessageId) {
    // 대화에 참여하지 않은 열람자는 읽음 위치를 저장할 멤버 row 가 없다 — 오류 대신 조용히 무시(WP-213).
    if (!memberRepo.isMember(threadId, callerId)) return;
    memberRepo.markRead(threadId, callerId, uptoMessageId);
    publisher.publishEvent(new ChatThreadReadEvent(threadId, callerId, uptoMessageId));
  }

  /**
   * 타이핑 알림 — DB 저장 없이 transient 이벤트만 발행. 단, 이벤트 발행 전 쓰기 권한 확인이 RLS 보호 테이블 chat_thread_member 를 읽으므로
   * readOnly 트랜잭션으로 감싸 GUC(app.tenant_id)를 주입한다. 트랜잭션이 없으면 이 멤버십 조회가 fail-closed 되어 매 호출이 NotMember
   * 로 예외 발생한다. onTyping 은 일반 @EventListener(AFTER_COMMIT 아님)라 트랜잭션화해도 이벤트가 유실되지 않는다(트랜잭션 종료 전 동기
   * 발행).
   */
  @Transactional(readOnly = true)
  public void notifyTyping(long callerId, long threadId) {
    // 쓰기 권한만 확인하고 참여시키지는 않는다 — 입력만 하고 보내지 않을 수 있다(WP-213).
    threadAccess.ensureCanWrite(threadId, callerId);
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
    return messageHydrator.hydrate(base);
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
    return driveLinkService.getLinkContent(ChatMessageHydrator.SOURCE_TYPE, messageId, driveFileId);
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
      ChatMessageResponse saved,
      ChatMessageOrigin origin) {
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
        saved.question(),
        origin,
        Instant.now());
  }
}

package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSummaryResponse;
import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.event.InlineContentIdBackfillRequestedEvent;
import com.workplace.mail.event.MessageMarkedReadEvent;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** 받은편지함 조회(목록·검색·상세). 모든 조회는 본인 소유 계정/메시지로 격리한다. 단건 조회(get) 시 DB seen=true 자동 업데이트(읽음 처리). */
@Service
public class MailMessageService {

  /** 목록 기본/최대 건수. */
  private static final int DEFAULT_LIMIT = 50;

  private static final int MAX_LIMIT = 200;

  private final EmailAccountRepository accountRepo;
  private final EmailMessageRepository messageRepo;
  private final MailBodyFetcher bodyFetcher;
  private final MailSyncProgress progress;
  private final ApplicationEventPublisher eventPublisher;
  private final MailChangeNotifier notifier;

  /** WP-68: 첨부 행이 없는 인라인 전용 Graph 메일의 첨부 목록 즉시 적재. */
  private final MailInlineContentIdBackfiller inlineBackfiller;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary {@code TenantAwareTransactionManager} 로 구성해 트랜잭션 진입 시
   * RLS GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate txTemplate;

  public MailMessageService(
      EmailAccountRepository accountRepo,
      EmailMessageRepository messageRepo,
      MailBodyFetcher bodyFetcher,
      MailSyncProgress progress,
      ApplicationEventPublisher eventPublisher,
      MailInlineContentIdBackfiller inlineBackfiller,
      MailChangeNotifier notifier,
      PlatformTransactionManager txManager) {
    this.accountRepo = accountRepo;
    this.messageRepo = messageRepo;
    this.bodyFetcher = bodyFetcher;
    this.progress = progress;
    this.eventPublisher = eventPublisher;
    this.inlineBackfiller = inlineBackfiller;
    this.notifier = notifier;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 계정의 메시지 목록(폴더 스코프·최신순·선택 검색어·#466 unread·P2 category/needsReply 필터). 계정이 본인 소유가 아니면 404. */
  @Transactional(readOnly = true)
  public List<EmailMessageSummary> list(
      long userId,
      long accountId,
      String folder,
      String query,
      boolean unread,
      String category,
      boolean needsReply,
      int limit) {
    accountRepo
        .findByIdAndUser(userId, accountId)
        .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    int effective = limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
    String folderName = (folder == null || folder.isBlank()) ? "INBOX" : folder;
    return messageRepo.listByAccount(
        accountId, folderName, query, unread, category, needsReply, effective);
  }

  /** 사이드바용 계정단위 회신필요 건수(단일 술어: AI 판정 true + 안 읽음). 계정이 본인 소유가 아니면 404. */
  @Transactional(readOnly = true)
  public long countNeedsReplyForAccount(long userId, long accountId) {
    accountRepo
        .findByIdAndUser(userId, accountId)
        .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    return messageRepo.countNeedsReplyForAccount(accountId);
  }

  /**
   * 홈 위젯용 메일 요약 — 본인 INBOX 안읽음 수 + 회신 필요 수 + 분류 활성 여부 + 최근 안읽은 메일 N건(#474).
   *
   * <p>RLS GUC(app.tenant_id)는 트랜잭션-로컬({@code set_config(...,true)})이라 반드시 트랜잭션 경계 안에서 읽어야 한다. 경계가
   * 없으면 GUC 미주입 → RLS fail-closed 로 0행이 되는 버그(#444). 네 읽기 모두 하나의 읽기 전용 트랜잭션으로 묶어 GUC 주입을 보장한다.
   */
  @Transactional(readOnly = true)
  public MailSummaryResponse summary(long userId, int recentLimit) {
    return new MailSummaryResponse(
        messageRepo.countUnread(userId),
        messageRepo.countNeedsReply(userId),
        accountRepo.existsAiEnabledAccount(userId),
        messageRepo.listRecentUnread(userId, recentLimit));
  }

  /**
   * 메시지 단건 상세. 본인 소유가 아니거나 없으면 404. 본문이 미적재(text/html 모두 null)면 OnDemand 로 IMAP 에서 적재 후 다시 읽어 반환한다.
   *
   * <p>RLS GUC(app.tenant_id)는 트랜잭션-로컬이므로 각 DB 접근을 짧은 트랜잭션({@code txTemplate})으로 감싼다 — 없으면 첫 RLS
   * 스코프 SELECT 가 빈 결과 → 거짓 404. 미적재 본문 적재({@link MailBodyFetcher#fetchBody})는 IMAP 왕복을 포함하므로 메시지 단위
   * 짧은 트랜잭션으로 감싸(backfill 과 동일 패턴) 커넥션 점유를 그 메시지 적재 구간으로 한정한다. 본문 적재가 필요 없는 warm 경로에서는 DB 커넥션을
   * 조회/읽음처리 사이에 즉시 반납한다(#232).
   *
   * @param markSeen false 면 읽음 처리·역동기화 생략(AI 조회, WP-147)
   */
  public EmailMessageDetail get(long userId, long messageId, boolean markSeen) {
    EmailMessageDetail detail = loadDetail(userId, messageId);
    if (detail.bodyText() == null && detail.bodyHtml() == null) {
      // 미적재 대상 조회는 짧은 트랜잭션으로. 로컬 보낸메일(서버 좌표 없음)/이미 적재된 건은 가드로 스킵.
      BodyTarget target =
          txTemplate.execute(
              status ->
                  messageRepo
                      .findBodyTargetForUser(userId, messageId)
                      // WP-130: Graph(provider_message_id)도 온디맨드 적재 — 적재·검증 전엔 공유 본문이 가려진다
                      .filter(
                          t ->
                              t.bodyFetchedAt() == null
                                  && (t.imapUid() != 0 || t.providerMessageId() != null))
                      .orElse(null));
      // 본문 적재(IMAP I/O + 소유 검증·쓰기)는 메시지 단위 짧은 트랜잭션으로 감싼다 — fetchBody 의 RLS write 에 GUC 가 주입되도록.
      if (target != null) {
        txTemplate.executeWithoutResult(status -> bodyFetcher.fetchBody(userId, target));
      }
      detail = loadDetail(userId, messageId);
    }
    // WP-68: 인라인 이미지만 있어 첨부 행이 없는 Graph 레거시 메일 — 본문 온디맨드 적재처럼 즉시 채우고 다시 읽는다
    if (detail.attachments().isEmpty()
        && InlineImageSupport.refsCid(detail.bodyHtml())
        && inlineBackfiller.loadMissingAttachmentsNow(userId, messageId)) {
      detail = loadDetail(userId, messageId);
    }
    requestContentIdBackfillIfNeeded(userId, detail);
    // 읽음 처리 — markSeen(웹 열람)이고 seen=false 일 때만. AI 조회(markSeen=false)는 건너뛴다(WP-147).
    if (markSeen && !detail.seen()) {
      txTemplate.executeWithoutResult(status -> messageRepo.markSeen(messageId));
      publishMarkedRead(userId, messageId);
      detail =
          new EmailMessageDetail(
              detail.id(),
              detail.threadId(),
              detail.messageId(),
              detail.fromAddress(),
              detail.fromName(),
              detail.toAddresses(),
              detail.ccAddresses(),
              detail.bccAddresses(),
              detail.subject(),
              detail.sentAt(),
              detail.receivedAt(),
              true, // seen=true
              detail.bodyText(),
              detail.bodyHtml(),
              detail.attachments());
    }
    return detail;
  }

  /**
   * 명시적 읽음 처리(WP-146, MCP mark_mail_read). 본인 메일이 아니면 404. 이미 읽었으면 아무것도 하지 않는다(멱등 — 역동기화·
   * resource.changed 재발행 없음). 읽음으로 바뀌면 열려 있는 웹 탭이 목록·카운트를 갱신하도록 mail updated 를 소유자에게 보낸다.
   */
  public void markRead(long userId, long messageId) {
    // 소유 확인(없으면 404)과 읽음 갱신을 한 트랜잭션으로 처리한다. UPDATE 반환 행 수로 "이번에 읽음으로 바뀐 건"만 판별(동시 호출에서도 한 번만 발행).
    // MailChangeNotifier 는 트랜잭션 안에서 호출해야 한다(AFTER_COMMIT 디스패처는 트랜잭션 밖 발행을 유실) — markSeen 과 같은 트랜잭션.
    Boolean changed =
        txTemplate.execute(
            status -> {
              BodyTarget target =
                  messageRepo
                      .findBodyTargetForUser(userId, messageId)
                      .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
              if (messageRepo.markSeen(messageId) <= 0) {
                return false;
              }
              notifier.mailChanged(userId, target.accountId(), messageId, userId);
              return true;
            });
    if (Boolean.TRUE.equals(changed)) {
      publishMarkedRead(userId, messageId);
    }
  }

  /** 역동기화 이벤트 발행 공용부 — TenantContext 가 null 이면 내부 경로이므로 생략(방어적). */
  private void publishMarkedRead(long userId, long messageId) {
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      eventPublisher.publishEvent(new MessageMarkedReadEvent(tenantId, userId, messageId));
    }
  }

  /**
   * 본문이 cid: 를 참조하는데 Content-ID 가 비어 있는 이미지 첨부가 있으면 지연 백필을 요청한다(WP-68). 대상 판정(Graph 계정·조회 가능 여부)은
   * 리스너가 다시 하므로 여기선 값싼 사전 필터만 둔다. TenantContext 가 없으면 내부 경로이므로 생략.
   */
  private void requestContentIdBackfillIfNeeded(long userId, EmailMessageDetail detail) {
    // 첨부 검사(대개 false)를 먼저 — 대부분의 열람이 본문 HTML 스캔 없이 끝난다
    boolean missing =
        detail.attachments().stream()
            .anyMatch(a -> a.contentId() == null && InlineImageSupport.isImage(a.contentType()));
    if (!missing || !InlineImageSupport.refsCid(detail.bodyHtml())) {
      return;
    }
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      eventPublisher.publishEvent(
          new InlineContentIdBackfillRequestedEvent(tenantId, userId, detail.id()));
    }
  }

  /** 상세 단건을 짧은 트랜잭션으로 조회(RLS GUC 주입). 없으면 404. */
  private EmailMessageDetail loadDetail(long userId, long messageId) {
    return txTemplate.execute(
        status ->
            messageRepo
                .findDetailByIdAndUser(userId, messageId)
                .orElseThrow(() -> new EmailMessageNotFoundException(messageId)));
  }

  /** 계정 동기화 진행 상태(폴링용). 계정이 본인 소유가 아니면 404. */
  @Transactional(readOnly = true)
  public MailSyncStatus syncStatus(long userId, long accountId) {
    accountRepo
        .findByIdAndUser(userId, accountId)
        .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    return progress.snapshot(accountId);
  }
}

package com.workplace.mail.service;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSummaryResponse;
import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
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
      PlatformTransactionManager txManager) {
    this.accountRepo = accountRepo;
    this.messageRepo = messageRepo;
    this.bodyFetcher = bodyFetcher;
    this.progress = progress;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 계정의 메시지 목록(폴더 스코프·최신순·선택 검색어). 계정이 본인 소유가 아니면 404. */
  @Transactional(readOnly = true)
  public List<EmailMessageSummary> list(
      long userId, long accountId, String folder, String query, int limit) {
    accountRepo
        .findByIdAndUser(userId, accountId)
        .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    int effective = limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
    String folderName = (folder == null || folder.isBlank()) ? "INBOX" : folder;
    return messageRepo.listByAccount(accountId, folderName, query, effective);
  }

  /**
   * 홈 위젯용 메일 요약 — 본인 INBOX 안읽음 수 + 최근 안읽은 메일 N건.
   *
   * <p>RLS GUC(app.tenant_id)는 트랜잭션-로컬({@code set_config(...,true)})이라 반드시 트랜잭션 경계 안에서 읽어야 한다. 경계가
   * 없으면 GUC 미주입 → RLS fail-closed 로 0행이 되어 안읽음이 항상 0으로 보이는 버그(#444). countUnread· listRecentUnread
   * 두 읽기를 하나의 읽기 전용 트랜잭션으로 묶어 GUC 주입을 보장한다.
   */
  @Transactional(readOnly = true)
  public MailSummaryResponse summary(long userId, int recentLimit) {
    return new MailSummaryResponse(
        messageRepo.countUnread(userId), messageRepo.listRecentUnread(userId, recentLimit));
  }

  /**
   * 메시지 단건 상세. 본인 소유가 아니거나 없으면 404. 본문이 미적재(text/html 모두 null)면 OnDemand 로 IMAP 에서 적재 후 다시 읽어 반환한다.
   *
   * <p>RLS GUC(app.tenant_id)는 트랜잭션-로컬이므로 각 DB 접근을 짧은 트랜잭션({@code txTemplate})으로 감싼다 — 없으면 첫 RLS
   * 스코프 SELECT 가 빈 결과 → 거짓 404. 미적재 본문 적재({@link MailBodyFetcher#fetchBody})는 IMAP 왕복을 포함하므로 메시지 단위
   * 짧은 트랜잭션으로 감싸(backfill 과 동일 패턴) 커넥션 점유를 그 메시지 적재 구간으로 한정한다. 본문 적재가 필요 없는 warm 경로에서는 DB 커넥션을
   * 조회/읽음처리 사이에 즉시 반납한다(#232).
   */
  public EmailMessageDetail get(long userId, long messageId) {
    EmailMessageDetail detail = loadDetail(userId, messageId);
    if (detail.bodyText() == null && detail.bodyHtml() == null) {
      // 미적재 대상 조회는 짧은 트랜잭션으로. imap_uid 없는 로컬 보낸메일/이미 적재된 건은 가드로 스킵.
      BodyTarget target =
          txTemplate.execute(
              status ->
                  messageRepo
                      .findBodyTargetForUser(userId, messageId)
                      .filter(t -> t.bodyFetchedAt() == null && t.imapUid() != 0)
                      .orElse(null));
      // 본문 적재(IMAP I/O + 소유 검증·쓰기)는 메시지 단위 짧은 트랜잭션으로 감싼다 — fetchBody 의 RLS write 에 GUC 가 주입되도록.
      if (target != null) {
        txTemplate.executeWithoutResult(status -> bodyFetcher.fetchBody(userId, target));
      }
      detail = loadDetail(userId, messageId);
    }
    // 읽음 처리 — seen=false 인 메시지를 true 로 업데이트하고 DTO 도 동기화
    if (!detail.seen()) {
      txTemplate.executeWithoutResult(status -> messageRepo.markSeen(messageId));
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

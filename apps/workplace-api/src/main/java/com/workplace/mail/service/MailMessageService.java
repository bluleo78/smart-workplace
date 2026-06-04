package com.workplace.mail.service;

import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 받은편지함 읽기(목록·검색·상세). 모든 조회는 본인 소유 계정/메시지로 격리한다. 읽기 전용 — \Seen 등 서버 상태 변경은 하지 않는다(v1). */
@Service
@RequiredArgsConstructor
public class MailMessageService {

  /** 목록 기본/최대 건수. */
  private static final int DEFAULT_LIMIT = 50;

  private static final int MAX_LIMIT = 200;

  private final EmailAccountRepository accountRepo;
  private final EmailMessageRepository messageRepo;
  private final MailBodyFetcher bodyFetcher;
  private final MailSyncProgress progress;

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
   * 메시지 단건 상세. 본인 소유가 아니거나 없으면 404. 본문이 미적재(text/html 모두 null)면 OnDemand 로 IMAP 에서 적재 후 다시 읽어 반환한다.
   *
   * <p>트랜잭션 미선언: {@link MailBodyFetcher} 는 IMAP 왕복 동안 DB 커넥션을 점유하지 않도록 트랜잭션 밖에서 동작해야 한다. 메서드에 트랜잭션을
   * 걸면 그 계약을 깨고, 읽기전용이면 적재 쓰기가 조용히 실패한다. 적재 후 재조회로 본문을 반영한다.
   */
  public EmailMessageDetail get(long userId, long messageId) {
    EmailMessageDetail detail =
        messageRepo
            .findDetailByIdAndUser(userId, messageId)
            .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
    if (detail.bodyText() == null && detail.bodyHtml() == null) {
      // 미적재 대상이면 IMAP 에서 본문 적재(소유 검증 포함). imap_uid 없는 로컬 보낸메일/이미 적재된 건은 가드로 스킵.
      messageRepo
          .findBodyTargetForUser(userId, messageId)
          .filter(t -> t.bodyFetchedAt() == null && t.imapUid() != 0)
          .ifPresent(t -> bodyFetcher.fetchBody(userId, t));
      detail =
          messageRepo
              .findDetailByIdAndUser(userId, messageId)
              .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
    }
    return detail;
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

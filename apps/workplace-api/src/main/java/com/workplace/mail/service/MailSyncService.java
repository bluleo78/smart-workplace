package com.workplace.mail.service;

import static java.util.stream.Collectors.toMap;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 동기화 오케스트레이터 — 공급자 중립(provider-neutral). 공급자별 실제 페치 로직은 {@link MailFetcher} 구현체(예: {@link
 * ImapMailFetcher})로 위임한다(#499 seam 추출).
 *
 * <p>본 서비스는 (1) 계정 소유 검증 (2) 동시 동기화 가드 (3) 공급자 디스패치 (4) 본문 백필 트리거 (5) last_synced_at 갱신 (6) 선제 요약
 * 트리거 를 담당한다. 공급자별 자격증명 해석·네트워크 I/O 는 {@link MailFetcher#fetchNewMessages} 내부 책임이다.
 *
 * <p>RLS GUC(app.tenant_id)는 트랜잭션-로컬이라 소유 검증 SELECT·메시지 insert 등 DB 접근을 짧은 트랜잭션({@code
 * txTemplate})으로 감싼다.
 */
@Slf4j
@Service
public class MailSyncService {

  private final EmailAccountRepository accountRepo;
  private final EmailMessageRepository messageRepo;
  private final MailSyncProgress progress;
  private final MailBackfillService backfillService;

  /** 선제 배치 요약 서비스 — 동기화 완료 후 @Async 로 새 안읽은 메일을 미리 요약. */
  private final MailSummaryBackfillService summaryBackfillService;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary {@code TenantAwareTransactionManager} 로 구성해 트랜잭션 진입 시
   * RLS GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate txTemplate;

  /** 공급자 → fetcher 맵. Spring 이 MailFetcher 빈 목록을 자동 주입한다. */
  private final Map<MailProvider, MailFetcher> fetchers;

  public MailSyncService(
      EmailAccountRepository accountRepo,
      EmailMessageRepository messageRepo,
      MailSyncProgress progress,
      MailBackfillService backfillService,
      MailSummaryBackfillService summaryBackfillService,
      PlatformTransactionManager txManager,
      List<MailFetcher> fetchers) {
    this.accountRepo = accountRepo;
    this.messageRepo = messageRepo;
    this.progress = progress;
    this.backfillService = backfillService;
    this.summaryBackfillService = summaryBackfillService;
    this.txTemplate = new TransactionTemplate(txManager);
    this.fetchers = fetchers.stream().collect(toMap(MailFetcher::provider, f -> f));
  }

  /**
   * 본인 계정 INBOX 의 목록 메타를 동기화(본문 제외). 소유 아니면 404, 메일 서버 오류면 502. 이미 진행 중이면 빈 결과 반환(가드 — 진행률은
   * sync-status 로 확인). 완료 후 미적재 본문이 있으면 비동기 백그라운드 보충을 트리거한다.
   */
  public MailSyncResult sync(long userId, long accountId) {
    EmailAccountResponse account =
        txTemplate.execute(
            status ->
                accountRepo
                    .findByIdAndUser(userId, accountId)
                    .orElseThrow(() -> new EmailAccountNotFoundException(accountId)));

    // 계정당 동시 실행 가드 — try 진입 전에 점유 시도. 이미 진행 중이면 즉시 빈 결과.
    if (!progress.tryStart(accountId)) {
      return new MailSyncResult(0, 0);
    }
    boolean triggeredBackfill = false;
    try {
      MailFetcher fetcher = fetchers.get(account.provider());
      if (fetcher == null) {
        throw new MailSyncException("지원하지 않는 메일 공급자: " + account.provider());
      }
      MailSyncResult result = fetcher.fetchNewMessages(userId, accountId, account); // ← seam

      // 미적재 본문이 있으면 본문 보충 단계로 전환 + 비동기 트리거(완료 시 backfill 이 progress.finish 수행).
      int missing = txTemplate.execute(status -> messageRepo.countMissingBody(accountId));
      if (missing > 0) {
        // 한 회 보충 상한까지만 진행률로 표기한다 — 백필은 BATCH_LIMIT 만 처리하므로(잔여는 다음 sync)
        // 진행바가 "본문 200/250" 후 사라져 오해를 주지 않도록 total 을 상한으로 보정한다.
        int shown = Math.min(missing, MailBackfillService.BATCH_LIMIT);
        progress.startBodies(accountId, shown);
        backfillService.backfill(userId, accountId);
        triggeredBackfill = true;
      }
      // 동기화 성공 — 마지막 동기화 시각 기록(자동·수동 공통). tx-local GUC 위해 txTemplate 사용.
      txTemplate.executeWithoutResult(
          status -> accountRepo.updateLastSyncedAt(accountId, OffsetDateTime.now()));
      // 동기화로 적재된 새 메일을 선제 요약(@Async — 짧은 TX 들이 모두 커밋된 뒤 별도 스레드에서 실행되어 새 메일이 가시). best-effort.
      // AI 게이트는 계정 단위(ai_enabled) — 호출자가 책임진다. 백필 유닛의 자체 게이트(resolveSpecOrNull)는
      // 유저/비서 설정 단위라 계정 ai_enabled 와 어긋나므로, 여기서 OFF 계정을 미리 거른다(불필요한 IMAP fetch·요약 예외 스팸 방지).
      if (account.aiEnabled()) {
        summaryBackfillService.summarizeRecentUnread(userId, accountId);
      }
      return result;
    } finally {
      // 보충할 게 없거나 에러로 끝났으면 여기서 즉시 종료(백필을 트리거했다면 백필이 종료 책임).
      if (!triggeredBackfill) {
        progress.finish(accountId);
      }
    }
  }
}

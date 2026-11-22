package com.workplace.mail.service;

import static java.util.stream.Collectors.toMap;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.folder.MailFolderService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 동기화 오케스트레이터 — 공급자 중립(provider-neutral). 공급자별 실제 페치 로직은 {@link MailFetcher} 구현체(예: {@link
 * ImapMailFetcher})로 위임한다(#499 seam 추출).
 *
 * <p>본 서비스는 (1) 계정 소유 검증 (2) 동시 동기화 가드 (3) 공급자 디스패치 (4) 본문 백필 트리거 (5) last_synced_at 갱신 (6) 선제 요약
 * 트리거 (7) 서버 메일함 목록 갱신(WP-960, best-effort) (8) 커밋 뒤 새 메일 OS 푸시 발송(WP-1739, best-effort — 본문 보충을
 * 띄웠으면 보충이 끝난 뒤 보충이 보낸다) 을 담당한다. 공급자별 자격증명 해석·네트워크 I/O 는 {@link MailFetcher#fetchNewMessages} 내부
 * 책임이다.
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
  private final MailChangeNotifier notifier;

  /** 선제 배치 요약 서비스 — 동기화 완료 후 @Async 로 새 안읽은 메일을 미리 요약. */
  private final MailSummaryBackfillService summaryBackfillService;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary {@code TenantAwareTransactionManager} 로 구성해 트랜잭션 진입 시
   * RLS GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate txTemplate;

  /** 서버 메일함 목록 갱신(WP-960) — 받은편지함 동기화 뒤 best-effort 로 부른다. */
  private final MailFolderService folderService;

  /** 새 메일 OS 푸시 발송(WP-1739) — 동기화 트랜잭션 커밋 뒤, 동기화 전 경계(maxInboxId)와 함께 부른다. */
  private final MailPushService mailPushService;

  /** 공급자 → fetcher 맵. Spring 이 MailFetcher 빈 목록을 자동 주입한다. */
  private final Map<MailProvider, MailFetcher> fetchers;

  public MailSyncService(
      EmailAccountRepository accountRepo,
      EmailMessageRepository messageRepo,
      MailSyncProgress progress,
      MailBackfillService backfillService,
      MailChangeNotifier notifier,
      MailSummaryBackfillService summaryBackfillService,
      PlatformTransactionManager txManager,
      List<MailFetcher> fetchers,
      MailFolderService folderService,
      MailPushService mailPushService) {
    this.accountRepo = accountRepo;
    this.messageRepo = messageRepo;
    this.progress = progress;
    this.backfillService = backfillService;
    this.notifier = notifier;
    this.summaryBackfillService = summaryBackfillService;
    this.txTemplate = new TransactionTemplate(txManager);
    this.fetchers = fetchers.stream().collect(toMap(MailFetcher::provider, f -> f));
    this.folderService = folderService;
    this.mailPushService = mailPushService;
  }

  /** 동기화 시작 스냅샷(WP-1739) — 계정 정보와 동기화 <b>전</b> 받은편지함 최대 id(새 메일 판정 경계). 계정 조회와 같은 트랜잭션에서 함께 읽는다. */
  private record SyncStart(EmailAccountResponse account, long maxInboxId) {}

  /**
   * 본인 계정 INBOX 의 목록 메타를 동기화(본문 제외). 소유 아니면 404, 메일 서버 오류면 502. 이미 진행 중이면 빈 결과 반환(가드 — 진행률은
   * sync-status 로 확인). 완료 후 미적재 본문이 있으면 비동기 백그라운드 보충을 트리거한다.
   */
  public MailSyncResult sync(long userId, long accountId) {
    SyncStart start =
        txTemplate.execute(
            status -> {
              EmailAccountResponse account =
                  accountRepo
                      .findByIdAndUser(userId, accountId)
                      .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
              // WP-1739: 동기화 전 경계 id 를 계정 조회와 같은 트랜잭션에서 읽는다 — 뒤이은 fetch 가 행을 넣기
              // 전 값이어야 그 뒤부터가 「새 메일」이 된다(파라미터는 읽기만 하고 발송은 커밋 뒤에 한다).
              return new SyncStart(account, messageRepo.maxInboxId(accountId));
            });
    EmailAccountResponse account = start.account();
    long maxInboxId = start.maxInboxId();

    // 계정당 동시 실행 가드 — try 진입 전에 점유 시도. 이미 진행 중이면 즉시 빈 결과.
    // WP-1977: 선점하면 실행 핸들을 받는다 — 진행 쓰기·끝내기는 이 핸들로 해 만료 뒤 다시 선점된 새 실행을 덮지 않는다.
    Optional<MailJobRun> started = progress.tryStart(accountId);
    if (started.isEmpty()) {
      return new MailSyncResult(0, 0, 0);
    }
    MailJobRun run = started.get();
    boolean triggeredBackfill = false;
    try {
      MailFetcher fetcher = fetchers.get(account.provider());
      if (fetcher == null) {
        throw new MailSyncException("지원하지 않는 메일 공급자: " + account.provider());
      }
      MailSyncResult result = fetcher.fetchNewMessages(userId, accountId, account); // ← seam
      // WP-960: 받은편지함 동기화 뒤 서버 메일함 목록(보관·사용자 폴더·안 읽은 수)을 갱신한다. 실패해도 동기화 결과는 그대로다.
      boolean foldersChanged = refreshFoldersQuietly(userId, accountId, account);

      // 미적재 본문이 있으면 본문 보충 단계로 전환 + 비동기 트리거(완료 시 backfill 이 progress.finish 수행).
      int missing = txTemplate.execute(status -> messageRepo.countMissingBody(accountId));
      if (missing > 0) {
        // 한 회 보충 상한까지만 진행률로 표기한다 — 백필은 BATCH_LIMIT 만 처리하므로(잔여는 다음 sync)
        // 진행바가 "본문 200/250" 후 사라져 오해를 주지 않도록 total 을 상한으로 보정한다.
        int shown = Math.min(missing, MailBackfillService.BATCH_LIMIT);
        progress.startBodies(run, shown);
        // WP-1739: 보충을 띄우면 새 메일 푸시는 보충이 끝난 뒤 보충이 보낸다 — 자동 발송 판정(auto_generated)이 본문을 받을 때
        // 헤더로 정해지므로, 지금 판정하면 대량·자동 발송 메일이 「업무 메일만」에서 걸러지지 않는다.
        // WP-1812: 본문 보충 실행기가 가득 차 거절되면 보충을 띄우지 못한 것이다 — 보충 표시를 false 로 둬 finally 가 진행바를
        // 끝내게 하고(백필이 끝낼 책임을 못 진다), 새 메일 푸시도 아래에서 바로 보낸다. 남은 본문은 다음 주기가 다시 집는다.
        try {
          backfillService.backfill(userId, accountId, deferredPush(account, maxInboxId), run);
          triggeredBackfill = true;
        } catch (TaskRejectedException e) {
          log.warn("메일 본문 보충 실행기가 가득 차 건너뜀 — 다음 주기에 재시도 account={}", accountId);
        }
      }
      // 동기화 성공 — 마지막 동기화 시각 기록(자동·수동 공통). tx-local GUC 위해 txTemplate 사용.
      // 서버 메일함 목록이 바뀐 것(WP-960)도 같은 이벤트로 알린다.
      // 새 메일이 적재됐거나(saved > 0) 서버 읽음 상태가 로컬에 반영됐거나(seenChanged > 0, WP-148) 서버에서 빠진 메일을 지웠으면
      // (removed > 0, WP-959) 같은 트랜잭션 안에서 소유자에게 resource.changed 를 발행한다 — 트랜잭션 밖 발행은 유실된다. 읽음
      // 변화·삭제도
      // 사이드바·회신필요·홈 카운트를 바꾸므로 같은 이벤트로 무효화한다.
      // 시스템 발화라 actor 는 없다. TenantContext 는 호출자(스케줄러/컨트롤러)가 설정해 AFTER_COMMIT 시점에도 살아 있다.
      txTemplate.executeWithoutResult(
          status -> {
            accountRepo.updateLastSyncedAt(accountId, OffsetDateTime.now());
            if (result.changed() || foldersChanged) {
              notifier.mailChanged(userId, accountId, null, null);
            }
          });
      // WP-1739: 새 메일 OS 푸시 발송 — 보충을 띄우지 않았을 때(본문이 이미 다 있음)만 여기서 바로 보낸다(띄웠으면 보충이 끝난 뒤 보낸다).
      // 반드시 위 마지막 동기화 트랜잭션(last_synced_at 갱신)이 커밋된 '뒤' 호출한다.
      //  · 롤백 안전: executeWithoutResult 가 예외로 끝나면 여기까지 오지 않는다(롤백된 동기화가 잘못된 알림을 보내지 않는다).
      //    발송 자체도 try/catch 로 감싸 best-effort — 푸시 실패가 동기화 성공을 가리지 않는다(설계 지침, 내부 방어와 이중 방어).
      //  · 호출부(컨트롤러·자동 동기화 스케줄러·커밋 후 리스너)는 밖 트랜잭션이 없어 execute 반환 = 커밋 완료다.
      if (!triggeredBackfill) {
        sendNewMailQuietly(userId, account, maxInboxId);
      }
      // 동기화로 적재된 새 메일을 선제 요약(@Async — 짧은 TX 들이 모두 커밋된 뒤 별도 스레드에서 실행되어 새 메일이 가시). best-effort.
      // AI 게이트는 계정 단위(ai_enabled) — 호출자가 책임진다. 분석 서비스의 자체 게이트(비서 해석)는
      // 유저/비서 설정 단위라 계정 ai_enabled 와 어긋나므로, 여기서 OFF 계정을 미리 거른다(불필요한 IMAP fetch·요약 예외 스팸 방지).
      if (account.aiEnabled()) {
        try {
          summaryBackfillService.summarizeRecentUnread(userId, accountId);
        } catch (TaskRejectedException e) {
          // WP-1812: 분석 실행기 포화 — 동기화 결과는 그대로 돌려주고 요약은 다음 주기에 맡긴다.
          log.warn("메일 선제 요약 실행기가 가득 차 건너뜀 account={}", accountId);
        }
      }
      return result;
    } finally {
      // 보충할 게 없거나 에러로 끝났으면 여기서 즉시 종료(백필을 트리거했다면 백필이 종료 책임).
      if (!triggeredBackfill) {
        progress.finish(run);
      }
    }
  }

  /**
   * 본문 보충에 넘길 새 메일 푸시 정보(WP-1739) — 첫 동기화(lastSyncedAt 없음)는 경계 이전 미읽음 전체가 후보가 되므로 넘기지 않는다(null,
   * {@link #sendNewMailQuietly} 와 같은 제외 규칙).
   */
  private static MailPushService.NewMailPush deferredPush(
      EmailAccountResponse account, long maxInboxId) {
    if (account.lastSyncedAt() == null) {
      return null;
    }
    return new MailPushService.NewMailPush(account, maxInboxId);
  }

  /**
   * 커밋 뒤 새 메일 푸시(WP-1739) — 동기화 전에 읽어 둔 경계(maxInboxId) 이후로 들어온 안 읽은 메일을 판정해 발송한다.
   *
   * <p><b>왜 커밋 이후 지점인가:</b> 후보 메일이 DB 에 적재되는 것은 앞의 짧은 트랜잭션들이라, 발송은 마지막 동기화 트랜잭션이 커밋된 뒤에 해야 롤백된
   * 동기화에서 알림이 나가지 않는다(afterCommit 콜백으로 등록할 수도 있지만, 그 시점엔 끝난 트랜잭션의 커넥션이 아직 스레드에 묶여 있어 두 번째 커넥션을 빌려야
   * 하고 풀이 포화되면 서로를 기다린다 — execute 반환 후면 커넥션을 이미 반납한 뒤라 안전하다).
   *
   * <p><b>왜 읽기 트랜잭션인가:</b> 후보 조회(findNewUnreadInbox)는 RLS GUC(app.tenant_id, 트랜잭션-로컬)가 주입된 커넥션에서만
   * 행을 본다 — 경계가 없으면 fail-closed 로 0행이 되어 알림이 조용히 사라진다(#444). 발송(HTTP) 구간에 커넥션을 잡지만 본문 적재의 IMAP 왕복도
   * 짧은 트랜잭션으로 감싸는 현행 패턴과 같다.
   *
   * <p><b>왜 첫 동기화는 제외인가:</b> lastSyncedAt 이 null 이면(첫 동기화) 경계 이전의 기존 미읽음 받은편지함 전체가 후보가 되어 한꺼번에 올라온다
   * — 발송을 생략해 스팸을 막는다(설계 지침). 경계는 다음 동기화부터 있어 그 뒤의 새 메일만 후보가 된다.
   */
  private void sendNewMailQuietly(long userId, EmailAccountResponse account, long maxInboxId) {
    // 첫 동기화 제외 — 계정 조회 시점의 lastSyncedAt(갱신 전)이 곧 '이전에 동기화한 적이 있는가' 다.
    if (account.lastSyncedAt() == null) {
      return;
    }
    try {
      // 읽기(경계 후보 조회)를 짧은 트랜잭션으로 감싼다 — 진입 시 TenantContext → RLS GUC 주입.
      txTemplate.executeWithoutResult(
          status -> mailPushService.sendNewMail(userId, account, maxInboxId));
    } catch (Exception ex) {
      // best-effort — 발송·조회·조립 어느 단계든 실패해도 동기화는 성공으로 끝난다(예외 미전파).
      log.warn("[push] 새 메일 푸시 실패(동기화는 성공 유지) accountId={}: {}", account.id(), ex.toString());
    }
  }

  /**
   * 서버 메일함 목록 갱신(WP-960) — best-effort. 목록 조회·반영 실패는 경고 로그만 남기고 false(바뀐 것 없음)를 돌려준다. 목록 조회가 실패하면
   * 저장된 폴더는 지워지지 않는다({@link MailFolderService#refresh}). 예외 메시지에는 자격증명이 담기지 않는다.
   */
  private boolean refreshFoldersQuietly(long userId, long accountId, EmailAccountResponse account) {
    try {
      return folderService.refresh(userId, accountId, account);
    } catch (Exception e) {
      log.warn("서버 메일함 목록 갱신 실패(동기화 결과는 유지): accountId={} {}", accountId, e.toString());
      return false;
    }
  }
}

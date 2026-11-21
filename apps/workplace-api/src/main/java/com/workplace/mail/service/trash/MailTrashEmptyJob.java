package com.workplace.mail.service.trash;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailTrashEmptyStatus;
import com.workplace.mail.exception.MailCredentialUnreadableException;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.trash.MailEraser.EmptySink;
import com.workplace.mail.service.trash.MailEraser.TrashRef;
import java.util.List;
import java.util.Objects;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 휴지통 비우기 작업 한 번(WP-1682) — {@code mailTrashEmptyExecutor} 스레드에서 돈다. 서버 I/O 는 공급자별 {@link
 * MailEraser} 가 트랜잭션 밖에서 하고, 이 작업은 묶음마다 넘어온 결과를 짧은 트랜잭션으로 로컬에 반영하며({@link EmptySink}) 진행 상태({@link
 * MailTrashEmptyProgress})를 갱신한다.
 *
 * <p>어떤 길로 끝나든 진행 상태를 RUNNING 으로 남기지 않는다(DONE 또는 FAILED + 사유). 끝 상태를 적기 전에 메일함 목록을 best-effort 로 한
 * 번 갱신해 휴지통 전체 수·UIDPLUS 기록을 서버에 맞춘다 — 다만 UIDPLUS 없음으로 멈췄으면(서버는 그대로이고, 갱신이 다시 「지원」으로 적을 수 있다), 계정
 * 연결이 해제돼 멈췄으면(갱신할 계정이 없다), 앱 종료로 멈췄으면(종료를 늦추지 않게 — 다음 동기화가 맞춘다), 자격증명을 읽지 못해 멈췄으면(갱신도 같은 실패를
 * 되풀이한다) 건너뛴다. 로그는 계정 id 와 수만 남긴다(제목·주소 없음).
 */
@Slf4j
@Component
public class MailTrashEmptyJob {

  private final MailTrashEmptyProgress progress;
  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final MailFolderService folderService;
  private final MailChangeNotifier notifier;

  /** 짧은-트랜잭션용 TransactionTemplate — TenantAwareTransactionManager 로 RLS GUC 가 주입된다. */
  private final TransactionTemplate txTemplate;

  public MailTrashEmptyJob(
      MailTrashEmptyProgress progress,
      EmailAccountRepository accountRepo,
      EmailFolderRepository folderRepo,
      EmailMessageRepository messageRepo,
      MailFolderService folderService,
      MailChangeNotifier notifier,
      PlatformTransactionManager txManager) {
    this.progress = progress;
    this.accountRepo = accountRepo;
    this.folderRepo = folderRepo;
    this.messageRepo = messageRepo;
    this.folderService = folderService;
    this.notifier = notifier;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 계정의 서버 휴지통을 비운다. 시작 확인(소유·휴지통 행·UIDPLUS 기록)과 {@code tryStart}, 공급자 지우개 고르기는 {@link
   * MailTrashService#startEmpty} 가 마쳤다. 예외를 던지지 않는다 — 모든 실패는 진행 상태 FAILED 로 남는다(실행기 스레드에서 던져 봐야 아무도
   * 받지 않는다).
   *
   * <p>목록 갱신을 끝 상태(DONE·FAILED)를 적기 <b>전</b>에 한다 — 웹은 끝 상태를 보자마자 메일함 목록을 다시 받으므로, 그때 휴지통 수가 이미 서버에
   * 맞춰져 있어야 한다. 끝 상태는 finally 에서 한 번만 적어 Error 같은 잡지 못한 길에서도 RUNNING 이 남지 않는다.
   */
  public void run(long userId, EmailAccountResponse account, TrashRef trash, MailEraser eraser) {
    long accountId = account.id();
    // 멈춘 사유 코드 — null 이면 끝까지 돌았다. 잡지 못한 길(Error 등)의 기본 사유는 연결 실패다.
    String failCode = MailTrashException.SERVER_UNREACHABLE;
    try {
      eraser.emptyTrash(userId, account, trash, new Sink(userId, accountId, trash));
      failCode = null;
    } catch (MailTrashException e) {
      failCode = e.code();
      recordNoUidPlusQuietly(account, failCode);
    } catch (MailCredentialUnreadableException e) {
      // 저장된 자격증명을 읽지 못함 — 연결 실패와 구분되는 사유 코드로 남긴다(계정 id·코드만 로그, 암호문·토큰 없음)
      failCode = e.trashCode();
      log.warn(
          "휴지통 비우기 중단 — 자격증명(IMAP 비밀번호·M365 토큰) 복호화 실패: accountId={} code={}", accountId, failCode);
    } catch (RuntimeException e) {
      // 서버 접속 실패(MailSyncException)·예상 못 한 실패 — 화면에는 연결 실패로 보인다. 예외 메시지는 남기지 않는다(주소가 섞일 수 있다).
      log.warn("휴지통 비우기 실패: accountId={} {}", accountId, e.getClass().getSimpleName());
    } finally {
      try {
        if (!skipsRefresh(failCode)) {
          refreshQuietly(userId, account);
        }
      } finally {
        if (failCode == null) {
          progress.finish(accountId);
        } else {
          progress.fail(accountId, failCode);
        }
      }
      MailTrashEmptyStatus s = progress.snapshot(accountId);
      log.info(
          "휴지통 비우기 끝: accountId={} state={} errorCode={} total={} deleted={} failed={}",
          accountId,
          s.state(),
          s.errorCode(),
          s.total(),
          s.deleted(),
          s.failed());
    }
  }

  /**
   * 끝난 뒤 메일함 목록 갱신을 건너뛰는 사유인지 — UIDPLUS 없음(서버는 그대로이고 갱신이 다시 「지원」으로 적는다)·계정 해제(갱신할 계정이 없다)·앱
   * 종료(인터럽트된 스레드로 서버 I/O 를 하면 종료가 늦어지고 어차피 실패한다)·자격증명 복호화 실패(갱신도 같은 실패를 되풀이해 경고만 쌓인다). 끝까지
   * 돌았으면(null) 갱신한다.
   */
  private static boolean skipsRefresh(String failCode) {
    return MailTrashException.PERMANENT_DELETE_UNSUPPORTED.equals(failCode)
        || MailTrashException.ACCOUNT_GONE.equals(failCode)
        || MailTrashException.INTERRUPTED.equals(failCode)
        || MailTrashException.CREDENTIAL_UNREADABLE.equals(failCode)
        || MailTrashException.OAUTH_TOKEN_UNREADABLE.equals(failCode);
  }

  /**
   * 서버가 UIDPLUS 없음으로 멈췄으면 다음 메일함 목록부터 단추가 꺼지게 기록한다({@link MailTrashService#recordNoUidPlus} — 완전
   * 삭제와 같은 규칙). 기록 실패는 작업 결과(FAILED)를 바꾸지 않아 경고만 남긴다.
   */
  private void recordNoUidPlusQuietly(EmailAccountResponse account, String failCode) {
    try {
      MailTrashService.recordNoUidPlus(txTemplate, accountRepo, account, failCode);
    } catch (RuntimeException e) {
      log.warn("UIDPLUS 없음 기록 실패: accountId={} {}", account.id(), e.getClass().getSimpleName());
    }
  }

  /** 끝난 뒤 메일함 목록 갱신 — 휴지통 전체 수·UIDPLUS 기록을 서버에 맞춘다. 실패는 결과에 영향이 없어 경고만 남긴다. */
  private void refreshQuietly(long userId, EmailAccountResponse account) {
    try {
      folderService.refresh(userId, account.id(), account);
    } catch (RuntimeException e) {
      log.warn(
          "휴지통 비우기 뒤 메일함 목록 갱신 실패: accountId={} {}", account.id(), e.getClass().getSimpleName());
    }
  }

  /** 지우개가 묶음마다 넘기는 결과를 로컬에 반영하고 진행 수를 센다. */
  private final class Sink implements EmptySink {

    private final long userId;
    private final long accountId;
    private final TrashRef trash;

    Sink(long userId, long accountId, TrashRef trash) {
      this.userId = userId;
      this.accountId = accountId;
      this.trash = trash;
    }

    @Override
    public void snapshot(int total) {
      progress.setTotal(accountId, total);
    }

    /**
     * 서버에서 지운 묶음의 로컬 행을 지운다 — 휴지통 행의 UIDVALIDITY 가 서버 값과 같을 때만(다르면 저장된 UID 가 다른 메일일 수 있어 로컬은 다음
     * 동기화의 UIDVALIDITY 재적재에 맡긴다). 계정이 그새 해제됐으면 {@code ACCOUNT_GONE} 으로 작업을 멈춘다. 트랜잭션 밖 발행은 유실되므로 변경
     * 알림도 안에서 보낸다(웹 목록이 실시간으로 줄어든다, 사용자 발화라 actor=본인). 로컬에서 지운 행이 없으면 알리지 않는다.
     */
    @Override
    public void erasedImap(long serverUidValidity, List<Long> uids) {
      txTemplate.executeWithoutResult(
          status -> {
            requireAccount();
            boolean sameMailbox =
                folderRepo
                    .findTarget(accountId, trash.folderId())
                    .map(f -> Objects.equals(f.uidValidity(), serverUidValidity))
                    .orElse(false);
            if (sameMailbox
                && messageRepo.deleteByImapUids(accountId, trash.folderId(), uids) > 0) {
              notifier.mailChanged(userId, accountId, null, userId);
            }
          });
      progress.addDeleted(accountId, uids.size());
    }

    /**
     * 서버에서 지운 Graph 메일들의 로컬 휴지통 행을 지운다(이미 없던 것 포함 — 목표 상태). Graph id 는 메일함 안에서 변하지 않아 IMAP 의
     * UIDVALIDITY 같은 확인이 필요 없다. 계정이 그새 해제됐으면 {@code ACCOUNT_GONE} 으로 작업을 멈춘다. 변경 알림은 IMAP 과 같이 트랜잭션
     * 안에서, 로컬에서 지운 행이 있을 때만 보낸다.
     */
    @Override
    public void erasedGraph(List<String> providerIds) {
      txTemplate.executeWithoutResult(
          status -> {
            requireAccount();
            if (messageRepo.deleteByProviderIds(accountId, trash.folderId(), providerIds) > 0) {
              notifier.mailChanged(userId, accountId, null, userId);
            }
          });
      progress.addDeleted(accountId, providerIds.size());
    }

    /** 계정이 아직 연결돼 있는지(트랜잭션 안) — 비우는 도중 해제됐으면 로컬 반영 없이 {@code ACCOUNT_GONE} 으로 멈춘다. */
    private void requireAccount() {
      accountRepo
          .findByIdAndUser(userId, accountId)
          .orElseThrow(() -> MailTrashException.of(MailTrashException.ACCOUNT_GONE));
    }

    @Override
    public void failed(int count) {
      progress.addFailed(accountId, count);
    }
  }
}

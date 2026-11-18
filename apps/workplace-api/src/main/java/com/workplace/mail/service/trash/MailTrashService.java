package com.workplace.mail.service.trash;

import static java.util.stream.Collectors.toMap;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailMoveResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailTrashCountResponse;
import com.workplace.mail.dto.MailTrashEmptyStatus;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailFolderRepository.FolderTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.MoveSource;
import com.workplace.mail.service.MailServerErrors;
import com.workplace.mail.service.folder.FolderRole;
import com.workplace.mail.service.trash.MailEraser.Item;
import com.workplace.mail.service.trash.MailEraser.Outcome;
import com.workplace.mail.service.trash.MailEraser.TrashRef;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 휴지통 메일 완전히 삭제(WP-1682) — 앱 휴지통의 메일을 메일 서버(IMAP·Outlook)에서 영구히 지우고 로컬 행도 지운다. 되돌릴 수 없다.
 *
 * <p>흐름은 {@code MailMoveService} 와 같은 세 단계다: ① 짧은 트랜잭션에서 소유·휴지통 메일인지·서버가 골라 지우기를 지원하는지 확인 ② 트랜잭션
 * 밖에서 공급자별 {@link MailEraser} 로 서버에서 지우기(네트워크 I/O 동안 DB 연결을 잡지 않는다) ③ 성공한 메일만 한 트랜잭션에서 로컬 행 삭제 + 변경
 * 알림. 메일 id 에 묶인 첨부 행은 ON DELETE CASCADE 로 함께 지워지고, 드라이브·이슈로 가져간 사본은 따로 남는다.
 *
 * <p>휴지통 비우기({@link #startEmpty})는 오래 걸릴 수 있어(Outlook) 확인만 여기서 하고 실제 지우기는 전용 실행기의 {@link
 * MailTrashEmptyJob} 이 하며, 진행은 {@link MailTrashEmptyProgress} 로 폴링한다.
 */
@Service
public class MailTrashService {

  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;

  /**
   * 공급자별 지우개 — 완전 삭제와 비우기가 함께 쓴다(비우기는 시작 확인에서 고른 지우개를 작업에 넘긴다). final 이 아니다 — 테스트가 UIDPLUS 없는 서버·묶음
   * 실패를 흉내 내는 지우개로 바꿔 끼우고(MailTrashEmptyImapTest) 끝나면 되돌린다.
   */
  private Map<MailProvider, MailEraser> erasers;

  private final MailChangeNotifier notifier;

  /** 짧은-트랜잭션용 TransactionTemplate — TenantAwareTransactionManager 로 RLS GUC 가 주입된다. */
  private final TransactionTemplate txTemplate;

  /** 휴지통 비우기 읽기 전용 트랜잭션(상태 조회의 소유 확인). */
  private final TransactionTemplate readTx;

  private final MailTrashEmptyProgress emptyProgress;
  private final MailTrashEmptyJob emptyJob;

  /**
   * 휴지통 비우기 실행기({@code mailTrashEmptyExecutor}). final 이 아니다 — 테스트가 동기 실행기·거절하는 실행기로 바꿔 끼우고 끝나면
   * 되돌린다.
   */
  private TaskExecutor emptyExecutor;

  public MailTrashService(
      EmailAccountRepository accountRepo,
      EmailFolderRepository folderRepo,
      EmailMessageRepository messageRepo,
      List<MailEraser> erasers,
      MailChangeNotifier notifier,
      PlatformTransactionManager txManager,
      MailTrashEmptyProgress emptyProgress,
      MailTrashEmptyJob emptyJob,
      @Qualifier("mailTrashEmptyExecutor") TaskExecutor emptyExecutor) {
    this.accountRepo = accountRepo;
    this.folderRepo = folderRepo;
    this.messageRepo = messageRepo;
    this.erasers = erasers.stream().collect(toMap(MailEraser::provider, Function.identity()));
    this.notifier = notifier;
    this.txTemplate = new TransactionTemplate(txManager);
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
    this.emptyProgress = emptyProgress;
    this.emptyJob = emptyJob;
    this.emptyExecutor = emptyExecutor;
  }

  /** 완전 삭제 계획 — 확인을 마친 휴지통 메일과 휴지통 행. */
  private record Plan(
      EmailAccountResponse account, List<MoveSource> sources, TrashRef trash, MailEraser eraser) {}

  /**
   * 휴지통 메일들을 완전히 삭제한다. 내 계정이 아니면 404, 계정에 없는 메일이 하나라도 있으면 404, 휴지통 밖 메일이 섞이면 400 {@code
   * NOT_IN_TRASH}, 계정에 휴지통 행이 없으면 400 {@code NO_TRASH}, 서버가 골라 지우기(IMAP UIDPLUS)를 지원하지 않거나 공급자의
   * 지우개가 없으면 400 {@code PERMANENT_DELETE_UNSUPPORTED} — 모두 아무것도 지우지 않는다. 서버 접속 실패는 502({@code
   * MailSyncException}). 메일별 서버 실패는 결과에 담고 그 메일은 로컬에 그대로 둔다. 같은 id 는 한 번만 지우고, 결과는 요청 순서(중복 제거)다.
   */
  public MailMoveResponse permanentDelete(long userId, long accountId, List<Long> messageIds) {
    List<Long> ids = List.copyOf(new LinkedHashSet<>(messageIds));
    Plan plan = txTemplate.execute(status -> plan(userId, accountId, ids));
    Objects.requireNonNull(plan);
    MailEraser eraser = plan.eraser();
    List<Item> items =
        plan.sources().stream()
            .map(s -> new Item(s.messageId(), s.imapUid(), s.providerMessageId()))
            .toList();

    // ② 서버 I/O — 트랜잭션 밖
    List<Outcome> erased;
    try {
      erased = eraser.erase(userId, plan.account(), plan.trash(), items);
    } catch (MailTrashException e) {
      recordNoUidPlus(txTemplate, accountRepo, plan.account(), e.code());
      throw e;
    }

    Map<Long, Outcome> byId = new HashMap<>();
    erased.forEach(o -> byId.put(o.messageId(), o));
    List<Long> succeeded = erased.stream().filter(Outcome::ok).map(Outcome::messageId).toList();
    if (!succeeded.isEmpty()) {
      // ③ 로컬 반영 — 트랜잭션 밖 발행은 유실되므로 알림도 안에서 보낸다. 사용자 발화라 actor=본인.
      txTemplate.executeWithoutResult(
          status -> {
            messageRepo.deleteByIds(accountId, succeeded);
            notifier.mailChanged(userId, accountId, null, userId);
          });
    }

    List<MailMoveResponse.Result> results = new ArrayList<>();
    for (Long id : ids) {
      Outcome o = byId.get(id);
      results.add(
          o == null
              ? new MailMoveResponse.Result(id, false, MailServerErrors.ERASE_FAILED)
              : new MailMoveResponse.Result(id, o.ok(), o.ok() ? null : o.error()));
    }
    return new MailMoveResponse(results);
  }

  /**
   * ① 소유·휴지통 메일·서버 지원 여부 확인(트랜잭션 안). 순서는 계정 404 → 메일 404 → NOT_IN_TRASH → NO_TRASH →
   * PERMANENT_DELETE_UNSUPPORTED. 하나라도 어긋나면 아무것도 하지 않고 던진다.
   */
  private Plan plan(long userId, long accountId, List<Long> ids) {
    EmailAccountResponse account = ownedAccount(userId, accountId);
    List<MoveSource> sources = messageRepo.findMoveSources(accountId, ids);
    if (sources.size() != ids.size()) {
      List<Long> found = sources.stream().map(MoveSource::messageId).toList();
      long missing = ids.stream().filter(id -> !found.contains(id)).findFirst().orElse(0L);
      throw new EmailMessageNotFoundException(missing);
    }
    if (sources.stream().anyMatch(s -> !FolderRole.TRASH.matches(s.folderRole()))) {
      throw MailTrashException.of(MailTrashException.NOT_IN_TRASH);
    }
    TrashRef trash = trashRef(accountId);
    MailEraser eraser = requireSupported(account);
    return new Plan(account, sources, trash, eraser);
  }

  /** 비우기 시작 확인을 마친 계정과 휴지통 행, 공급자의 지우개. */
  private record EmptyPlan(EmailAccountResponse account, TrashRef trash, MailEraser eraser) {}

  /**
   * 휴지통 비우기를 시작한다(WP-1682) — 서버 휴지통 바로 아래의 모든 메일을 백그라운드로 지우고 지금 상태를 돌려준다. 내 계정이 아니면 404, 휴지통 행이 없으면
   * 400 {@code NO_TRASH}, 지원하지 않는 서버(IMAP UIDPLUS 없음 기록·지우개 없는 공급자)면 400 {@code
   * PERMANENT_DELETE_UNSUPPORTED}. 계정당 작업은 하나라 이미 돌고 있으면 새로 시작하지 않고 그 작업 상태를 그대로 돌려준다(다시 눌러도 안전).
   * 실행기가 가득 차 거절하면 시작 전으로 되돌리고 503 {@code TRASH_EMPTY_BUSY}.
   *
   * <p>확인만 짧은 트랜잭션이고, 시작·실행기 제출은 트랜잭션 밖이다(작업 스레드가 커밋 전 상태를 보지 않게, 요청 스레드가 DB 연결을 오래 잡지 않게).
   */
  public MailTrashEmptyStatus startEmpty(long userId, long accountId) {
    EmptyPlan plan = txTemplate.execute(status -> emptyPlan(userId, accountId));
    Objects.requireNonNull(plan);
    if (!emptyProgress.tryStart(accountId)) {
      return emptyProgress.snapshot(accountId);
    }
    try {
      emptyExecutor.execute(
          () -> emptyJob.run(userId, plan.account(), plan.trash(), plan.eraser()));
    } catch (TaskRejectedException e) {
      emptyProgress.release(accountId);
      throw MailTrashException.of(MailTrashException.TRASH_EMPTY_BUSY);
    }
    return emptyProgress.snapshot(accountId);
  }

  /** 휴지통 비우기 상태. 남의 계정이면 404(남의 진행을 보이지 않는다), 작업 기록이 없으면 IDLE. */
  public MailTrashEmptyStatus emptyStatus(long userId, long accountId) {
    readTx.executeWithoutResult(status -> ownedAccount(userId, accountId));
    return emptyProgress.snapshot(accountId);
  }

  /** 메일 수 조회 확인(트랜잭션 안) — 소유·휴지통 행·서버 지원 여부. 어긋나면 접속하지 않고 던진다. */
  private record CountPlan(EmailAccountResponse account, TrashRef trash, MailEraser eraser) {}

  /**
   * 서버 휴지통의 실제 메일 수(WP-1708) — 휴지통 비우기 확인 창의 수를 로컬 폴더 목록의 낡은 값이 아니라 서버에서 실시간으로 받는다. 내 계정이 아니면 404,
   * 휴지통 행이 없으면 400 {@code NO_TRASH}, 지원하지 않는 서버면 400 {@code PERMANENT_DELETE_UNSUPPORTED}, 서버 접속·조회
   * 실패는 502({@code MailSyncException}) — 수를 얻지 못하면 로컬 값으로 대신하지 않는다.
   *
   * <p>모든 확인(소유·휴지통 행·서버 지원)은 읽기 전용 트랜잭션 안에서 끝내고 서버 조회는 트랜잭션 밖에서 한다 — 네트워크 I/O 동안 DB 연결을 잡지 않는다.
   */
  public MailTrashCountResponse trashCount(long userId, long accountId) {
    CountPlan plan =
        readTx.execute(
            status -> {
              EmailAccountResponse account = ownedAccount(userId, accountId);
              return new CountPlan(account, trashRef(accountId), requireSupported(account));
            });
    Objects.requireNonNull(plan);

    // 서버 I/O — 트랜잭션 밖
    int count = plan.eraser().countTrash(userId, plan.account(), plan.trash());
    return new MailTrashCountResponse(count);
  }

  /** 비우기 시작 확인(트랜잭션 안) — 소유·휴지통 행·서버 지원 여부. 어긋나면 아무것도 시작하지 않고 던진다. */
  private EmptyPlan emptyPlan(long userId, long accountId) {
    EmailAccountResponse account = ownedAccount(userId, accountId);
    TrashRef trash = trashRef(accountId);
    MailEraser eraser = requireSupported(account);
    return new EmptyPlan(account, trash, eraser);
  }

  /** 계정의 휴지통 행(지난 목록 갱신 때 고른 것). 없으면 400 {@code NO_TRASH}. 완전 삭제·비우기 공용. */
  private TrashRef trashRef(long accountId) {
    FolderTarget trash =
        folderRepo
            .findTrash(accountId)
            .orElseThrow(() -> MailTrashException.of(MailTrashException.NO_TRASH));
    return new TrashRef(trash.id(), trash.name(), trash.uidValidity());
  }

  /**
   * 이 계정의 서버가 골라 지우기를 지원하는지 확인하고 공급자의 지우개를 돌려준다(완전 삭제·비우기 공용, 서버 I/O 전). 지우개가 없는 공급자(이 공급자는 아직 구현하지
   * 않았다 — null 지우개로 500 이 나지 않게, 계정 기록은 건드리지 않는다)나 지난 목록 갱신·실행에서 IMAP UIDPLUS 없음을 확인한 서버는 접속하지 않고
   * 400 {@code PERMANENT_DELETE_UNSUPPORTED} 로 거절한다(null=모름은 막지 않는다).
   */
  private MailEraser requireSupported(EmailAccountResponse account) {
    MailEraser eraser = erasers.get(account.provider());
    if (eraser == null || accountRepo.isImapUidPlusKnownMissing(account)) {
      throw MailTrashException.of(MailTrashException.PERMANENT_DELETE_UNSUPPORTED);
    }
    return eraser;
  }

  /**
   * 서버가 UIDPLUS 없음으로 거절했으면(IMAP 의 {@code PERMANENT_DELETE_UNSUPPORTED}) 다음 메일함 목록부터 단추가 꺼지게 계정에
   * 기록한다 — 완전 삭제·비우기 공용 규칙(false 만 기록, true 는 목록 갱신이 적는다). 던지는 콜백 안에서 기록하면 함께 롤백되므로 따로 끝나는 트랜잭션으로
   * 적는다. 그 밖의 코드·공급자는 아무것도 하지 않는다. 기록 실패는 그대로 던진다(비우기 작업은 받아서 경고만 남긴다).
   *
   * <p>비우기 작업({@link MailTrashEmptyJob})도 부르는데, 이 서비스가 그 작업을 주입받아 거꾸로 주입하면 순환이라 협력 객체를 인자로 받는 정적
   * 메서드다.
   */
  static void recordNoUidPlus(
      TransactionTemplate tx,
      EmailAccountRepository accountRepo,
      EmailAccountResponse account,
      String code) {
    if (MailTrashException.PERMANENT_DELETE_UNSUPPORTED.equals(code)
        && account.provider() == MailProvider.IMAP) {
      tx.executeWithoutResult(status -> accountRepo.recordImapUidPlus(account.id(), false));
    }
  }

  /** 내 계정(아니면 404). */
  private EmailAccountResponse ownedAccount(long userId, long accountId) {
    return accountRepo
        .findByIdAndUser(userId, accountId)
        .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
  }
}

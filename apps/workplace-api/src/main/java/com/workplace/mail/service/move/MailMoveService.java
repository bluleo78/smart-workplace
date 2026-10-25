package com.workplace.mail.service.move;

import static java.util.stream.Collectors.toMap;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailMoveRequest;
import com.workplace.mail.dto.MailMoveRequest.Kind;
import com.workplace.mail.dto.MailMoveResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailFolderNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailFolderRepository.FolderTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.MoveSource;
import com.workplace.mail.service.move.MailMover.Destination;
import com.workplace.mail.service.move.MailMover.Item;
import com.workplace.mail.service.move.MailMover.Outcome;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 옮기기(WP-962) — 앱에서 보관·메일함으로 옮기기·삭제(서버 휴지통으로 옮기기)한 것을 메일 서버(IMAP·Outlook)에 반영하고 로컬을 맞춘다.
 *
 * <p>흐름: ① 짧은 트랜잭션에서 소유·대상 확인과 옮길 곳 결정 ② 트랜잭션 밖에서 공급자별 {@link MailMover} 로 서버에서 옮기기(네트워크 I/O 동안 DB
 * 연결을 잡지 않는다) ③ 성공한 메일만 한 트랜잭션에서 로컬 반영 + 변경 알림.
 *
 * <p>로컬 반영은 행을 <b>그 자리에서 옮긴다</b>(folder_id·서버 위치만 바꾼다) — 지우고 새로 넣으면 메일 id 에 묶인 첨부 행(ON DELETE
 * CASCADE)·개인 AI 판정·이슈 연결이 사라진다. 새 서버 위치를 모르면(UIDPLUS 없는 서버·UIDVALIDITY 불일치) 또는 휴지통(저장하지 않는 시스템
 * 메일함)이면 로컬 행을 지우고, 대상 메일함의 다음 동기화가 다시 넣는다.
 *
 * <p>실행 취소는 웹이 맡는다 — 토스트가 떠 있는 동안 요청을 미루고 「실행 취소」면 보내지 않는다. 그래서 이 API 는 되돌리기용 정보를 주지 않는다.
 */
@Service
public class MailMoveService {

  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final EmailAttachmentRepository attachmentRepo;
  private final Map<MailProvider, MailMover> movers;
  private final MailChangeNotifier notifier;

  /** 짧은-트랜잭션용 TransactionTemplate — TenantAwareTransactionManager 로 RLS GUC 가 주입된다. */
  private final TransactionTemplate txTemplate;

  public MailMoveService(
      EmailAccountRepository accountRepo,
      EmailFolderRepository folderRepo,
      EmailMessageRepository messageRepo,
      EmailAttachmentRepository attachmentRepo,
      List<MailMover> movers,
      MailChangeNotifier notifier,
      PlatformTransactionManager txManager) {
    this.accountRepo = accountRepo;
    this.folderRepo = folderRepo;
    this.messageRepo = messageRepo;
    this.attachmentRepo = attachmentRepo;
    this.movers = movers.stream().collect(toMap(MailMover::provider, Function.identity()));
    this.notifier = notifier;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 옮길 계획 — 확인을 마친 메일과 옮길 곳.
   *
   * @param destFolderId 옮길 곳의 로컬 메일함 id(휴지통은 저장하지 않아 null)
   * @param destUidValidity 옮길 곳 IMAP UIDVALIDITY(아직 가져오지 않았으면 null)
   */
  private record Plan(
      EmailAccountResponse account,
      List<MoveSource> sources,
      Destination dest,
      Long destFolderId,
      Long destUidValidity) {}

  /**
   * 메일들을 옮긴다. 내 계정이 아니거나 계정에 없는 메일이 하나라도 있으면 404, 앱에서 보낸 기록(보낸편지함)은 400, 보관 메일함이 없는데 보관이면 400, 서버에
   * 휴지통이 없으면 400. 서버 접속 실패는 502(아무것도 옮기지 않았다). 메일별 서버 실패는 결과에 담고 그 메일은 로컬에서 그대로 둔다. 이미 그 메일함에 있는
   * 메일은 아무것도 하지 않고 성공으로 본다.
   */
  public MailMoveResponse move(long userId, long accountId, MailMoveRequest req) {
    List<Long> ids = List.copyOf(new LinkedHashSet<>(req.messageIds()));
    Plan plan = txTemplate.execute(status -> plan(userId, accountId, ids, req.target()));
    Objects.requireNonNull(plan);

    Map<Long, Outcome> outcomes = new HashMap<>();
    List<Item> toMove = new ArrayList<>();
    for (MoveSource s : plan.sources()) {
      if (plan.destFolderId() != null && s.folderId() == plan.destFolderId()) {
        outcomes.put(
            s.messageId(), new Outcome(s.messageId(), true, null, null, null, false, null, null));
      } else {
        toMove.add(
            new Item(
                s.messageId(),
                s.folderName(),
                s.imapUid(),
                s.providerMessageId(),
                s.seen(),
                s.seenPushPending(),
                s.hasProviderAttachments(),
                s.folderUidValidity()));
      }
    }
    if (!toMove.isEmpty()) {
      MailMover mover = movers.get(plan.account().provider());
      if (mover == null) {
        throw new MailSyncException("지원하지 않는 메일 공급자: " + plan.account().provider());
      }
      // 서버 I/O — 트랜잭션 밖
      List<Outcome> moved = mover.move(userId, plan.account(), toMove, plan.dest());
      moved.forEach(o -> outcomes.put(o.messageId(), o));
      List<Outcome> succeeded = moved.stream().filter(Outcome::ok).toList();
      if (!succeeded.isEmpty()) {
        txTemplate.executeWithoutResult(status -> applyLocal(userId, accountId, plan, succeeded));
      }
    }

    List<MailMoveResponse.Result> results = new ArrayList<>();
    for (Long id : ids) {
      Outcome o = outcomes.get(id);
      results.add(
          o == null
              ? new MailMoveResponse.Result(id, false, "메일 서버에서 옮기지 못했습니다")
              : new MailMoveResponse.Result(id, o.ok(), o.ok() ? null : o.error()));
    }
    return new MailMoveResponse(results);
  }

  /** ① 소유·대상 확인과 옮길 곳 결정(트랜잭션 안). */
  private Plan plan(long userId, long accountId, List<Long> ids, MailMoveRequest.Target target) {
    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, accountId)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    List<MoveSource> sources = messageRepo.findMoveSources(accountId, ids);
    if (sources.size() != ids.size()) {
      List<Long> found = sources.stream().map(MoveSource::messageId).toList();
      long missing = ids.stream().filter(id -> !found.contains(id)).findFirst().orElse(0L);
      throw new EmailMessageNotFoundException(missing);
    }
    // 서버 메일함(role 있음)과 받은편지함만 서버에 있는 메일이다 — 앱에서 보낸 기록(SENT)은 서버 위치가 없다.
    if (sources.stream().anyMatch(s -> s.folderRole() == null && !"INBOX".equals(s.folderName()))) {
      throw new MailValidationException("보낸 메일은 옮길 수 없습니다");
    }
    return switch (target.kind()) {
      case INBOX -> {
        EmailFolderRepository.FolderSyncState inbox = folderRepo.ensureFolder(accountId, "INBOX");
        yield new Plan(
            account,
            sources,
            new Destination(Kind.INBOX, "INBOX", "inbox"),
            inbox.id(),
            inbox.uidValidity());
      }
      case ARCHIVE -> {
        FolderTarget archive =
            folderRepo
                .findArchive(accountId)
                .orElseThrow(() -> new MailValidationException("보관 메일함이 없습니다"));
        yield folderPlan(account, sources, archive);
      }
      case FOLDER -> {
        if (target.folderId() == null) {
          throw new MailValidationException("옮길 메일함을 골라 주세요");
        }
        FolderTarget f =
            folderRepo
                .findTarget(accountId, target.folderId())
                .orElseThrow(EmailFolderNotFoundException::new);
        if (f.role() == null || !f.selectable()) {
          throw new MailValidationException("이 메일함으로는 옮길 수 없습니다");
        }
        yield folderPlan(account, sources, f);
      }
      case TRASH ->
          new Plan(account, sources, new Destination(Kind.TRASH, null, "deleteditems"), null, null);
    };
  }

  /** 저장된 서버 메일함(보관·사용자)으로 옮기는 계획 — IMAP 은 이름(전체 경로), Graph 는 폴더 id 로 연다. */
  private static Plan folderPlan(
      EmailAccountResponse account, List<MoveSource> sources, FolderTarget f) {
    return new Plan(
        account,
        sources,
        new Destination(Kind.FOLDER, f.name(), f.remoteId() != null ? f.remoteId() : f.name()),
        f.id(),
        f.uidValidity());
  }

  /**
   * ③ 서버에서 옮긴 메일의 로컬 반영(트랜잭션 안). 새 위치를 알면 행을 옮기고, 모르거나 휴지통이면 지운다. 옮기기 전 위치 기준으로 서버 메일함 안 읽은 수를 줄이고,
   * 옮긴 뒤 위치 기준으로 늘린다(받은편지함·휴지통은 adjustServerUnread 가 건드리지 않는다). 바뀐 것이 있으면 계정 단위 변경 알림.
   */
  private void applyLocal(long userId, long accountId, Plan plan, List<Outcome> moved) {
    Map<Long, MoveSource> byId = new HashMap<>();
    plan.sources().forEach(s -> byId.put(s.messageId(), s));
    List<Long> unseen =
        moved.stream().map(Outcome::messageId).filter(id -> !byId.get(id).seen()).toList();
    folderRepo.adjustServerUnread(unseen, -1);

    List<Long> toDelete = new ArrayList<>();
    List<Long> relocatedUnseen = new ArrayList<>();
    for (Outcome o : moved) {
      MoveSource s = byId.get(o.messageId());
      if (!relocatable(plan, o)
          || messageRepo.existsAtDestination(
              accountId, plan.destFolderId(), o.newImapUid(), o.newProviderId())) {
        // 새 위치를 모르거나, 옮기는 사이 대상 메일함 동기화가 같은 메일을 먼저 넣었다 — 원래 행은 지운다.
        toDelete.add(o.messageId());
        continue;
      }
      boolean clearPending = !s.seenPushPending() || o.seenPushed();
      messageRepo.relocate(
          o.messageId(), plan.destFolderId(), o.newImapUid(), o.newProviderId(), clearPending);
      if (o.newAttachmentIds() != null) {
        // Graph: 옮기면 첨부 id 도 바뀐다 — 저장된 옛 id 로는 다운로드가 404 가 된다.
        attachmentRepo.repointProviderAttachmentIds(o.messageId(), o.newAttachmentIds());
      }
      if (!s.seen()) {
        relocatedUnseen.add(o.messageId());
      }
    }
    messageRepo.deleteByIds(accountId, toDelete);
    folderRepo.adjustServerUnread(relocatedUnseen, 1);
    // 트랜잭션 밖 발행은 유실되므로 안에서 보낸다. 사용자 발화라 actor=본인.
    notifier.mailChanged(userId, accountId, null, userId);
  }

  /**
   * 옮긴 메일을 같은 행으로 새 메일함에 둘 수 있는지 — 저장된 메일함으로 옮겼고 새 서버 위치를 안다. IMAP 은 서버가 알려 준 UIDVALIDITY 가 그 메일함에
   * 기록된 값과 같아야 한다.
   */
  private static boolean relocatable(Plan plan, Outcome o) {
    if (plan.destFolderId() == null) {
      return false; // 휴지통
    }
    if (o.newProviderId() != null) {
      return true;
    }
    // 아직 가져오지 않은 메일함(UIDVALIDITY 미기록)은 행을 옮기지 않는다 — 그 메일함 행은 기록된 UIDVALIDITY 로만 서버와 맞춰 볼 수 있어
    // (옮기기 대조·동기화), 기록 없는 행은 다시 옮길 수 없다. 첫 동기화가 다시 넣는다.
    return o.newImapUid() != null
        && plan.destUidValidity() != null
        && plan.destUidValidity().equals(o.newUidValidity());
  }
}

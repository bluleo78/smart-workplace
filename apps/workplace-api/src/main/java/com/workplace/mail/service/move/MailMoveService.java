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
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailFolderRepository.FolderTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.MoveSource;
import com.workplace.mail.service.folder.FolderRole;
import com.workplace.mail.service.move.MailMover.Destination;
import com.workplace.mail.service.move.MailMover.Item;
import com.workplace.mail.service.move.MailMover.Outcome;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
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
 * CASCADE)·개인 AI 판정·이슈 연결이 사라진다. 새 서버 위치를 모르면(UIDPLUS 없는 서버·UIDVALIDITY 불일치) 또는 휴지통 행이 아직 없으면(목록 갱신
 * 전) 로컬 행을 지우고, 대상 메일함의 다음 동기화가 다시 넣는다.
 *
 * <p>WP-1681: 「삭제」도 휴지통 행(role TRASH)으로 같은 행을 옮기고 원래 메일함(original_folder_id)을 남긴다. 「되살리기」(RESTORE)는
 * 그 원래 메일함(없으면 받은편지함)으로 돌린다.
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
   * @param destFolderId 옮길 곳의 로컬 메일함 id(휴지통 행이 아직 없으면 null — 행을 지킬 곳이 없어 지운다)
   * @param destUidValidity 옮길 곳 IMAP UIDVALIDITY(아직 가져오지 않았으면 null)
   */
  private record Plan(
      EmailAccountResponse account,
      List<MoveSource> sources,
      Destination dest,
      Long destFolderId,
      Long destUidValidity) {
    /**
     * 휴지통으로 옮기는지(WP-1681) — 목적지 종류에서 파생한다. 옮긴 행에 원래 메일함을 남기고, 가져오기 전 휴지통이면 COPYUID 의 UIDVALIDITY 를
     * 받아 적는다.
     */
    boolean toTrash() {
      return dest.kind() == Kind.TRASH;
    }
  }

  /**
   * 메일들을 옮긴다. 내 계정이 아니거나 계정에 없는 메일이 하나라도 있으면 404, 앱에서 보낸 기록(보낸편지함)은 400, 보관 메일함이 없는데 보관이면 400, 서버에
   * 휴지통이 없으면 400, 휴지통에 있는 메일을 다시 휴지통으로 보내면 400, 휴지통 밖 메일을 되살리면 400. 서버 접속 실패는 502(첫 계획에서 실패했으면 아무것도
   * 옮기지 않았다). 메일별 서버 실패는 결과에 담고 그 메일은 로컬에서 그대로 둔다. 이미 그 메일함에 있는 메일은 아무것도 하지 않고 성공으로 본다.
   *
   * <p>되살리기(RESTORE, WP-1681)는 메일마다 목적지가 달라 목적지별 계획 여러 개를 차례로 돈다. 앞 계획이 이미 반영된 뒤 뒤 계획이 서버 접속에 실패하면
   * 502 로 돌리지 않고 그 계획의 메일만 실패(ok=false)로 담는다 — 앞 계획은 이미 옮겼기 때문이다. 결과는 언제나 요청 순서다.
   */
  public MailMoveResponse move(long userId, long accountId, MailMoveRequest req) {
    List<Long> ids = List.copyOf(new LinkedHashSet<>(req.messageIds()));
    List<Plan> plans = txTemplate.execute(status -> plans(userId, accountId, ids, req.target()));
    Objects.requireNonNull(plans);

    Map<Long, Outcome> outcomes = new HashMap<>();
    for (Plan plan : plans) {
      try {
        execute(userId, accountId, plan, outcomes);
      } catch (MailSyncException | MailSendException e) {
        if (outcomes.isEmpty()) {
          throw e; // 아직 아무 결과도 기록되지 않았다(앞 계획이 반영된 것이 없다) — 지금처럼 502
        }
        // WP-1681: 앞 계획은 이미 서버·로컬에 반영됐다 — 요청 전체를 502 로 돌리면 웹이 성공한 메일까지 실패로 안다. 이 계획의 메일만 실패로 담는다.
        for (MoveSource s : plan.sources()) {
          outcomes.putIfAbsent(s.messageId(), Outcome.failed(s.messageId(), e.getMessage()));
        }
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

  /** 계획 하나를 실행한다 — ② 서버에서 옮기기(트랜잭션 밖) → ③ 성공한 메일만 로컬 반영. 메일별 결과를 outcomes 에 담는다. */
  private void execute(long userId, long accountId, Plan plan, Map<Long, Outcome> outcomes) {
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
    if (toMove.isEmpty()) {
      return;
    }
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

  /** ① 소유·대상 확인과 옮길 곳 결정(트랜잭션 안). 되살리기만 목적지별로 여러 계획이 나온다. */
  private List<Plan> plans(
      long userId, long accountId, List<Long> ids, MailMoveRequest.Target target) {
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
    if (target.kind() == Kind.RESTORE) {
      // WP-1681: 되살리기는 휴지통 메일만 — 다른 메일함 메일이 섞이면 아무것도 옮기지 않는다.
      if (sources.stream().anyMatch(s -> !isTrash(s))) {
        throw new MailValidationException("휴지통에 있는 메일만 되살릴 수 있습니다");
      }
      return restorePlans(account, accountId, sources);
    }
    // 서버 메일함(role 있음)과 받은편지함만 서버에 있는 메일이다 — 앱에서 보낸 기록(SENT)은 서버 위치가 없다.
    if (sources.stream().anyMatch(s -> s.folderRole() == null && !"INBOX".equals(s.folderName()))) {
      throw new MailValidationException("보낸 메일은 옮길 수 없습니다");
    }
    return List.of(plan(account, accountId, sources, target));
  }

  /** 휴지통 행에 있는 메일인지(WP-1681). */
  private static boolean isTrash(MoveSource s) {
    return FolderRole.TRASH.matches(s.folderRole());
  }

  /** 한 목적지로 옮기는 계획(INBOX·ARCHIVE·FOLDER·TRASH). */
  private Plan plan(
      EmailAccountResponse account,
      long accountId,
      List<MoveSource> sources,
      MailMoveRequest.Target target) {
    return switch (target.kind()) {
      case INBOX -> inboxPlan(account, accountId, sources);
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
        if (FolderRole.TRASH.matches(f.role())) {
          // WP-1681: 휴지통 행 id 로 옮겨도 「삭제」와 같다 — 원래 메일함 기록·이미 휴지통 400·COPYUID UIDVALIDITY 받기를 같은 경로로.
          yield trashPlan(account, accountId, sources);
        }
        yield folderPlan(account, sources, f);
      }
      case TRASH -> trashPlan(account, accountId, sources);
      case RESTORE -> throw new IllegalStateException("되살리기는 restorePlans 가 맡는다");
    };
  }

  /** 휴지통으로 옮기는 계획(WP-1681) — kind TRASH 와, 휴지통 행 id 를 고른 FOLDER 가 함께 쓴다. 이미 휴지통인 메일이 있으면 400. */
  private Plan trashPlan(EmailAccountResponse account, long accountId, List<MoveSource> sources) {
    if (sources.stream().anyMatch(MailMoveService::isTrash)) {
      throw new MailValidationException("이미 휴지통에 있는 메일입니다");
    }
    // WP-1681: 휴지통 행이 있으면 같은 행을 그리로 옮겨 첨부·AI 판정·이슈 연결을 지킨다. 아직 목록을 받지 못해 없으면 지금처럼 지운다.
    // 서버에서 옮길 곳은 지금처럼 공급자가 찾는다(IMAP 은 findTrash, Graph 는 well-known deleteditems) — 휴지통 행도 같은
    // 규칙으로 고른 것이다. 다만 휴지통 행은 지난 목록 갱신 때 고른 것이라, IMAP 은 행 이름을 기대 목적지로 넘겨 옮길 때 찾은 휴지통과
    // 다르면 COPYUID 를 버리게 한다(다른 메일함의 UID·UIDVALIDITY 를 휴지통 행에 적지 않게 — 그때는 행을 지우고 동기화에 맡긴다).
    Optional<FolderTarget> trash = folderRepo.findTrash(accountId);
    return new Plan(
        account,
        sources,
        new Destination(Kind.TRASH, trash.map(FolderTarget::name).orElse(null), "deleteditems"),
        trash.map(FolderTarget::id).orElse(null),
        trash.map(FolderTarget::uidValidity).orElse(null));
  }

  /** 받은편지함으로 옮기는 계획 — IMAP 은 INBOX, Graph 는 well-known inbox. */
  private Plan inboxPlan(EmailAccountResponse account, long accountId, List<MoveSource> sources) {
    EmailFolderRepository.FolderSyncState inbox = folderRepo.ensureFolder(accountId, "INBOX");
    return new Plan(
        account,
        sources,
        new Destination(Kind.INBOX, "INBOX", "inbox"),
        inbox.id(),
        inbox.uidValidity());
  }

  /**
   * 되살리기 계획(WP-1681) — 메일마다 원래 메일함이 받은편지함이거나 옮길 수 있는 보관·사용자 메일함이면 그곳, 아니면(다른 앱에서 지운 메일·원래 메일함이
   * 사라짐·옮길 수 없는 메일함) 받은편지함. 목적지별로 묶어 처음 나온 순서대로 계획을 만든다.
   */
  private List<Plan> restorePlans(
      EmailAccountResponse account, long accountId, List<MoveSource> sources) {
    // 원래 메일함 조회는 메일함 id 당 한 번 — 같은 메일함에서 지운 메일 N 통이 쿼리 N 번을 내지 않게(WP-1681)
    Map<Long, Optional<FolderTarget>> lookedUp = new HashMap<>();
    // 목적지(FolderTarget, null=받은편지함) → 메일. LinkedHashMap 이라 처음 나온 순서가 계획 순서이고, FolderTarget 은 record
    // 라 같은 메일함이면 같은 키다.
    Map<FolderTarget, List<MoveSource>> groups = new LinkedHashMap<>();
    for (MoveSource s : sources) {
      FolderTarget dest = null; // null = 받은편지함
      if (s.originalFolderId() != null) {
        Optional<FolderTarget> original =
            lookedUp.computeIfAbsent(
                s.originalFolderId(), fid -> folderRepo.findTarget(accountId, fid));
        if (original.isPresent() && restorable(original.get())) {
          dest = original.get();
        }
      }
      groups.computeIfAbsent(dest, k -> new ArrayList<>()).add(s);
    }
    List<Plan> plans = new ArrayList<>();
    for (Map.Entry<FolderTarget, List<MoveSource>> g : groups.entrySet()) {
      FolderTarget f = g.getKey();
      // 원래 메일함이 받은편지함 행이면 받은편지함 계획(Graph 는 well-known inbox 로 옮긴다)
      plans.add(
          f == null || f.role() == null
              ? inboxPlan(account, accountId, g.getValue())
              : folderPlan(account, g.getValue(), f));
    }
    return plans;
  }

  /** 되살릴 수 있는 원래 메일함인지 — 받은편지함 행(role 없음·이름 INBOX)이거나 선택 가능한 보관·사용자 메일함. */
  private static boolean restorable(FolderTarget f) {
    if (f.role() == null) {
      return "INBOX".equals(f.name());
    }
    return (FolderRole.ARCHIVE.matches(f.role()) || FolderRole.USER.matches(f.role()))
        && f.selectable();
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
   * ③ 서버에서 옮긴 메일의 로컬 반영(트랜잭션 안). 새 위치를 알면 행을 옮기고, 모르거나 휴지통 행이 없으면 지운다. 옮기기 전 위치 기준으로 서버 메일함 안 읽은 수를
   * 줄이고, 옮긴 뒤 위치 기준으로 늘린다(받은편지함은 adjustServerUnread 가 건드리지 않는다). 바뀐 것이 있으면 계정 단위 변경 알림.
   */
  private void applyLocal(long userId, long accountId, Plan plan, List<Outcome> moved) {
    Map<Long, MoveSource> byId = new HashMap<>();
    plan.sources().forEach(s -> byId.put(s.messageId(), s));
    List<Long> unseen =
        moved.stream().map(Outcome::messageId).filter(id -> !byId.get(id).seen()).toList();
    folderRepo.adjustServerUnread(unseen, -1);

    List<Long> toDelete = new ArrayList<>();
    List<Long> relocatedUnseen = new ArrayList<>();
    Long destUidValidity = plan.destUidValidity();
    for (Outcome o : moved) {
      MoveSource s = byId.get(o.messageId());
      if (plan.toTrash()
          && plan.destFolderId() != null
          && destUidValidity == null
          && o.newImapUid() != null
          && o.newUidValidity() != null) {
        // WP-1681: 아직 가져오지 않은 휴지통 — 서버가 COPYUID 로 알려 준 UIDVALIDITY 를 휴지통 행에 적어 행을 지킨다(휴지통 대상일 때만).
        // 뒤의 첫 동기화는 같은 UID 를 유니크(account, folder, imap_uid)로 다시 넣지 않는다.
        destUidValidity = folderRepo.adoptUidValidity(plan.destFolderId(), o.newUidValidity());
      }
      if (!relocatable(plan.destFolderId(), destUidValidity, o)
          || messageRepo.existsAtDestination(
              accountId, plan.destFolderId(), o.newImapUid(), o.newProviderId())) {
        // 새 위치를 모르거나, 옮기는 사이 대상 메일함 동기화가 같은 메일을 먼저 넣었다 — 원래 행은 지운다.
        toDelete.add(o.messageId());
        continue;
      }
      boolean clearPending = !s.seenPushPending() || o.seenPushed();
      // WP-1681: 휴지통으로 가면 원래 메일함을 남기고(되살리기 목적지), 그 밖(휴지통에서 나가는 경우 포함)은 지운다.
      messageRepo.relocate(
          o.messageId(),
          plan.destFolderId(),
          o.newImapUid(),
          o.newProviderId(),
          clearPending,
          plan.toTrash() ? s.folderId() : null);
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
  private static boolean relocatable(Long destFolderId, Long destUidValidity, Outcome o) {
    if (destFolderId == null) {
      return false; // 휴지통 행이 아직 없다
    }
    if (o.newProviderId() != null) {
      return true;
    }
    // 아직 가져오지 않은 메일함(UIDVALIDITY 미기록)은 행을 옮기지 않는다 — 그 메일함 행은 기록된 UIDVALIDITY 로만 서버와 맞춰 볼 수 있어
    // (옮기기 대조·동기화), 기록 없는 행은 다시 옮길 수 없다. 첫 동기화가 다시 넣는다. 휴지통만은 applyLocal 이 COPYUID 값을 먼저
    // 적는다(WP-1681).
    return o.newImapUid() != null
        && destUidValidity != null
        && destUidValidity.equals(o.newUidValidity());
  }
}

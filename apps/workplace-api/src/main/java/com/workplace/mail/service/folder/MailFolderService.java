package com.workplace.mail.service.folder;

import static java.util.stream.Collectors.toMap;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailFolderResponse;
import com.workplace.mail.dto.MailFolderSyncResult;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailFolderNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailFolderRepository.FolderTarget;
import com.workplace.mail.repository.EmailFolderRepository.ServerFolderRow;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailFetcher;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 서버 메일함 목록(WP-960) — 서버에서 받은 보관·사용자 폴더를 email_folder 에 반영하고, 사이드바용 목록을 DB 에서 읽어 준다.
 *
 * <p>갱신({@link #refresh}): 공급자별 {@link MailFolderLister} 로 서버 목록을 트랜잭션 밖에서 받은 뒤, 한 짧은 트랜잭션({@code
 * txTemplate}, RLS GUC 주입)에서 넣기·갱신 → 부모 연결 → 서버에서 사라진 폴더(와 그 메일) 삭제를 한다. 목록 조회가 실패하면 예외가 그대로 올라가
 * 아무것도 지우지 않는다. 기존 INBOX·SENT 행은 지우거나 바꾸지 않는다(INBOX 의 remote_id 기록만 예외).
 *
 * <p>메일함별 동기화({@link #syncFolder}, Pass B): 보관·사용자 메일함 한 개의 메일을 공급자별 {@link MailFetcher#syncFolder}
 * 로 가져온다. 같은 메일함이 이미 가져오는 중이면 {@link MailFolderSyncGuard} 가 막고 running=true 를 돌려준다.
 */
@Slf4j
@Service
public class MailFolderService {

  /** email_folder.name 길이 한도 — 넘는 서버 경로는 저장하지 않는다. */
  static final int MAX_NAME_LENGTH = 255;

  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;

  /** 공급자 → 목록기. Spring 이 MailFolderLister 빈 목록을 주입한다. */
  private final Map<MailProvider, MailFolderLister> listers;

  /** 공급자 → 메일 가져오기(메일함별 동기화용). */
  private final Map<MailProvider, MailFetcher> fetchers;

  private final MailFolderSyncGuard syncGuard;
  private final MailChangeNotifier notifier;

  /** 짧은-트랜잭션용 TransactionTemplate — TenantAwareTransactionManager 로 RLS GUC 가 주입된다. */
  private final TransactionTemplate txTemplate;

  public MailFolderService(
      EmailAccountRepository accountRepo,
      EmailFolderRepository folderRepo,
      EmailMessageRepository messageRepo,
      List<MailFolderLister> listers,
      List<MailFetcher> fetchers,
      MailFolderSyncGuard syncGuard,
      MailChangeNotifier notifier,
      PlatformTransactionManager txManager) {
    this.accountRepo = accountRepo;
    this.folderRepo = folderRepo;
    this.messageRepo = messageRepo;
    this.listers = listers.stream().collect(toMap(MailFolderLister::provider, l -> l));
    this.fetchers = fetchers.stream().collect(toMap(MailFetcher::provider, f -> f));
    this.syncGuard = syncGuard;
    this.notifier = notifier;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 서버 메일함 한 개의 메일을 가져온다(WP-960). 내 계정이 아니거나 계정에 없는 메일함이면 404, 보관·사용자 메일함이 아니거나(받은편지함·보낸편지함) 메일을 담지
   * 못하는 묶음 메일함이면 400. 같은 메일함을 이미 가져오는 중이면 아무것도 하지 않고 running=true. 새 메일·읽음 변화·삭제가 있으면 같은 트랜잭션 안에서
   * 계정 단위 변경 알림을 보낸다. 서버 오류는 {@link MailSyncException}(502).
   *
   * <p>네트워크 I/O 는 트랜잭션 밖(가져오기 구현 안의 짧은 트랜잭션들), 소유·대상 확인과 결과 읽기만 짧은 트랜잭션이다.
   */
  public MailFolderSyncResult syncFolder(
      long userId, long accountId, long folderId, boolean older) {
    EmailAccountResponse account =
        txTemplate.execute(
            status ->
                accountRepo
                    .findByIdAndUser(userId, accountId)
                    .orElseThrow(() -> new EmailAccountNotFoundException(accountId)));
    FolderTarget folder = loadTarget(accountId, folderId);
    if (folder.role() == null || !folder.selectable()) {
      throw new MailValidationException("이 메일함은 따로 가져올 수 없습니다");
    }
    MailFetcher fetcher = fetchers.get(account.provider());
    if (fetcher == null) {
      throw new MailSyncException("지원하지 않는 메일 공급자: " + account.provider());
    }
    if (!syncGuard.tryStart(accountId, folderId)) {
      return toResult(true, new MailSyncResult(0, 0, 0, 0), folder);
    }
    try {
      MailSyncResult result = fetcher.syncFolder(userId, accountId, account, folder, older);
      FolderTarget after =
          txTemplate.execute(
              status -> {
                // 트랜잭션 밖 발행은 유실되므로 안에서 보낸다(MailSyncService 와 같은 패턴). 시스템 발화라 actor 없음.
                if (result.changed()) {
                  notifier.mailChanged(userId, accountId, null, null);
                }
                return folderRepo
                    .findTarget(accountId, folderId)
                    .orElseThrow(EmailFolderNotFoundException::new);
              });
      return toResult(false, result, after);
    } finally {
      syncGuard.finish(accountId, folderId);
    }
  }

  /** 계정의 메일함을 짧은 트랜잭션으로 읽는다. 없으면 404. */
  private FolderTarget loadTarget(long accountId, long folderId) {
    return txTemplate.execute(
        status ->
            folderRepo
                .findTarget(accountId, folderId)
                .orElseThrow(EmailFolderNotFoundException::new));
  }

  private static MailFolderSyncResult toResult(
      boolean running, MailSyncResult r, FolderTarget folder) {
    return new MailFolderSyncResult(
        running,
        r.fetched(),
        r.saved(),
        r.seenChanged(),
        r.removed(),
        folder.syncedSince() == null ? null : folder.syncedSince().toInstant(),
        folder.folderSyncedAt() == null ? null : folder.folderSyncedAt().toInstant());
  }

  /**
   * 서버 메일함 목록을 받아 반영한다. 호출자는 DB 트랜잭션 밖에서 부른다(목록 조회는 네트워크 I/O).
   *
   * @return 사용자에게 보이는 목록이 바뀌었으면 true(폴더 추가·삭제, 이름·부모·역할·선택 가능·개수 변화). INBOX remote_id 기록·listed_at
   *     갱신만으로는 바뀐 것으로 보지 않는다 — 동기화마다 알림이 나가지 않게.
   * @throws MailSyncException 목록 조회 실패(이때는 아무것도 지우지 않았다)
   */
  public boolean refresh(long userId, long accountId, EmailAccountResponse account) {
    MailFolderLister lister = listers.get(account.provider());
    if (lister == null) {
      return false; // 목록을 지원하지 않는 공급자 — 할 일 없음
    }
    ServerFolderListing listing = lister.list(userId, accountId, account);
    Boolean changed = txTemplate.execute(status -> apply(accountId, listing));
    return Boolean.TRUE.equals(changed);
  }

  /** 목록 반영(트랜잭션 안). 바뀌었는지 전후 스냅샷으로 판정한다. */
  private boolean apply(long accountId, ServerFolderListing listing) {
    List<ServerFolderRow> before = folderRepo.listServerFolders(accountId);

    if (listing.inboxRemoteId() != null) {
      folderRepo.setInboxRemoteId(accountId, listing.inboxRemoteId());
    }

    // 1) 넣기·갱신 — 이름이 너무 긴 폴더는 건너뛴다(그 하위는 부모 없이 최상위로 보인다).
    OffsetDateTime now = OffsetDateTime.now();
    Map<String, ServerFolder> valid = new LinkedHashMap<>();
    for (ServerFolder f : listing.folders()) {
      if (f.key() == null || f.key().length() > MAX_NAME_LENGTH) {
        log.warn("서버 메일함 이름이 너무 길어 건너뜀: accountId={}", accountId);
        continue;
      }
      valid.put(f.key(), f);
    }
    Map<String, Long> idByKey = new HashMap<>();
    for (ServerFolder f : valid.values()) {
      folderRepo
          .upsertServerFolder(
              accountId,
              f.key(),
              f.remoteId(),
              truncate(f.displayName()),
              f.role().name(),
              f.selectable(),
              f.unread(),
              f.total(),
              now)
          .ifPresent(id -> idByKey.put(f.key(), id));
    }

    // 2) 부모 연결 — 모든 행이 생긴 뒤라 깊이 순서와 무관하다. 부모가 저장되지 않았으면 최상위.
    for (ServerFolder f : valid.values()) {
      Long id = idByKey.get(f.key());
      if (id != null) {
        folderRepo.setParent(id, f.parentKey() == null ? null : idByKey.get(f.parentKey()));
      }
    }

    // 3) 서버에서 사라진 폴더 — 메일(본문 GC 포함)을 먼저 지우고 폴더 행을 지운다.
    List<Long> vanished = new ArrayList<>();
    for (ServerFolderRow row : before) {
      if (!valid.containsKey(row.name())) {
        messageRepo.deleteByFolder(row.id());
        vanished.add(row.id());
      }
    }
    folderRepo.deleteServerFolders(accountId, vanished);

    List<ServerFolderRow> after = folderRepo.listServerFolders(accountId);
    return !snapshot(before).equals(snapshot(after));
  }

  /** 사용자에게 보이는 속성만 모은 비교용 스냅샷(id 대신 이름으로 부모를 표현). */
  private static Set<List<Object>> snapshot(List<ServerFolderRow> rows) {
    Map<Long, String> nameById = new HashMap<>();
    rows.forEach(r -> nameById.put(r.id(), r.name()));
    Set<List<Object>> out = new HashSet<>();
    for (ServerFolderRow r : rows) {
      List<Object> s = new ArrayList<>();
      s.add(r.name());
      s.add(r.displayName());
      s.add(r.parentId() == null ? null : nameById.get(r.parentId()));
      s.add(r.role());
      s.add(r.selectable());
      s.add(r.serverUnread());
      s.add(r.serverTotal());
      out.add(s);
    }
    return out;
  }

  private static String truncate(String displayName) {
    if (displayName == null) {
      return null;
    }
    return displayName.length() > MAX_NAME_LENGTH
        ? displayName.substring(0, MAX_NAME_LENGTH)
        : displayName;
  }

  /**
   * 사이드바용 서버 메일함 목록(보관 먼저, 그다음 이름순). 서버에 접속하지 않고 DB 만 읽는다. 내 계정이 아니면 404. RLS GUC 주입을 위해 읽기 전용 트랜잭션
   * 안에서 읽는다.
   */
  @Transactional(readOnly = true)
  public List<MailFolderResponse> list(long userId, long accountId) {
    accountRepo
        .findByIdAndUser(userId, accountId)
        .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    return folderRepo.listServerFolders(accountId).stream()
        .map(
            r ->
                new MailFolderResponse(
                    r.id(),
                    r.displayName(),
                    r.parentId(),
                    r.role(),
                    r.selectable(),
                    r.serverUnread(),
                    r.serverTotal(),
                    r.syncedSince() == null ? null : r.syncedSince().toInstant(),
                    r.folderSyncedAt() == null ? null : r.folderSyncedAt().toInstant()))
        .toList();
  }
}

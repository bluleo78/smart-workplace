package com.workplace.mail.service;

import static java.util.stream.Collectors.toMap;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailFolderRepository.FolderTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.ImapSeenState;
import jakarta.mail.FetchProfile;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.FolderNotFoundException;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import jakarta.mail.search.AndTerm;
import jakarta.mail.search.ComparisonTerm;
import jakarta.mail.search.ReceivedDateTerm;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * IMAP 공급자용 {@link MailFetcher} 구현. {@link MailSyncService} 에서 IMAP 전용 로직을 분리해 provider-neutral
 * 디스패처가 될 수 있도록 추출했다(#499). 비밀번호 복호화·INBOX 폴더 보장·메타 전용 FETCH 를 담당한다.
 *
 * <p>IMAP 세션(네트워크 I/O)은 트랜잭션 밖에서 수행하고, DB 쓰기(메시지 저장)만 메시지 단위 짧은 트랜잭션({@code txTemplate})으로 처리해 DB
 * 커넥션을 최소로 점유한다(#232). 신규 적재 후 같은 세션에서 최근 범위 기존 메일의 FLAGS 만 다시 읽어 서버 읽음 상태를 반영한다(WP-148,
 * best-effort).
 *
 * <p>WP-950: 받은편지함 뒤에 서버 보낸편지함도 같은 흐름으로 동기화해(외부 메일 클라이언트에서 보낸 메일) 서버 폴더 이름의 로컬 폴더에 적재한다.
 *
 * <p>WP-960: 같은 흐름을 서버 메일함(보관·사용자 폴더)에도 쓴다 — 폴더 이름(email_folder.name = 서버 전체 경로)으로 열고, 첫 동기화 기간만
 * {@value MailFetcher#FOLDER_INITIAL_WINDOW_DAYS}일로 다르다. 「이전 메일 더 가져오기」는 날짜 범위 SEARCH 로 받아 넣기만 한다.
 */
@Slf4j
@Service
public class ImapMailFetcher implements MailFetcher {

  /** 받은편지함 폴더 이름. 서버 보낸편지함은 서버 이름 그대로 동기화한다(WP-950, ImapSentFolderLocator). */
  private static final String INBOX = "INBOX";

  /** 첫 동기화 시 가져올 최근 기간(일) — 받은편지함·서버 보낸편지함(WP-950) 같음. 이전 메일 경계(WP-965)도 이 기간을 쓴다. */
  public static final int INITIAL_WINDOW_DAYS = 7;

  /** 읽음 상태 재조회 기간(일) — 이 기간 안의 기존 메일만 서버 FLAGS 를 다시 본다(WP-148). */
  static final int SEEN_SYNC_WINDOW_DAYS = 14;

  /** 읽음 상태 재조회 상한(건) — 기간과 건수 중 작은 쪽. 큰 메일함에서 FETCH 비용을 묶는다(WP-148). */
  static final int SEEN_SYNC_MAX = 500;

  /** WP-959: 서버 삭제 대조를 한 번에 보낼 UID 수 — 명령 길이 한도를 넘지 않게 나눈다. */
  static final int REMOVAL_CHECK_CHUNK = 1000;

  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final EncryptionService encryption;
  private final ImapConnector imapConnector;
  private final MailMessageParser parser;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary {@code TenantAwareTransactionManager} 로 구성해 트랜잭션 진입 시
   * RLS GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate txTemplate;

  /** IMAP 계정의 암호화된 비밀번호 조회를 위한 계정 저장소. */
  private final com.workplace.mail.repository.EmailAccountRepository accountRepo;

  public ImapMailFetcher(
      com.workplace.mail.repository.EmailAccountRepository accountRepo,
      EmailFolderRepository folderRepo,
      EmailMessageRepository messageRepo,
      EncryptionService encryption,
      ImapConnector imapConnector,
      MailMessageParser parser,
      PlatformTransactionManager txManager) {
    this.accountRepo = accountRepo;
    this.folderRepo = folderRepo;
    this.messageRepo = messageRepo;
    this.encryption = encryption;
    this.imapConnector = imapConnector;
    this.parser = parser;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  /**
   * IMAP 에서 신규 메시지 메타를 동기화해 email_message 로 적재한다. 비밀번호 복호화→INBOX 폴더 보장→메타 FETCH 순서. 네트워크/IMAP 오류는
   * {@link MailSyncException}(502) 으로 래핑.
   *
   * <p>WP-950: 받은편지함을 끝까지(저장 포함) 마친 뒤 서버 보낸편지함도 읽어 서버 폴더 이름의 로컬 폴더로 적재한다 — 보낸편지함 첫 동기화의 큰 SEARCH 가
   * 새 메일 적재를 늦추지 않게. 보낸편지함 단계는 best-effort — 실패해도 받은편지함 동기화 결과는 그대로 돌려준다.
   */
  @Override
  public MailSyncResult fetchNewMessages(
      long userId, long accountId, EmailAccountResponse account) {
    String password = password(userId, accountId);
    EmailFolderRepository.FolderSyncState folder =
        txTemplate.execute(status -> folderRepo.ensureFolder(accountId, INBOX));

    // IMAP 네트워크 I/O 는 트랜잭션 밖, 메타 저장은 메시지 단위 짧은 트랜잭션(fetchMetadata 내부).
    MailSyncResult result;
    try {
      Instant since = Instant.now().minus(INITIAL_WINDOW_DAYS, ChronoUnit.DAYS);
      result =
          recordFirstSync(
              folder.id(),
              since,
              fetchMetadata(account, accountId, password, folder, INBOX, since));
    } catch (MessagingException e) {
      throw new MailSyncException("받은편지함 동기화에 실패했습니다", e);
    }
    MailSyncResult sent = syncSent(account, accountId, password);
    return sent == null ? result : result.withSent(sent);
  }

  /**
   * 서버 보낸편지함을 찾아 동기화한다(WP-950, best-effort). 폴더가 없거나 로컬 예약 이름과 겹치면 null, 실패는 경고 로그 후 null — 받은편지함
   * 결과를 막지 않는다. 지난번에 찾은 폴더 이름이 있으면 탐지(전체 폴더 목록 LIST) 없이 그 이름으로 바로 열고, 그 폴더가 없어졌을 때만 다시 찾는다.
   */
  private MailSyncResult syncSent(EmailAccountResponse account, long accountId, String password) {
    try {
      String known =
          txTemplate.execute(status -> folderRepo.findServerSentName(accountId).orElse(null));
      String name = known != null ? known : locateSentName(account, password);
      if (name == null) {
        return null;
      }
      try {
        return syncSentFolder(account, accountId, password, name);
      } catch (FolderNotFoundException e) {
        // 지난번 이름의 폴더가 서버에서 사라졌다(이름 변경·SPECIAL-USE 표시 이동) — 다시 찾아 한 번 더.
        String found = known == null ? null : locateSentName(account, password);
        if (found == null || found.equals(name)) {
          throw e;
        }
        return syncSentFolder(account, accountId, password, found);
      }
    } catch (Exception e) {
      log.warn("보낸편지함 동기화 실패(받은편지함은 계속): accountId={} {}", accountId, e.toString());
      return null;
    }
  }

  /** 서버 보낸편지함 폴더 행을 보장하고 받은편지함과 같은 증분 흐름으로 동기화한다(WP-950). 로컬 예약 이름과 겹치면 null. */
  private MailSyncResult syncSentFolder(
      EmailAccountResponse account, long accountId, String password, String name)
      throws MessagingException {
    EmailFolderRepository.FolderSyncState state =
        txTemplate.execute(
            status -> folderRepo.ensureServerSentFolder(accountId, name).orElse(null));
    if (state == null) {
      log.info("보낸편지함 이름이 로컬 예약 이름과 같아 동기화 생략: accountId={}", accountId);
      return null;
    }
    Instant since = Instant.now().minus(INITIAL_WINDOW_DAYS, ChronoUnit.DAYS);
    return recordFirstSync(
        state.id(), since, fetchMetadata(account, accountId, password, state, name, since));
  }

  /**
   * 받은편지함·서버 보낸편지함 첫 동기화(UIDVALIDITY 변경으로 다시 받기 포함)였으면 받은 범위의 시작을 경계(synced_since)로 기록한다(WP-965 —
   * 이전 메일 더 가져오기가 이 경계 앞부터 잇는다). 증분 동기화면 경계를 그대로 둔다.
   */
  private MailSyncResult recordFirstSync(long folderId, Instant since, FetchOutcome outcome) {
    if (outcome.firstSync()) {
      OffsetDateTime boundary = since.atOffset(ZoneOffset.UTC);
      txTemplate.executeWithoutResult(
          status -> folderRepo.markFolderSynced(folderId, boundary, OffsetDateTime.now()));
    }
    return outcome.result();
  }

  /** 계정 IMAP 비밀번호를 짧은 트랜잭션으로 읽어 복호화한다. 내 계정이 아니면 404. */
  private String password(long userId, long accountId) {
    return txTemplate.execute(
        status ->
            accountRepo
                .findEncryptedPassword(userId, accountId)
                .map(encryption::decrypt)
                .orElseThrow(() -> new EmailAccountNotFoundException(accountId)));
  }

  /**
   * 서버 보낸편지함 폴더 이름을 찾는다(WP-950 — SPECIAL-USE {@code \Sent} → 흔한 이름 후보, ImapSentFolderLocator). 없으면
   * null.
   */
  private String locateSentName(EmailAccountResponse account, String password)
      throws MessagingException {
    Store store = null;
    try {
      store = imapConnector.connect(account, password);
      Folder found = ImapSentFolderLocator.find(store, null);
      return found == null ? null : found.getFullName();
    } finally {
      closeQuietly(null, store);
    }
  }

  /**
   * 서버 메일함 한 개 동기화(WP-960). 받은편지함과 같은 증분 흐름(UID 증분·WP-148 읽음 재조회·WP-959 삭제 대조)을 폴더 이름으로 돌리고, 첫
   * 동기화(또는 UIDVALIDITY 변경으로 다시 받기)면 가져온 경계 synced_since 를 그 시작 시각으로 기록한다. older=true 이고 이미 가져온 폴더면
   * 경계 앞 기간만 더 받는다. 끝나면 folder_synced_at 을 기록한다.
   */
  @Override
  public MailSyncResult syncFolder(
      long userId,
      long accountId,
      EmailAccountResponse account,
      FolderTarget folder,
      boolean older) {
    String password = password(userId, accountId);
    try {
      if (older && folder.syncedSince() != null && folder.uidValidity() != null) {
        Optional<OlderFetch> olderResult = fetchOlder(account, accountId, password, folder, false);
        if (olderResult.isPresent()) {
          return olderResult.get().result();
        }
        // UIDVALIDITY 가 바뀌어 저장된 UID 를 믿을 수 없다 — 아래 일반 동기화가 폐기·다시 받기를 맡는다.
      }
      // 경계는 초 단위로 맞춰 둔다(Graph 필터 값과 같은 표현 — 저장값으로 요청을 재현할 수 있게).
      Instant since =
          Instant.now()
              .minus(FOLDER_INITIAL_WINDOW_DAYS, ChronoUnit.DAYS)
              .truncatedTo(ChronoUnit.SECONDS);
      FetchOutcome outcome =
          fetchMetadata(account, accountId, password, folder.syncState(), folder.name(), since);
      OffsetDateTime newSince = outcome.firstSync() ? since.atOffset(ZoneOffset.UTC) : null;
      txTemplate.executeWithoutResult(
          status -> folderRepo.markFolderSynced(folder.id(), newSince, OffsetDateTime.now()));
      return outcome.result();
    } catch (MessagingException e) {
      throw new MailSyncException("메일함 동기화에 실패했습니다", e);
    }
  }

  /**
   * 이전 메일 더 가져오기(WP-960) — [synced_since − {@value MailFetcher#FOLDER_INITIAL_WINDOW_DAYS}일,
   * synced_since) 수신분을 받아 넣기만 한다. 증분 커서(last_seen_uid)는 건드리지 않는다 — 이 범위의 UID 는 커서보다 작아 다음 증분과 겹치지
   * 않고, 겹치더라도 (account_id, folder_id, imap_uid) 유니크로 무시된다. 끝나면 synced_since 를 범위 시작으로 옮긴다.
   *
   * <p>IMAP SEARCH 의 날짜 비교(SINCE·BEFORE)는 날 단위라 경계일 메일이 앞뒤 범위에 함께 걸릴 수 있다 — 넣기는 멱등이라 문제없다.
   *
   * @param probeMore 같은 세션에서 새 경계 앞에 메일이 더 있는지도 확인할지(WP-965 받은편지함·보낸편지함). 아니면 hasMore=false
   * @return UIDVALIDITY 가 바뀌었으면 empty(저장된 메일을 믿을 수 없어 일반 동기화로 넘긴다)
   */
  private Optional<OlderFetch> fetchOlder(
      EmailAccountResponse account,
      long accountId,
      String password,
      FolderTarget folder,
      boolean probeMore)
      throws MessagingException {
    Instant to = folder.syncedSince().toInstant();
    Instant from = to.minus(FOLDER_INITIAL_WINDOW_DAYS, ChronoUnit.DAYS);
    List<ParsedMessage> parsedList = new ArrayList<>();
    int fetched = 0;
    boolean hasMore = false;
    Store store = null;
    Folder box = null;
    try {
      store = imapConnector.connect(account, password);
      box = store.getFolder(folder.name());
      box.open(Folder.READ_ONLY);
      UIDFolder uidFolder = (UIDFolder) box;
      if (uidFolder.getUIDValidity() != folder.uidValidity()) {
        return Optional.empty();
      }
      Message[] messages =
          box.search(
              new AndTerm(
                  new ReceivedDateTerm(ComparisonTerm.GE, Date.from(from)),
                  new ReceivedDateTerm(ComparisonTerm.LT, Date.from(to))));
      prefetchMetadata(box, messages);
      for (Message msg : messages) {
        if (msg == null) {
          continue;
        }
        long uid = uidFolder.getUID(msg);
        fetched++;
        try {
          parsedList.add(parser.parseMetadata(uid, msg));
        } catch (Exception e) {
          log.warn("메일 메타 파싱 중 건너뜀 (uid={}): {}", uid, e.toString());
        }
      }
      if (probeMore) {
        // 새 경계 앞 메일이 하나라도 있는지 — SEARCH 는 번호만 돌려줘 메타를 받지 않는다
        hasMore = box.search(new ReceivedDateTerm(ComparisonTerm.LT, Date.from(from))).length > 0;
      }
    } finally {
      closeQuietly(box, store);
    }
    int saved = insertAll(accountId, folder.id(), parsedList);
    OffsetDateTime newSince = from.atOffset(ZoneOffset.UTC);
    txTemplate.executeWithoutResult(
        status -> folderRepo.markFolderSynced(folder.id(), newSince, OffsetDateTime.now()));
    return Optional.of(
        new OlderFetch(new MailSyncResult(fetched, saved, 0, 0), from, hasMore, true));
  }

  /**
   * 받은편지함·서버 보낸편지함의 이전 메일 더 가져오기(WP-965). 메일함의 「이전 메일 더 가져오기」({@link #fetchOlder})를 같은 세션의 더 있는지
   * 확인과 함께 쓴다. 아직 첫 동기화 전(UIDVALIDITY 없음)이거나 UIDVALIDITY 가 바뀌었으면 받지 않고 ready=false — 정기 동기화가 폐기·다시
   * 받기를 맡는다.
   */
  @Override
  public OlderFetch fetchOlderBefore(
      long userId, long accountId, EmailAccountResponse account, FolderTarget folder) {
    if (folder.uidValidity() == null || folder.syncedSince() == null) {
      return OlderFetch.notReady();
    }
    String password = password(userId, accountId);
    try {
      return fetchOlder(account, accountId, password, folder, true).orElseGet(OlderFetch::notReady);
    } catch (MessagingException e) {
      throw new MailSyncException("이전 메일을 가져오지 못했습니다", e);
    }
  }

  /** 파싱한 메타를 메시지별 짧은 트랜잭션으로 넣고 새로 들어간 수를 돌려준다. 개별 저장 실패는 격리한다(실패해도 진행 — 커서는 호출자가 관리). */
  private int insertAll(long accountId, long folderId, List<ParsedMessage> parsedList) {
    int saved = 0;
    for (ParsedMessage parsed : parsedList) {
      try {
        boolean inserted =
            Boolean.TRUE.equals(
                txTemplate.execute(
                    status ->
                        messageRepo.insertIgnoreConflict(accountId, folderId, parsed).isPresent()));
        if (inserted) {
          saved++;
        }
      } catch (Exception e) {
        log.warn("메일 메타 저장 중 건너뜀: {}", e.toString());
      }
    }
    return saved;
  }

  /** fetchMetadata 결과 — 동기화 결과와, 이번이 첫 동기화(또는 UIDVALIDITY 변경으로 다시 받기)였는지. */
  private record FetchOutcome(MailSyncResult result, boolean firstSync) {}

  /**
   * IMAP 에서 대상 메시지의 <b>메타만</b> 받아 저장한다(본문 미수집). 첫 동기화는 최근 {@value #INITIAL_WINDOW_DAYS}일 SEARCH,
   * 이후는 UID 증분. 메시지별 파싱/저장 실패는 격리하고 커서를 전진시켜 영구 재시도(무한 정지)를 방지한다.
   *
   * <p>1단계(IMAP 네트워크 I/O, 트랜잭션 밖)에서 메타를 {@link ParsedMessage} DTO 로 수집만 하고, 2단계(DB 쓰기)에서 메시지별 짧은
   * 트랜잭션으로 저장한다 — IMAP 세션 동안 DB 커넥션을 점유하지 않으면서도 각 쓰기에 RLS GUC 를 주입한다(#232).
   *
   * <p>WP-148: 같은 세션에서 최근 범위 기존 메일의 FLAGS 만 다시 읽고(1단계), 신규 저장 뒤 \Seen 차이를 반영한다(2단계). 이 단계의 실패는 경고
   * 로그만 남기고 신규 적재·커서 전진을 막지 않는다.
   *
   * <p>WP-959: 같은 세션에서 로컬에 적재된 UID 가 서버에 아직 있는지 대조하고(1단계), 다른 앱에서 옮겼거나 지워 서버에 없는 메일을 로컬에서도
   * 지운다(2단계). 증분 동기화는 새 UID 만 받으므로 이 대조가 없으면 사라진 메일이 받은편지함에 영원히 남는다. 실패는 경고 로그만 남긴다.
   */
  private FetchOutcome fetchMetadata(
      EmailAccountResponse account,
      long accountId,
      String password,
      EmailFolderRepository.FolderSyncState folder,
      String folderName,
      Instant initialSince)
      throws MessagingException {
    // WP-148: 읽음 재조회 대상(로컬 기존 메일 중 최근 범위)을 IMAP 세션을 열기 전에 짧은 트랜잭션으로 고른다. 첫 동기화면 대상 없음.
    List<ImapSeenState> seenCandidates = loadSeenCandidates(accountId, folder);
    // WP-959: 서버에 아직 있는지 대조할 로컬 UID 전부. 첫 동기화면 대상 없음.
    List<Long> localUids = loadLocalUids(accountId, folder);

    // === 1단계: IMAP 네트워크 I/O (트랜잭션 밖) — 메타 파싱 후 DTO 로 수집만 하고 DB 는 건드리지 않는다. ===
    Store store = null;
    Folder inbox = null;
    long uidValidity;
    boolean uidValidityChanged = false;
    boolean firstSync;
    int fetched = 0;
    long maxUid;
    List<ParsedMessage> parsedList = new ArrayList<>();
    List<ImapSeenState> seenChanges = List.of();
    List<Long> removedUids = List.of();
    try {
      store = imapConnector.connect(account, password);
      inbox = store.getFolder(folderName); // WP-960: 받은편지함 또는 서버 메일함(전체 경로)
      inbox.open(Folder.READ_ONLY);
      UIDFolder uidFolder = (UIDFolder) inbox;

      uidValidity = uidFolder.getUIDValidity();
      long lastSeenUid = folder.lastSeenUid();
      firstSync = folder.uidValidity() == null;
      // UIDVALIDITY 변경 → UID 재사용 가능 → 기존 메시지 폐기(2단계) + 첫 동기화처럼 재적재.
      if (!firstSync && folder.uidValidity() != uidValidity) {
        uidValidityChanged = true;
        lastSeenUid = 0;
        firstSync = true;
      }

      Message[] messages =
          firstSync
              ? searchRecent(inbox, initialSince)
              : uidFolder.getMessagesByUID(lastSeenUid + 1, UIDFolder.LASTUID);
      prefetchMetadata(inbox, messages);

      maxUid = lastSeenUid;
      for (Message msg : messages) {
        if (msg == null) {
          continue;
        }
        long uid = uidFolder.getUID(msg);
        if (uid <= lastSeenUid) {
          continue; // LASTUID 클램핑으로 끌려온 기존 메시지 — 건너뜀
        }
        fetched++;
        // 개별 메시지 파싱 실패가 동기화 전체를 막지 않도록 격리한다. 실패해도 커서를 전진시킨다.
        try {
          parsedList.add(parser.parseMetadata(uid, msg));
        } catch (Exception e) {
          // 자격증명 등 민감정보 노출 방지를 위해 uid 와 예외 요약만 기록한다.
          log.warn("메일 메타 파싱 중 건너뜀 (uid={}): {}", uid, e.toString());
        }
        if (uid > maxUid) {
          maxUid = uid;
        }
      }

      // 첫 동기화(UIDVALIDITY 변경 포함)는 창(받은편지함 7일·메일함 90일) 안만 받는다. 커서를 창 안 최대 UID 에 두면, 창 안 메일이
      // 없거나 적을 때 다음 증분(lastSeen+1 ~ LASTUID)이 창 밖 과거 메일 전체를 끌어온다 — 서버의 UIDNEXT−1(지금 폴더의 마지막 UID)까지
      // 커서를 올려 「지금 이후 들어오는 메일」만 증분으로 받게 한다. UIDNEXT 를 모르면(-1·오류) 기존 동작을 유지한다.
      if (firstSync) {
        maxUid = Math.max(maxUid, uidNextMinusOne(uidFolder));
      }

      // WP-148: 같은 세션에서 기존 메일의 FLAGS 만 재조회(본문 미조회). UIDVALIDITY 가 바뀌었으면 저장된 UID 가 무의미해 건너뛴다.
      if (!uidValidityChanged) {
        seenChanges = fetchSeenChanges(uidFolder, inbox, seenCandidates);
        removedUids = findRemovedUids(uidFolder, localUids);
      }
    } finally {
      closeQuietly(inbox, store);
    }

    // === 2단계: DB 쓰기 (메시지별 짧은 트랜잭션) — IMAP 세션은 이미 닫혔다. 계정당 동기화 직렬화로 폐기-재적재 사이 경합 없음. ===
    if (uidValidityChanged) {
      txTemplate.executeWithoutResult(status -> messageRepo.deleteByFolder(folder.id()));
    }
    // 개별 저장 실패가 동기화 전체를 막지 않도록 메시지별 짧은 트랜잭션으로 격리한다(실패해도 진행 — 커서는 이미 전진).
    int saved = insertAll(accountId, folder.id(), parsedList);
    // WP-148: 신규 저장 뒤 읽음 변화 반영(best-effort — 실패해도 커서 저장·동기화 성공은 그대로)
    int seenChanged = applySeenChanges(accountId, folder.id(), seenChanges);
    // WP-959: 서버에서 사라진 메일을 로컬에서도 지운다(best-effort)
    int removed = applyRemovals(accountId, folder.id(), removedUids);
    long finalMaxUid = maxUid;
    long finalUidValidity = uidValidity;
    txTemplate.executeWithoutResult(
        status -> folderRepo.updateSyncState(folder.id(), finalUidValidity, finalMaxUid));
    return new FetchOutcome(new MailSyncResult(fetched, saved, seenChanged, removed), firstSync);
  }

  /**
   * 읽음 재조회 대상 로컬 메일(WP-148). 첫 동기화(uidValidity 미기록)면 비교할 기존 메일이 없어 빈 목록. 조회 실패는 경고 로그 후 빈 목록 — 신규
   * 적재를 막지 않는다.
   *
   * <p>로컬 열람의 서버 반영 대기(seen_push_pending) 행은 제외된다. 반영이 계속 실패하면 재시도 배치가 상한에서 대기를 풀어 그 뒤부터 서버 값을
   * 따른다(WP-188).
   */
  private List<ImapSeenState> loadSeenCandidates(
      long accountId, EmailFolderRepository.FolderSyncState folder) {
    if (folder.uidValidity() == null) {
      return List.of();
    }
    try {
      OffsetDateTime since = OffsetDateTime.now().minusDays(SEEN_SYNC_WINDOW_DAYS);
      List<ImapSeenState> found =
          txTemplate.execute(
              status ->
                  messageRepo.listRecentImapSeenStates(
                      accountId, folder.id(), since, SEEN_SYNC_MAX));
      return found == null ? List.of() : found;
    } catch (Exception e) {
      log.warn("IMAP 읽음 동기화 대상 조회 실패(신규 적재는 계속): accountId={} {}", accountId, e.toString());
      return List.of();
    }
  }

  /**
   * 열린 세션에서 대상 UID 의 FLAGS 만 받아 로컬과 \Seen 이 다른 것만 돌려준다(WP-148). 서버에서 지워진 UID(null)는 건너뛴다 — 삭제 반영은
   * {@link #findRemovedUids} 가 맡는다. 실패는 경고 로그 후 빈 목록.
   */
  private List<ImapSeenState> fetchSeenChanges(
      UIDFolder uidFolder, Folder inbox, List<ImapSeenState> candidates) {
    if (candidates.isEmpty()) {
      return List.of();
    }
    try {
      long[] uids = candidates.stream().mapToLong(ImapSeenState::imapUid).toArray();
      Message[] present =
          Arrays.stream(uidFolder.getMessagesByUID(uids))
              .filter(Objects::nonNull)
              .toArray(Message[]::new);
      if (present.length == 0) {
        return List.of();
      }
      // UID·FLAGS 만 일괄 선반입 — 본문·헤더는 받지 않는다
      FetchProfile fp = new FetchProfile();
      fp.add(UIDFolder.FetchProfileItem.UID);
      fp.add(FetchProfile.Item.FLAGS);
      inbox.fetch(present, fp);

      Map<Long, Boolean> localSeen =
          candidates.stream().collect(toMap(ImapSeenState::imapUid, ImapSeenState::seen));
      List<ImapSeenState> changes = new ArrayList<>();
      for (Message msg : present) {
        long uid = uidFolder.getUID(msg);
        boolean serverSeen = msg.isSet(Flags.Flag.SEEN);
        Boolean local = localSeen.get(uid);
        // 서버 기준 — 로컬과 다르면 서버 값으로(안읽음 되돌림 포함)
        if (local != null && local != serverSeen) {
          changes.add(new ImapSeenState(uid, serverSeen));
        }
      }
      return changes;
    } catch (Exception e) {
      log.warn("IMAP 읽음 상태 재조회 실패(신규 적재는 계속): {}", e.toString());
      return List.of();
    }
  }

  /** 읽음 변화를 한 트랜잭션으로 반영하고 실제 바뀐 건수를 돌려준다(WP-148). 실패는 경고 로그 후 0 — 동기화 성공은 유지. */
  private int applySeenChanges(long accountId, long folderId, List<ImapSeenState> changes) {
    if (changes.isEmpty()) {
      return 0;
    }
    try {
      Integer changed =
          txTemplate.execute(
              status -> {
                int n = 0;
                for (ImapSeenState c : changes) {
                  n += messageRepo.updateSeenByImapUid(accountId, folderId, c.imapUid(), c.seen());
                }
                return n;
              });
      return changed == null ? 0 : changed;
    } catch (Exception e) {
      log.warn("IMAP 읽음 상태 반영 실패(신규 적재는 계속): accountId={} {}", accountId, e.toString());
      return 0;
    }
  }

  /** 서버 대조 대상 로컬 UID(WP-959). 첫 동기화면 빈 목록. 조회 실패는 경고 로그 후 빈 목록 — 신규 적재를 막지 않는다. */
  private List<Long> loadLocalUids(long accountId, EmailFolderRepository.FolderSyncState folder) {
    if (folder.uidValidity() == null) {
      return List.of();
    }
    try {
      List<Long> found =
          txTemplate.execute(status -> messageRepo.listImapUids(accountId, folder.id()));
      return found == null ? List.of() : found;
    } catch (Exception e) {
      log.warn("IMAP 삭제 대조 대상 조회 실패(신규 적재는 계속): accountId={} {}", accountId, e.toString());
      return List.of();
    }
  }

  /**
   * 로컬 UID 중 서버 폴더에 더 없는 것을 돌려준다(WP-959). {@code UID FETCH} 는 없는 UID 를 null 로 돌려주므로 메타·본문을 받지 않고
   * UID 만으로 대조한다. 실패는 경고 로그 후 빈 목록 — 확인하지 못한 메일을 지우지 않는다.
   */
  private List<Long> findRemovedUids(UIDFolder uidFolder, List<Long> localUids) {
    if (localUids.isEmpty()) {
      return List.of();
    }
    try {
      List<Long> removed = new ArrayList<>();
      // 로컬 메일이 많으면 한 명령이 서버 명령 길이 한도를 넘을 수 있어 묶음으로 나눠 대조한다.
      for (int from = 0; from < localUids.size(); from += REMOVAL_CHECK_CHUNK) {
        long[] uids =
            localUids.subList(from, Math.min(from + REMOVAL_CHECK_CHUNK, localUids.size())).stream()
                .mapToLong(Long::longValue)
                .toArray();
        Message[] onServer = uidFolder.getMessagesByUID(uids);
        for (int i = 0; i < uids.length; i++) {
          if (onServer[i] == null) {
            removed.add(uids[i]);
          }
        }
      }
      return removed;
    } catch (Exception e) {
      log.warn("IMAP 삭제 대조 실패(신규 적재는 계속): {}", e.toString());
      return List.of();
    }
  }

  /** 서버에서 사라진 메일을 한 트랜잭션으로 지우고 지운 건수를 돌려준다(WP-959). 실패는 경고 로그 후 0 — 동기화 성공은 유지. */
  private int applyRemovals(long accountId, long folderId, List<Long> removedUids) {
    if (removedUids.isEmpty()) {
      return 0;
    }
    try {
      Integer deleted =
          txTemplate.execute(
              status -> messageRepo.deleteByImapUids(accountId, folderId, removedUids));
      return deleted == null ? 0 : deleted;
    } catch (Exception e) {
      log.warn("IMAP 삭제 반영 실패(신규 적재는 계속): accountId={} {}", accountId, e.toString());
      return 0;
    }
  }

  /** 폴더의 UIDNEXT − 1(마지막으로 배정된 UID). 서버가 알려 주지 않거나 실패하면 0 — 커서를 올리지 않는다. */
  private static long uidNextMinusOne(UIDFolder uidFolder) {
    try {
      long next = uidFolder.getUIDNext();
      return next > 0 ? next - 1 : 0;
    } catch (MessagingException e) {
      log.warn("IMAP UIDNEXT 조회 실패(커서는 창 안 최대 UID 유지): {}", e.toString());
      return 0;
    }
  }

  /** since 이후 수신 메시지 검색(첫 동기화 범위 한정 — 받은편지함 {@value #INITIAL_WINDOW_DAYS}일, 서버 메일함 90일). */
  private Message[] searchRecent(Folder inbox, Instant since) throws MessagingException {
    return inbox.search(new ReceivedDateTerm(ComparisonTerm.GE, Date.from(since)));
  }

  /** 헤더/플래그/봉투/구조를 일괄 선반입해 메시지별 라운드트립을 줄인다(전체 헤더 HEADERS 포함). 본문(getContent)은 받지 않는다 — 메타 전용. */
  private void prefetchMetadata(Folder inbox, Message[] messages) throws MessagingException {
    if (messages.length == 0) {
      return;
    }
    FetchProfile fp = new FetchProfile();
    fp.add(UIDFolder.FetchProfileItem.UID);
    fp.add(FetchProfile.Item.FLAGS);
    fp.add(FetchProfile.Item.ENVELOPE);
    fp.add(FetchProfile.Item.CONTENT_INFO);
    fp.add(IMAPFolder.FetchProfileItem.HEADERS); // 전체 헤더 일괄(메시지별 헤더 왕복 제거)
    inbox.fetch(messages, fp);
  }

  private void closeQuietly(Folder inbox, Store store) {
    try {
      if (inbox != null && inbox.isOpen()) {
        inbox.close(false);
      }
    } catch (MessagingException ignored) {
      // 동기화 결과에 영향 없음
    }
    try {
      if (store != null) {
        store.close();
      }
    } catch (MessagingException ignored) {
      // 동기화 결과에 영향 없음
    }
  }
}

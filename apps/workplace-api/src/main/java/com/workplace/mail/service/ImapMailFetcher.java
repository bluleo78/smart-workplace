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
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.ImapSeenState;
import jakarta.mail.FetchProfile;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import jakarta.mail.search.ComparisonTerm;
import jakarta.mail.search.ReceivedDateTerm;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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
 */
@Slf4j
@Service
public class ImapMailFetcher implements MailFetcher {

  /** v1 동기화 대상 폴더. */
  private static final String INBOX = "INBOX";

  /** 첫 동기화 시 가져올 최근 기간(일). */
  private static final int INITIAL_WINDOW_DAYS = 7;

  /** 읽음 상태 재조회 기간(일) — 이 기간 안의 기존 메일만 서버 FLAGS 를 다시 본다(WP-148). */
  static final int SEEN_SYNC_WINDOW_DAYS = 14;

  /** 읽음 상태 재조회 상한(건) — 기간과 건수 중 작은 쪽. 큰 메일함에서 FETCH 비용을 묶는다(WP-148). */
  static final int SEEN_SYNC_MAX = 500;

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
   */
  @Override
  public MailSyncResult fetchNewMessages(
      long userId, long accountId, EmailAccountResponse account) {
    String password =
        txTemplate.execute(
            status ->
                accountRepo
                    .findEncryptedPassword(userId, accountId)
                    .map(encryption::decrypt)
                    .orElseThrow(() -> new EmailAccountNotFoundException(accountId)));
    EmailFolderRepository.FolderSyncState folder =
        txTemplate.execute(status -> folderRepo.ensureFolder(accountId, INBOX));

    // IMAP 네트워크 I/O 는 트랜잭션 밖, 메타 저장은 메시지 단위 짧은 트랜잭션(fetchMetadata 내부).
    try {
      return fetchMetadata(account, accountId, password, folder);
    } catch (MessagingException e) {
      throw new MailSyncException("받은편지함 동기화에 실패했습니다", e);
    }
  }

  /**
   * IMAP 에서 대상 메시지의 <b>메타만</b> 받아 저장한다(본문 미수집). 첫 동기화는 최근 {@value #INITIAL_WINDOW_DAYS}일 SEARCH,
   * 이후는 UID 증분. 메시지별 파싱/저장 실패는 격리하고 커서를 전진시켜 영구 재시도(무한 정지)를 방지한다.
   *
   * <p>1단계(IMAP 네트워크 I/O, 트랜잭션 밖)에서 메타를 {@link ParsedMessage} DTO 로 수집만 하고, 2단계(DB 쓰기)에서 메시지별 짧은
   * 트랜잭션으로 저장한다 — IMAP 세션 동안 DB 커넥션을 점유하지 않으면서도 각 쓰기에 RLS GUC 를 주입한다(#232).
   *
   * <p>WP-148: 같은 세션에서 최근 범위 기존 메일의 FLAGS 만 다시 읽고(1단계), 신규 저장 뒤 \Seen 차이를 반영한다(2단계). 이 단계의 실패는 경고
   * 로그만 남기고 신규 적재·커서 전진을 막지 않는다.
   */
  private MailSyncResult fetchMetadata(
      EmailAccountResponse account,
      long accountId,
      String password,
      EmailFolderRepository.FolderSyncState folder)
      throws MessagingException {
    // WP-148: 읽음 재조회 대상(로컬 기존 메일 중 최근 범위)을 IMAP 세션을 열기 전에 짧은 트랜잭션으로 고른다. 첫 동기화면 대상 없음.
    List<ImapSeenState> seenCandidates = loadSeenCandidates(accountId, folder);

    // === 1단계: IMAP 네트워크 I/O (트랜잭션 밖) — 메타 파싱 후 DTO 로 수집만 하고 DB 는 건드리지 않는다. ===
    Store store = null;
    Folder inbox = null;
    long uidValidity;
    boolean uidValidityChanged = false;
    int fetched = 0;
    long maxUid;
    List<ParsedMessage> parsedList = new ArrayList<>();
    List<ImapSeenState> seenChanges = List.of();
    try {
      store = imapConnector.connect(account, password);
      inbox = store.getFolder(INBOX);
      inbox.open(Folder.READ_ONLY);
      UIDFolder uidFolder = (UIDFolder) inbox;

      uidValidity = uidFolder.getUIDValidity();
      long lastSeenUid = folder.lastSeenUid();
      boolean firstSync = folder.uidValidity() == null;
      // UIDVALIDITY 변경 → UID 재사용 가능 → 기존 메시지 폐기(2단계) + 첫 동기화처럼 재적재.
      if (!firstSync && folder.uidValidity() != uidValidity) {
        uidValidityChanged = true;
        lastSeenUid = 0;
        firstSync = true;
      }

      Message[] messages =
          firstSync
              ? searchRecent(inbox)
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

      // WP-148: 같은 세션에서 기존 메일의 FLAGS 만 재조회(본문 미조회). UIDVALIDITY 가 바뀌었으면 저장된 UID 가 무의미해 건너뛴다.
      if (!uidValidityChanged) {
        seenChanges = fetchSeenChanges(uidFolder, inbox, seenCandidates);
      }
    } finally {
      closeQuietly(inbox, store);
    }

    // === 2단계: DB 쓰기 (메시지별 짧은 트랜잭션) — IMAP 세션은 이미 닫혔다. 계정당 동기화 직렬화로 폐기-재적재 사이 경합 없음. ===
    if (uidValidityChanged) {
      txTemplate.executeWithoutResult(status -> messageRepo.deleteByFolder(folder.id()));
    }
    int saved = 0;
    for (ParsedMessage parsed : parsedList) {
      // 개별 저장 실패가 동기화 전체를 막지 않도록 메시지별 짧은 트랜잭션으로 격리한다(실패해도 진행 — 커서는 이미 전진).
      try {
        boolean inserted =
            Boolean.TRUE.equals(
                txTemplate.execute(
                    status ->
                        messageRepo
                            .insertIgnoreConflict(accountId, folder.id(), parsed)
                            .isPresent()));
        if (inserted) {
          saved++;
        }
      } catch (Exception e) {
        log.warn("메일 메타 저장 중 건너뜀: {}", e.toString());
      }
    }
    // WP-148: 신규 저장 뒤 읽음 변화 반영(best-effort — 실패해도 커서 저장·동기화 성공은 그대로)
    int seenChanged = applySeenChanges(accountId, folder.id(), seenChanges);
    long finalMaxUid = maxUid;
    long finalUidValidity = uidValidity;
    txTemplate.executeWithoutResult(
        status -> folderRepo.updateSyncState(folder.id(), finalUidValidity, finalMaxUid));
    return new MailSyncResult(fetched, saved, seenChanged);
  }

  /**
   * 읽음 재조회 대상 로컬 메일(WP-148). 첫 동기화(uidValidity 미기록)면 비교할 기존 메일이 없어 빈 목록. 조회 실패는 경고 로그 후 빈 목록 — 신규
   * 적재를 막지 않는다.
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
   * 열린 세션에서 대상 UID 의 FLAGS 만 받아 로컬과 \Seen 이 다른 것만 돌려준다(WP-148). 서버에서 지워진 UID(null)는 건너뛴다 — 삭제 반영은 이
   * 작업 범위 밖. 실패는 경고 로그 후 빈 목록.
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

  /** 최근 {@value #INITIAL_WINDOW_DAYS}일 수신 메시지 검색(첫 동기화 범위 한정). */
  private Message[] searchRecent(Folder inbox) throws MessagingException {
    Date since = Date.from(Instant.now().minus(INITIAL_WINDOW_DAYS, ChronoUnit.DAYS));
    return inbox.search(new ReceivedDateTerm(ComparisonTerm.GE, since));
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

package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import jakarta.mail.FetchProfile;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import jakarta.mail.search.ComparisonTerm;
import jakarta.mail.search.ReceivedDateTerm;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * IMAP 받은편지함을 워크플레이스 DB 로 동기화한다(v1 = INBOX, 온디맨드 폴링) — <b>목록 메타데이터 전용</b>. 본문/첨부는 받지 않고 헤더/봉투/플래그만
 * 일괄 FETCH 해 빠르게 저장하며, 본문은 메일 열람(OnDemand) 또는 동기화 직후 비동기 백그라운드 보충({@link MailBackfillService})으로
 * 채운다.
 *
 * <p>범위/증분:
 *
 * <ul>
 *   <li>첫 동기화(UIDVALIDITY 미기록)는 최근 {@value #INITIAL_WINDOW_DAYS}일을 IMAP SEARCH 로 한정해 대용량 메일함의 초기
 *       폭주를 막는다.
 *   <li>이후는 UID 증분(last_seen_uid+1 ~ LASTUID). LASTUID 클램핑으로 끌려온 기존 메시지는 커서로 거른다.
 *   <li>UIDVALIDITY 가 바뀌면 서버가 UID 를 재사용하므로 폴더의 기존 메시지를 비우고 첫 동기화처럼 재적재.
 * </ul>
 *
 * <p>원래 설계는 네트워크 I/O 를 트랜잭션 밖에서 수행했고(긴 트랜잭션 제거), RLS 도입(#230) 으로 잠시 IMAP 세션 전체를 @Transactional 안에서
 * 돌렸으나, #232 에서 다시 IMAP 네트워크 I/O 를 트랜잭션 밖으로 빼고 DB 쓰기 구간만 메시지 단위 짧은 트랜잭션({@code txTemplate}, GUC
 * 주입)으로 좁혔다. 계정당 동시 동기화는 {@link MailSyncProgress} 가드로 직렬화해 둘째 클릭이 영구 정지하던 데드락을 제거한다(폐기-재적재 사이 경합도 이
 * 직렬화로 방지). 진행 상태는 in-memory 홀더에 두고 sync-status 폴링으로 노출한다.
 */
@Slf4j
@Service
public class MailSyncService {

  /** v1 동기화 대상 폴더. */
  private static final String INBOX = "INBOX";

  /** 첫 동기화 시 가져올 최근 기간(일). */
  private static final int INITIAL_WINDOW_DAYS = 7;

  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final EncryptionService encryption;
  private final ImapConnector imapConnector;
  private final MailMessageParser parser;
  private final MailSyncProgress progress;
  private final MailBackfillService backfillService;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary {@code TenantAwareTransactionManager} 로 구성해 트랜잭션 진입 시
   * RLS GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate txTemplate;

  public MailSyncService(
      EmailAccountRepository accountRepo,
      EmailFolderRepository folderRepo,
      EmailMessageRepository messageRepo,
      EncryptionService encryption,
      ImapConnector imapConnector,
      MailMessageParser parser,
      MailSyncProgress progress,
      MailBackfillService backfillService,
      PlatformTransactionManager txManager) {
    this.accountRepo = accountRepo;
    this.folderRepo = folderRepo;
    this.messageRepo = messageRepo;
    this.encryption = encryption;
    this.imapConnector = imapConnector;
    this.parser = parser;
    this.progress = progress;
    this.backfillService = backfillService;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 본인 계정 INBOX 의 목록 메타를 동기화(본문 제외). 소유 아니면 404, 메일 서버 오류면 502. 이미 진행 중이면 빈 결과 반환(가드 — 진행률은
   * sync-status 로 확인). 완료 후 미적재 본문이 있으면 비동기 백그라운드 보충을 트리거한다.
   *
   * <p>RLS GUC(app.tenant_id)는 트랜잭션-로컬이라 소유 검증 SELECT·메시지 insert 등 DB 접근을 짧은 트랜잭션({@code
   * txTemplate})으로 감싼다 — 없으면 RLS 로 빈 결과/미스코프 → fail-closed. IMAP 세션(fetchMetadata 의 네트워크 I/O)은 트랜잭션
   * 밖에서 수행해 동기화 내내 DB 커넥션을 점유하지 않는다(#232 — 14개 중 최악의 connection-holder 해소). 또한 비동기 백필({@code
   * backfillService.backfill}, @Async)은 요청 스레드 밖에서 돌아 GUC 가 없으므로 별도 컨텍스트 전파가 필요(본 이슈 범위 밖, 후속).
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
      MailSyncResult result = fetchMetadata(account, accountId, password, folder);

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
      return result;
    } catch (MessagingException e) {
      throw new MailSyncException("받은편지함 동기화에 실패했습니다", e);
    } finally {
      // 보충할 게 없거나 에러로 끝났으면 여기서 즉시 종료(백필을 트리거했다면 백필이 종료 책임).
      if (!triggeredBackfill) {
        progress.finish(accountId);
      }
    }
  }

  /**
   * IMAP 에서 대상 메시지의 <b>메타만</b> 받아 저장한다(본문 미수집). 첫 동기화는 최근 {@value #INITIAL_WINDOW_DAYS}일 SEARCH,
   * 이후는 UID 증분. 메시지별 파싱/저장 실패는 격리하고 커서를 전진시켜 영구 재시도(무한 정지)를 방지한다.
   *
   * <p>1단계(IMAP 네트워크 I/O, 트랜잭션 밖)에서 메타를 {@link ParsedMessage} DTO 로 수집만 하고, 2단계(DB 쓰기)에서 메시지별 짧은
   * 트랜잭션으로 저장한다 — IMAP 세션 동안 DB 커넥션을 점유하지 않으면서도 각 쓰기에 RLS GUC 를 주입한다(#232).
   */
  private MailSyncResult fetchMetadata(
      EmailAccountResponse account,
      long accountId,
      String password,
      EmailFolderRepository.FolderSyncState folder)
      throws MessagingException {
    // === 1단계: IMAP 네트워크 I/O (트랜잭션 밖) — 메타 파싱 후 DTO 로 수집만 하고 DB 는 건드리지 않는다. ===
    Store store = null;
    Folder inbox = null;
    long uidValidity;
    boolean uidValidityChanged = false;
    int fetched = 0;
    long maxUid;
    List<ParsedMessage> parsedList = new ArrayList<>();
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
    long finalMaxUid = maxUid;
    long finalUidValidity = uidValidity;
    txTemplate.executeWithoutResult(
        status -> folderRepo.updateSyncState(folder.id(), finalUidValidity, finalMaxUid));
    return new MailSyncResult(fetched, saved);
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

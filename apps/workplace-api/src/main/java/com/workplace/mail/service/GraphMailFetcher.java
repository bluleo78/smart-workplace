package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailFolderRepository.FolderTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.graph.GraphDeltaPage;
import com.workplace.mail.service.graph.GraphMessage;
import com.workplace.mail.service.graph.GraphMessageMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Microsoft Graph API 공급자용 {@link MailFetcher} 구현(#499).
 *
 * <p>Graph messages/delta API 로 INBOX 증분 동기화를 수행한다. 신규 메시지를 {@code email_message} 테이블에 적재하고, {@code
 * @removed} 마커 항목은 행을 삭제한다. 증분 커서({@code @odata.deltaLink})는 {@code email_folder.delta_link} 에 보관해 다음
 * 동기화 시 재사용한다.
 *
 * <p>{@link MailSyncService} 가 {@code account.provider() == M365_GRAPH} 일 때 이 구현을 자동 디스패치한다.
 *
 * <p><b>슬라이스1 알려진 한계</b>: 첫 동기화는 INBOX 전체를 페이징한다(Graph delta 는 초기 범위를 receivedDateTime 필터로 제한할 수
 * 없음). 대용량 메일함 초기 적재 제한은 후속 과제로 남긴다.
 *
 * <p>WP-950: 받은편지함 뒤에 서버 보낸편지함(Sent Items)도 같은 delta 흐름으로 가져와 외부 클라이언트(Outlook 등)에서 보낸 메일도 앱
 * 보낸편지함에 보이게 한다 — 첫 동기화는 최근 {@value #SENT_INITIAL_WINDOW_DAYS}일 필터.
 *
 * <p>WP-960: 서버 메일함(보관·사용자 폴더)도 같은 delta 흐름으로 가져온다 — 초기 URL 만 폴더 id 와 {@code receivedDateTime ge}
 * 필터(최근 {@value MailFetcher#FOLDER_INITIAL_WINDOW_DAYS}일)로 좁힌다. 「이전 메일 더 가져오기」는 delta 대신 messages 목록을 기간
 * 필터로 페이징한다(delta 의 $filter 는 receivedDateTime ge|gt 만 지원).
 */
@Slf4j
@Service
public class GraphMailFetcher implements MailFetcher {

  /**
   * Graph INBOX delta 초기 URL — 첫 동기화 시 사용. $select 로 필요한 필드만 요청해 응답 크기를 최소화한다.
   *
   * <p>절대 URL 이 아니라 상대 경로 → {@link GraphApiClient#get} 이 GRAPH_BASE_URL 을 자동 접두한다.
   */
  static final String SELECT =
      "$select=subject,from,toRecipients,ccRecipients,"
          + "receivedDateTime,sentDateTime,isRead,hasAttachments,"
          + "internetMessageId,conversationId";

  /** Graph INBOX delta 초기 URL. */
  static final String INITIAL_DELTA_URL = "/me/mailFolders/inbox/messages/delta?" + SELECT;

  /** 서버 보낸편지함을 동기화하는 로컬 폴더 이름이자 Graph well-known 폴더 이름(WP-950). 본문·읽음은 폴더와 무관하게 메시지 id 로 다룬다. */
  static final String SENT_FOLDER = "sentitems";

  /** 보낸편지함 첫 동기화 범위(일, WP-950) — IMAP 첫 동기화와 같다. 몇 년 치 보낸 메일을 한 번에 페이징·본문 백필하지 않는다. */
  static final int SENT_INITIAL_WINDOW_DAYS = ImapMailFetcher.INITIAL_WINDOW_DAYS;

  /** 이전 메일 더 가져오기의 한 페이지 크기(WP-960). */
  static final int OLDER_PAGE_SIZE = 100;

  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary {@code TenantAwareTransactionManager} 로 구성해 트랜잭션 진입 시
   * RLS GUC(app.tenant_id) 가 주입된다(#444/#492 패턴).
   */
  private final TransactionTemplate txTemplate;

  public GraphMailFetcher(
      EmailFolderRepository folderRepo,
      EmailMessageRepository messageRepo,
      GraphTokenService tokenService,
      GraphApiClient graphApiClient,
      PlatformTransactionManager txManager) {
    this.folderRepo = folderRepo;
    this.messageRepo = messageRepo;
    this.tokenService = tokenService;
    this.graphApiClient = graphApiClient;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  /**
   * Graph delta API 로 INBOX 증분 동기화를 수행하고, 이어서 서버 보낸편지함(Sent Items)도 동기화한다(WP-950, best-effort).
   *
   * <p>흐름: 토큰 획득 → INBOX 폴더 보장 → deltaLink 있으면 해당 URL, 없으면 INITIAL_DELTA_URL → {@link #runDelta} →
   * {@link #syncSent}. 보낸편지함 단계의 실패는 경고 로그만 남기고 받은편지함 결과를 돌려준다.
   *
   * @param userId 계정 소유자
   * @param accountId 메일 계정 id
   * @param account 계정 응답 DTO(provider=M365_GRAPH)
   * @return 받은편지함 동기화 결과(fetched=처리 항목 수, saved=신규 삽입 수, seenChanged=기존 메일 읽음 상태 변경 수, removed=삭제
   *     수) + 보낸편지함 신규 적재 수(sentSaved)
   * @throws MailSyncException 토큰 오류 · Graph API 오류 · 네트워크 오류 시
   */
  @Override
  public MailSyncResult fetchNewMessages(
      long userId, long accountId, EmailAccountResponse account) {
    // 1. 유효한 access_token 획득(만료 임박 시 자동 갱신 — GraphTokenService@Transactional)
    String token = tokenService.getAccessToken(userId, accountId);

    // 2. INBOX 폴더 보장 — 없으면 생성, 있으면 현재 상태 조회
    EmailFolderRepository.FolderSyncState folder =
        txTemplate.execute(s -> folderRepo.ensureFolder(accountId, "INBOX"));

    // 3. 시작 URL 결정: 저장된 deltaLink 있으면 재사용, 없으면 초기 delta URL
    String url =
        txTemplate.execute(s -> folderRepo.getDeltaLink(folder.id())).orElse(INITIAL_DELTA_URL);
    MailSyncResult result = runDelta(accountId, folder.id(), token, url);
    MailSyncResult sent = syncSent(accountId, token);
    return sent == null ? result : result.withSent(sent);
  }

  /**
   * 서버 보낸편지함(Sent Items) delta 동기화(WP-950, best-effort). 저장된 deltaLink 가 없으면 최근 {@value
   * #SENT_INITIAL_WINDOW_DAYS}일 필터를 건 초기 delta 로 시작한다. 실패는 경고 로그 후 null — 만료된 deltaLink(410 등)로 매번
   * 같은 실패를 되풀이하지 않게 커서를 지워 다음 동기화가 첫 범위부터 다시 시작한다(이미 있는 메일은 UPSERT 라 중복되지 않는다).
   */
  private MailSyncResult syncSent(long accountId, String token) {
    Long sentFolderId = null;
    try {
      sentFolderId =
          txTemplate
              .execute(s -> folderRepo.ensureServerSentFolder(accountId, SENT_FOLDER))
              .orElseThrow()
              .id();
      long folderId = sentFolderId;
      String url =
          txTemplate
              .execute(s -> folderRepo.getDeltaLink(folderId))
              .orElseGet(() -> initialSentDeltaUrl(Instant.now()));
      return runDelta(accountId, folderId, token, url);
    } catch (Exception e) {
      log.warn("M365 보낸편지함 동기화 실패(받은편지함은 완료): accountId={} {}", accountId, e.toString());
      if (sentFolderId != null) {
        long folderId = sentFolderId;
        txTemplate.executeWithoutResult(s -> folderRepo.setDeltaLink(folderId, null));
      }
      return null;
    }
  }

  /**
   * 보낸편지함 첫 delta URL(WP-950) — 최근 {@value #SENT_INITIAL_WINDOW_DAYS}일만. 이후 동기화는 저장된 deltaLink 를
   * 따른다.
   */
  static String initialSentDeltaUrl(Instant now) {
    return folderDeltaUrl(
        SENT_FOLDER,
        now.minus(SENT_INITIAL_WINDOW_DAYS, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS));
  }

  /**
   * 서버 메일함 한 개 동기화(WP-960). 저장된 deltaLink 가 있으면 증분, 없으면 최근 90일 필터를 건 초기 delta 로 시작하고 그 시작 시각을
   * synced_since 로 기록한다. older=true 이고 이미 가져온 폴더면 {@link #fetchOlder} 로 경계 앞 기간만 더 받는다.
   */
  @Override
  public MailSyncResult syncFolder(
      long userId,
      long accountId,
      EmailAccountResponse account,
      FolderTarget folder,
      boolean older) {
    String token = tokenService.getAccessToken(userId, accountId);
    if (older && folder.syncedSince() != null) {
      return fetchOlder(accountId, folder, token);
    }
    String deltaLink = txTemplate.execute(s -> folderRepo.getDeltaLink(folder.id())).orElse(null);
    Instant since = null; // 이번에 처음 정하는 경계(첫 동기화일 때만)
    String url = deltaLink;
    if (url == null) {
      // 초기 delta 는 항상 현재 경계부터 — 이전 메일 더 가져오기 뒤에는 넓어진 경계로 다시 시작해 옛 메일도 delta 로 갱신받는다.
      Instant start;
      if (folder.syncedSince() != null) {
        start = folder.syncedSince().toInstant().truncatedTo(ChronoUnit.SECONDS);
      } else {
        start =
            Instant.now()
                .minus(FOLDER_INITIAL_WINDOW_DAYS, ChronoUnit.DAYS)
                .truncatedTo(ChronoUnit.SECONDS);
        since = start;
      }
      url = folderDeltaUrl(folder.remoteId(), start);
    }
    MailSyncResult result = runDelta(accountId, folder.id(), token, url);
    OffsetDateTime newSince = since == null ? null : since.atOffset(ZoneOffset.UTC);
    txTemplate.executeWithoutResult(
        s -> folderRepo.markFolderSynced(folder.id(), newSince, OffsetDateTime.now()));
    return result;
  }

  /**
   * 서버 메일함 초기 delta URL(WP-960). 공백은 {@code %20} 으로 넣는다 — {@link GraphApiClient#get} 이 URL 을 {@code
   * URI.create} 로 그대로 쓰므로(공백이 있으면 예외) 미리 인코딩한 형태여야 한다. 시각은 초 단위 UTC ISO-8601(따옴표 없음 —
   * DateTimeOffset 리터럴).
   */
  static String folderDeltaUrl(String folderRemoteId, Instant since) {
    return "/me/mailFolders/"
        + folderRemoteId
        + "/messages/delta?"
        + SELECT
        + "&$filter=receivedDateTime%20ge%20"
        + since;
  }

  /** 이전 메일 더 가져오기 URL(WP-960) — [from, to) 수신분, 페이지 {@value #OLDER_PAGE_SIZE}건. */
  static String folderOlderUrl(String folderRemoteId, Instant from, Instant to) {
    return "/me/mailFolders/"
        + folderRemoteId
        + "/messages?"
        + SELECT
        + "&$filter=receivedDateTime%20ge%20"
        + from
        + "%20and%20receivedDateTime%20lt%20"
        + to
        + "&$top="
        + OLDER_PAGE_SIZE;
  }

  /**
   * 이전 메일 더 가져오기(WP-960) — [synced_since − 90일, synced_since) 수신분을 messages 목록으로 받아 upsert
   * 한다(nextLink 페이징). 끝나면 synced_since 를 범위 시작으로 옮기고 deltaLink 를 지운다 — 다음 폴더 동기화가 새 경계로 delta 를
   * 처음부터 다시 시작해 옛 메일의 변화(읽음·삭제·이동)도 받는다.
   */
  private MailSyncResult fetchOlder(long accountId, FolderTarget folder, String token) {
    Instant to = folder.syncedSince().toInstant().truncatedTo(ChronoUnit.SECONDS);
    Instant from = to.minus(FOLDER_INITIAL_WINDOW_DAYS, ChronoUnit.DAYS);
    int fetched = 0;
    int saved = 0;
    int seenChanged = 0;
    try {
      String url = folderOlderUrl(folder.remoteId(), from, to);
      while (url != null) {
        GraphDeltaPage page = graphApiClient.get(token, url, GraphDeltaPage.class);
        if (page == null || page.value() == null) {
          throw new MailSyncException("M365 메일 목록 응답이 비었습니다");
        }
        for (GraphMessage m : page.value()) {
          fetched++;
          EmailMessageRepository.UpsertOutcome outcome = upsert(accountId, folder.id(), m);
          if (outcome == EmailMessageRepository.UpsertOutcome.INSERTED) {
            saved++;
          } else if (outcome == EmailMessageRepository.UpsertOutcome.SEEN_CHANGED) {
            seenChanged++;
          }
        }
        url = page.nextLink();
      }
    } catch (MailSyncException e) {
      throw e;
    } catch (Exception e) {
      throw new MailSyncException("M365 메일함 이전 메일을 가져오지 못했습니다", e);
    }
    OffsetDateTime newSince = from.atOffset(ZoneOffset.UTC);
    txTemplate.executeWithoutResult(
        s -> {
          folderRepo.markFolderSynced(folder.id(), newSince, OffsetDateTime.now());
          // delta 는 옛 경계로 필터가 걸려 있어 방금 받은 옛 메일의 읽음·삭제·이동을 알려 주지 않는다. 커서를 지워 다음 동기화가 새 경계로
          // delta 를 처음부터 다시 시작하게 한다(upsert 가 멱등이라 중복 없음, 필터 delta 는 문서상 최대 5000건).
          folderRepo.setDeltaLink(folder.id(), null);
        });
    return new MailSyncResult(fetched, saved, seenChanged, 0);
  }

  /** 메시지 한 건 UPSERT — 기존 메시지는 seen 만 서버 isRead 로 갱신(WP-148). isRead 가 응답에 없으면 읽음 상태를 건드리지 않는다. */
  private EmailMessageRepository.UpsertOutcome upsert(
      long accountId, long folderId, GraphMessage m) {
    ParsedMessage parsed = GraphMessageMapper.toParsed(m);
    final String msgId = m.id();
    final boolean syncSeen = m.isRead() != null;
    return txTemplate.execute(
        s -> messageRepo.upsertByProviderId(accountId, folderId, parsed, msgId, syncSeen));
  }

  /**
   * delta 페이징 루프 — nextLink 가 없어질 때까지 반복하고 마지막 deltaLink 를 폴더에 보관한다. 각 메시지는 provider_message_id 로
   * UPSERT, {@code @removed} 항목은 이 폴더 행만 삭제(WP-960 — 다른 폴더 행을 지우지 않게). Graph HTTP I/O 는 트랜잭션 밖, DB
   * 쓰기는 메시지 단위 짧은 트랜잭션(RLS GUC 주입 보장 #232 패턴).
   */
  private MailSyncResult runDelta(long accountId, long folderId, String token, String startUrl) {
    String url = startUrl;
    int fetched = 0;
    int saved = 0;
    int seenChanged = 0; // WP-148: 서버 isRead 를 따라 seen 이 바뀐 기존 메일 수(새 메일 아님)
    int removed = 0; // WP-959: 서버에서 옮겨졌거나 지워져(@removed) 로컬에서 지운 메일 수
    String deltaLink = null;

    try {
      while (url != null) {
        GraphDeltaPage page = graphApiClient.get(token, url, GraphDeltaPage.class);

        for (GraphMessage m : page.value()) {
          fetched++;

          if (m.removed() != null) {
            // @removed 마커 → 이 폴더의 해당 메시지 행 삭제
            final String msgId = m.id();
            Integer deleted =
                txTemplate.execute(s -> messageRepo.deleteByProviderId(accountId, folderId, msgId));
            removed += deleted == null ? 0 : deleted;
            continue;
          }

          EmailMessageRepository.UpsertOutcome outcome = upsert(accountId, folderId, m);
          if (outcome == EmailMessageRepository.UpsertOutcome.INSERTED) {
            saved++;
          } else if (outcome == EmailMessageRepository.UpsertOutcome.SEEN_CHANGED) {
            seenChanged++;
          }
        }

        // 페이지 전환: nextLink 있으면 계속, 없으면 deltaLink 기록 후 종료
        if (page.nextLink() != null) {
          url = page.nextLink();
        } else {
          deltaLink = page.deltaLink();
          url = null;
        }
      }

      // 마지막 deltaLink 를 폴더에 보관(다음 동기화 시작점)
      final String dl = deltaLink;
      if (dl != null) {
        txTemplate.executeWithoutResult(s -> folderRepo.setDeltaLink(folderId, dl));
      }

      log.debug(
          "M365 Graph 동기화 완료: accountId={} folderId={} fetched={} saved={} seenChanged={}",
          accountId,
          folderId,
          fetched,
          saved,
          seenChanged);
      return new MailSyncResult(fetched, saved, seenChanged, removed);

    } catch (MailSyncException e) {
      throw e; // 이미 래핑된 오류는 그대로 전파
    } catch (Exception e) {
      throw new MailSyncException("M365 메일 동기화에 실패했습니다", e);
    }
  }
}

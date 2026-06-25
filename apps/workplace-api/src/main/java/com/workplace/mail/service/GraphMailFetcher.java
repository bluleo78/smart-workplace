package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.graph.GraphDeltaPage;
import com.workplace.mail.service.graph.GraphMessage;
import com.workplace.mail.service.graph.GraphMessageMapper;
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
 */
@Slf4j
@Service
public class GraphMailFetcher implements MailFetcher {

  /**
   * Graph INBOX delta 초기 URL — 첫 동기화 시 사용. $select 로 필요한 필드만 요청해 응답 크기를 최소화한다.
   *
   * <p>절대 URL 이 아니라 상대 경로 → {@link GraphApiClient#get} 이 GRAPH_BASE_URL 을 자동 접두한다.
   */
  static final String INITIAL_DELTA_URL =
      "/me/mailFolders/inbox/messages/delta"
          + "?$select=subject,from,toRecipients,ccRecipients,"
          + "receivedDateTime,sentDateTime,isRead,hasAttachments,"
          + "internetMessageId,conversationId";

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
   * Graph delta API 로 INBOX 증분 동기화를 수행한다.
   *
   * <p>흐름: 토큰 획득 → INBOX 폴더 보장 → deltaLink 있으면 해당 URL, 없으면 INITIAL_DELTA_URL →
   * {@code @odata.nextLink} 페이징 → 마지막 {@code @odata.deltaLink} 저장. 각 메시지는 {@code
   * provider_message_id} 로 UPSERT, {@code @removed} 항목은 삭제.
   *
   * <p>Graph HTTP I/O 는 트랜잭션 밖, DB 쓰기는 메시지 단위 짧은 트랜잭션(RLS GUC 주입 보장 #232 패턴).
   *
   * @param userId 계정 소유자
   * @param accountId 메일 계정 id
   * @param account 계정 응답 DTO(provider=M365_GRAPH)
   * @return 동기화 결과(fetched=처리 항목 수, saved=신규 삽입 수)
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

    int fetched = 0;
    int saved = 0;
    String deltaLink = null;

    try {
      // 4. delta 페이징 루프 — nextLink 가 없어질 때까지 반복
      while (url != null) {
        GraphDeltaPage page = graphApiClient.get(token, url, GraphDeltaPage.class);

        for (GraphMessage m : page.value()) {
          fetched++;

          if (m.removed() != null) {
            // @removed 마커 → DB 에서 해당 메시지 행 삭제
            final String msgId = m.id();
            txTemplate.executeWithoutResult(s -> messageRepo.deleteByProviderId(accountId, msgId));
            continue;
          }

          // 신규/변경 메시지 → ParsedMessage 매핑 후 UPSERT
          ParsedMessage parsed = GraphMessageMapper.toParsed(m);
          final String msgId = m.id();
          boolean inserted =
              Boolean.TRUE.equals(
                  txTemplate.execute(
                      s -> messageRepo.upsertByProviderId(accountId, folder.id(), parsed, msgId)));
          if (inserted) {
            saved++;
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

      // 5. 마지막 deltaLink 를 폴더에 보관(다음 동기화 시작점)
      final String dl = deltaLink;
      if (dl != null) {
        txTemplate.executeWithoutResult(s -> folderRepo.setDeltaLink(folder.id(), dl));
      }

      log.debug("M365 Graph 동기화 완료: accountId={} fetched={} saved={}", accountId, fetched, saved);
      return new MailSyncResult(fetched, saved);

    } catch (MailSyncException e) {
      throw e; // 이미 래핑된 오류는 그대로 전파
    } catch (Exception e) {
      throw new MailSyncException("M365 메일 동기화에 실패했습니다", e);
    }
  }
}

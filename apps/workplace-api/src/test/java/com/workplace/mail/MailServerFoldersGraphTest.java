package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailFolderResponse;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.graph.GraphMailFolder;
import com.workplace.mail.service.graph.GraphMailFolderPage;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버 메일함 목록(WP-960) Graph 통합 테스트. {@link GraphApiClient}·{@link GraphTokenService} 를 스텁하고 Outlook
 * 기본 폴더 구성(보관·대화 기록·지운 편지함·임시 보관함·받은 편지함+사용자 하위·정크·보낼 편지함·보낸 편지함·동기화 문제+하위·검색 폴더·숨김 폴더·사용자 폴더
 * 「프로젝트」+하위 「견적」)으로 보관·사용자 폴더만 남는지, 요청 URL 이 정확한지, 시스템 폴더 하위로 내려가지 않는지 본다.
 */
@Transactional
class MailServerFoldersGraphTest extends IntegrationTestBase {

  private static final String TOKEN = "FAKE_TOKEN";
  private static final String ROOT = "/me/mailFolders?$top=100";
  private static final String ROOT_PAGE2 =
      "https://graph.microsoft.com/v1.0/me/mailFolders?$top=100&$skip=100";

  @Autowired DSLContext dsl;
  @Autowired MailFolderService folderService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired ObjectMapper objectMapper;

  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;

  /** 일반 폴더. */
  private static GraphMailFolder folder(
      String id, String name, int children, int unread, int total) {
    return new GraphMailFolder(id, name, null, children, unread, total, false, null);
  }

  private static GraphMailFolderPage page(String nextLink, GraphMailFolder... folders) {
    return new GraphMailFolderPage(List.of(folders), nextLink);
  }

  /** well-known 이름 해석 스텁 — id 만 담긴 응답. */
  private void wellKnown(String name, String id) {
    when(graphApiClient.get(
            TOKEN, "/me/mailFolders/" + name + "?$select=id", GraphMailFolder.class))
        .thenReturn(new GraphMailFolder(id, null, null, null, null, null, null, null));
  }

  /** 없는 well-known 이름 — Graph 는 404 를 돌려준다(클라이언트가 MailSyncException 으로 던짐). */
  private void wellKnownMissing(String name) {
    // doThrow 형태 — 같은 스텁을 다시 심을 때 when(...) 안의 호출이 앞 스텁 예외를 던지지 않게.
    doThrow(new MailSyncException("Graph API 호출 실패: 404"))
        .when(graphApiClient)
        .get(TOKEN, "/me/mailFolders/" + name + "?$select=id", GraphMailFolder.class);
  }

  private void children(String parentId, GraphMailFolderPage page) {
    when(graphApiClient.get(
            TOKEN,
            "/me/mailFolders/" + parentId + "/childFolders?$top=100",
            GraphMailFolderPage.class))
        .thenReturn(page);
  }

  /** Outlook(M365) 모양 폴더 구성을 스텁한다. 최상위는 두 페이지(nextLink)로 나눠 온다. */
  private void stubOutlookFolders(boolean withQuote) {
    wellKnown("archive", "id-archive");
    wellKnown("inbox", "id-inbox");
    wellKnown("sentitems", "id-sent");
    wellKnown("drafts", "id-drafts");
    wellKnown("deleteditems", "id-deleted");
    wellKnown("junkemail", "id-junk");
    wellKnown("outbox", "id-outbox");
    wellKnown("conversationhistory", "id-convhist");
    wellKnown("syncissues", "id-syncissues");
    wellKnown("conflicts", "id-conflicts");
    wellKnown("localfailures", "id-localfail");
    wellKnown("serverfailures", "id-serverfail");
    wellKnownMissing("clutter");
    wellKnownMissing("scheduled");

    when(graphApiClient.get(TOKEN, ROOT, GraphMailFolderPage.class))
        .thenReturn(
            page(
                ROOT_PAGE2,
                folder("id-archive", "Archive", 1, 2, 10),
                folder("id-convhist", "Conversation History", 1, 0, 3),
                folder("id-deleted", "Deleted Items", 0, 1, 4),
                folder("id-drafts", "Drafts", 0, 0, 1),
                folder("id-inbox", "Inbox", 1, 5, 50),
                folder("id-junk", "Junk Email", 0, 3, 3)));
    when(graphApiClient.get(TOKEN, ROOT_PAGE2, GraphMailFolderPage.class))
        .thenReturn(
            page(
                null,
                folder("id-outbox", "Outbox", 0, 0, 0),
                folder("id-sent", "Sent Items", 0, 0, 20),
                folder("id-syncissues", "Sync Issues", 3, 0, 0),
                new GraphMailFolder(
                    "id-search",
                    "보낸 사람별",
                    null,
                    0,
                    0,
                    7,
                    false,
                    GraphMailFolder.SEARCH_FOLDER_TYPE),
                new GraphMailFolder("id-hidden", "숨김", null, 0, 0, 1, true, null),
                folder("id-project", "프로젝트", withQuote ? 1 : 0, 1, 6)));
    children("id-archive", page(null, folder("id-arch-2024", "2024", 0, 0, 8)));
    children("id-inbox", page(null, folder("id-notice", "팀 공지", 0, 2, 9)));
    if (withQuote) {
      children("id-project", page(null, folder("id-quote", "견적", 0, 1, 2)));
    }
  }

  private EmailAccountResponse account(long user, long accountId) {
    return accountRepo.findByIdAndUser(user, accountId).orElseThrow();
  }

  @Test
  void refresh_keepsOnlyArchiveAndUserFolders_withParents_andExactUrls() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    folderRepo.ensureFolder(accountId, "INBOX");
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    stubOutlookFolders(true);

    boolean changed = folderService.refresh(user, accountId, account(user, accountId));

    assertThat(changed).isTrue();
    List<MailFolderResponse> folders = folderService.list(user, accountId);
    assertThat(folders).first().extracting(MailFolderResponse::displayName).isEqualTo("Archive");
    Map<String, MailFolderResponse> byName =
        folders.stream()
            .collect(Collectors.toMap(MailFolderResponse::displayName, Function.identity()));
    assertThat(byName).containsOnlyKeys("Archive", "2024", "팀 공지", "프로젝트", "견적");
    assertThat(byName.get("Archive").role()).isEqualTo("ARCHIVE");
    assertThat(byName.get("Archive").unreadCount()).isEqualTo(2);
    assertThat(byName.get("Archive").totalCount()).isEqualTo(10);
    assertThat(byName.get("2024").role()).isEqualTo("USER");
    assertThat(byName.get("2024").parentId()).isEqualTo(byName.get("Archive").id());
    assertThat(byName.get("팀 공지").role()).isEqualTo("USER");
    assertThat(byName.get("팀 공지").parentId()).isNull(); // 받은편지함 아래 → 최상위
    assertThat(byName.get("프로젝트").parentId()).isNull();
    assertThat(byName.get("견적").parentId()).isEqualTo(byName.get("프로젝트").id());
    assertThat(byName.get("견적").unreadCount()).isEqualTo(1);

    // 키 = Graph 폴더 id, remote_id 도 같다. INBOX 행에는 remote_id 만 기록된다.
    assertThat(
            dsl.select(EMAIL_FOLDER.NAME)
                .from(EMAIL_FOLDER)
                .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
                .and(EMAIL_FOLDER.ROLE.isNotNull())
                .and(EMAIL_FOLDER.REMOTE_ID.eq(EMAIL_FOLDER.NAME))
                .fetch(EMAIL_FOLDER.NAME))
        .containsExactlyInAnyOrder(
            "id-archive", "id-arch-2024", "id-notice", "id-project", "id-quote");
    assertThat(
            dsl.select(EMAIL_FOLDER.REMOTE_ID)
                .from(EMAIL_FOLDER)
                .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
                .and(EMAIL_FOLDER.NAME.eq("INBOX"))
                .fetchOne(EMAIL_FOLDER.REMOTE_ID))
        .isEqualTo("id-inbox");

    // 폴더 목록 요청 URL 전부 — 시스템 폴더(대화 기록·동기화 문제)의 하위는 요청하지 않는다.
    ArgumentCaptor<String> urls = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient, atLeastOnce())
        .get(eq(TOKEN), urls.capture(), eq(GraphMailFolderPage.class));
    assertThat(urls.getAllValues())
        .containsExactlyInAnyOrder(
            "/me/mailFolders?$top=100",
            ROOT_PAGE2,
            "/me/mailFolders/id-archive/childFolders?$top=100",
            "/me/mailFolders/id-inbox/childFolders?$top=100",
            "/me/mailFolders/id-project/childFolders?$top=100");

    // well-known 해석 URL 전부
    ArgumentCaptor<String> wk = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient, times(14)).get(eq(TOKEN), wk.capture(), eq(GraphMailFolder.class));
    assertThat(wk.getAllValues())
        .containsExactlyInAnyOrder(
            "/me/mailFolders/archive?$select=id",
            "/me/mailFolders/inbox?$select=id",
            "/me/mailFolders/sentitems?$select=id",
            "/me/mailFolders/drafts?$select=id",
            "/me/mailFolders/deleteditems?$select=id",
            "/me/mailFolders/junkemail?$select=id",
            "/me/mailFolders/outbox?$select=id",
            "/me/mailFolders/conversationhistory?$select=id",
            "/me/mailFolders/syncissues?$select=id",
            "/me/mailFolders/clutter?$select=id",
            "/me/mailFolders/conflicts?$select=id",
            "/me/mailFolders/localfailures?$select=id",
            "/me/mailFolders/serverfailures?$select=id",
            "/me/mailFolders/scheduled?$select=id");
  }

  @Test
  void secondRefresh_reusesWellKnownIds_noChange_thenVanishedFolderDeleted() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    stubOutlookFolders(true);
    EmailAccountResponse account = account(user, accountId);
    folderService.refresh(user, accountId, account);

    // 같은 목록 → 바뀐 것 없음. well-known 은 다시 묻지 않는다(없던 이름도 잠시 기억).
    assertThat(folderService.refresh(user, accountId, account)).isFalse();
    verify(graphApiClient, times(14)).get(eq(TOKEN), anyString(), eq(GraphMailFolder.class));

    // 서버에서 「견적」이 사라짐 → 행 삭제, 바뀜.
    stubOutlookFolders(false);
    assertThat(folderService.refresh(user, accountId, account)).isTrue();
    assertThat(folderService.list(user, accountId))
        .extracting(MailFolderResponse::displayName)
        .containsExactlyInAnyOrder("Archive", "2024", "팀 공지", "프로젝트");
  }

  @Test
  void childListingFailure_throwsAndDeletesNothing() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    stubOutlookFolders(true);
    EmailAccountResponse account = account(user, accountId);
    folderService.refresh(user, accountId, account);

    // 「프로젝트」 하위 목록이 실패하면 전체 실패 — 「견적」을 지우지 않는다.
    when(graphApiClient.get(
            TOKEN, "/me/mailFolders/id-project/childFolders?$top=100", GraphMailFolderPage.class))
        .thenThrow(new MailSyncException("Graph API 호출 실패: 503"));

    assertThatThrownBy(() -> folderService.refresh(user, accountId, account))
        .isInstanceOf(MailSyncException.class);
    assertThat(folderService.list(user, accountId)).hasSize(5);
  }

  /** JSON 매핑 — @odata.type·isHidden·@odata.nextLink 키가 레코드로 들어오는지. */
  @Test
  void graphFolderJson_mapsODataTypeHiddenAndNextLink() throws Exception {
    String json =
        """
        {"value":[
          {"id":"a","displayName":"검색","childFolderCount":0,"unreadItemCount":1,
           "totalItemCount":2,"isHidden":false,
           "@odata.type":"#microsoft.graph.mailSearchFolder"},
          {"id":"b","displayName":"숨김","childFolderCount":0,"isHidden":true}
        ],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/mailFolders?$skip=2"}
        """;
    GraphMailFolderPage p = objectMapper.readValue(json, GraphMailFolderPage.class);
    assertThat(p.nextLink()).isEqualTo("https://graph.microsoft.com/v1.0/me/mailFolders?$skip=2");
    assertThat(p.value().get(0).isSearchFolder()).isTrue();
    assertThat(p.value().get(0).unreadItemCount()).isEqualTo(1);
    assertThat(p.value().get(1).isHidden()).isTrue();
    assertThat(p.value().get(1).isSearchFolder()).isFalse();
  }

  /** 404 가 아닌 well-known 해석 실패(예: 503)는 목록 전체 실패 — 보낸편지함을 사용자 폴더로 저장하지 않고 아무것도 지우지 않는다. */
  @Test
  void wellKnownTransientFailure_failsListing_withoutStoringSystemFolder() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    stubOutlookFolders(true);
    EmailAccountResponse account = account(user, accountId);
    folderService.refresh(user, accountId, account);

    // 다른 계정(캐시 없음)에서 sentitems 해석이 503 으로 실패
    long user2 = TestFixtures.createHuman(dsl);
    long account2 = MailTestSupport.seedGraphAccount(dsl, user2);
    doThrow(new MailSyncException("Graph API 호출 실패: 503"))
        .when(graphApiClient)
        .get(TOKEN, "/me/mailFolders/sentitems?$select=id", GraphMailFolder.class);

    assertThatThrownBy(() -> folderService.refresh(user2, account2, account(user2, account2)))
        .isInstanceOf(MailSyncException.class);
    assertThat(folderService.list(user2, account2)).isEmpty();
    // 이미 해석이 캐시된 첫 계정은 영향 없이 그대로 갱신된다
    assertThat(folderService.refresh(user, accountId, account)).isFalse();
    assertThat(folderService.list(user, accountId)).hasSize(5);
  }
}

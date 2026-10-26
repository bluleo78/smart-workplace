package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailInboxController P2 엔드포인트 통합 테스트. 읽음 처리(POST /read) + 회신필요 카운트(GET) + 소유권 거부 검증. 실 JWT +
 * MockMvc로 전체 보안 체인 통과. @Transactional로 공유 test DB 무오염 보장.
 */
@Transactional
class MailInboxControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** 테스트용 이메일 계정을 직접 삽입하고 accountId 반환. */
  private long createAccount(long userId, String email) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            email,
            "테스트박스",
            "127.0.0.1",
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            email,
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            email,
            "pw",
            false);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  /**
   * 테스트용 메시지를 지정 폴더에 삽입하고 생성된 id 반환.
   *
   * @param seen true=읽음, false=안읽음
   * @param aiSummary null=미요약, 문자열=요약 있음
   */
  private long seedMessage(long accountId, long folderId, boolean seen, String aiSummary) {
    Long msg =
        dsl.insertInto(
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ACCOUNT_ID,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.FOLDER_ID,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.MESSAGE_ID,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.THREAD_ID,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.FROM_ADDRESS,
                // subject/snippet 은 email_content 로 이전(Task9: envelope 컬럼 제거)
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SEEN,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.HAS_ATTACHMENT,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.RECEIVED_AT)
            .values(
                accountId,
                folderId,
                "msg-" + System.nanoTime() + "@test.local",
                "thread-" + System.nanoTime(),
                "sender@example.com",
                // subject/snippet 값 제거
                seen,
                false,
                java.time.OffsetDateTime.ofInstant(Instant.now(), java.time.ZoneOffset.UTC))
            .returning(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID)
            .fetchOne()
            .get(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID);

    if (aiSummary != null) {
      MailTestSupport.seedSummary(dsl, msg, aiSummary);
    }
    return msg;
  }

  /** WP-146: 회신필요 메일을 상세 조회(=열람)하면 계정 회신필요 카운트 API 가 0 이 된다 — 읽으면 해제. */
  @Test
  void needsReplyCount_dropsAfterOpeningMessage() throws Exception {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "open-test-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m = seedMessage(accountId, inbox, false, null);
    MailTestSupport.classify(dsl, m, "업무", true);
    String token = jwtTokenProvider.generateAccessToken(userId, "user-" + userId);

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/needs-reply-count", accountId)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(1));

    mvc.perform(get("/api/v1/mail/messages/{m}", m).header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/needs-reply-count", accountId)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(0));
  }

  /** WP-147: AI 조회(markSeen=false)는 읽음 처리하지 않는다 — 응답 seen=false, 회신필요 카운트 유지. */
  @Test
  void getMessage_markSeenFalse_keepsUnread() throws Exception {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-read-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m = seedMessage(accountId, inbox, false, null);
    MailTestSupport.classify(dsl, m, "업무", true);
    String token = jwtTokenProvider.generateAccessToken(userId, "user-" + userId);

    mvc.perform(
            get("/api/v1/mail/messages/{m}", m)
                .param("markSeen", "false")
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.seen").value(false));

    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isEqualTo(1);
  }

  /** WP-146: POST /messages/{m}/read — 회신필요 메일을 읽음 처리하면 카운트가 0, 두 번 불러도 200(멱등). */
  @Test
  void markRead_marksSeenIdempotently() throws Exception {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "read-test-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m = seedMessage(accountId, inbox, false, null);
    MailTestSupport.classify(dsl, m, "업무", true);
    String token = jwtTokenProvider.generateAccessToken(userId, "user-" + userId);

    mvc.perform(
            post("/api/v1/mail/messages/{m}/read", m).header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isZero();

    mvc.perform(
            post("/api/v1/mail/messages/{m}/read", m).header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
  }

  /** WP-146: 남의 메일 읽음 처리 → 404, DB 불변. */
  @Test
  void markRead_deniedForOtherUsersMessage() throws Exception {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner-read-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m = seedMessage(accountId, inbox, false, null);
    MailTestSupport.classify(dsl, m, "업무", true);
    String otherToken = jwtTokenProvider.generateAccessToken(other, "user-" + other);

    mvc.perform(
            post("/api/v1/mail/messages/{m}/read", m)
                .header("Authorization", "Bearer " + otherToken))
        .andExpect(status().isNotFound());
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isEqualTo(1);
  }

  /** WP-960 서버 폴더 행 시드(보관·사용자). */
  private long seedServerFolder(
      long accountId, String name, String displayName, String role, Long parentId, int unread) {
    return dsl.insertInto(com.workplace.jooq.Tables.EMAIL_FOLDER)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.NAME, name)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.REMOTE_ID, name)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.DISPLAY_NAME, displayName)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.ROLE, role)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.PARENT_ID, parentId)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.SERVER_UNREAD, unread)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.SERVER_TOTAL, unread + 3)
        .returning(com.workplace.jooq.Tables.EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  /** WP-960: 서버 메일함 목록 — 보관 먼저, INBOX·SENT 제외, 부모·개수 포함. */
  @Test
  void folders_returnsArchiveFirst_excludesInboxAndSent() throws Exception {
    long owner = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner-folders-" + System.nanoTime() + "@test.local");
    folderRepo.ensureFolder(accountId, "INBOX");
    folderRepo.ensureFolder(accountId, "SENT");
    long customer = seedServerFolder(accountId, "Customers", "Customers", "USER", null, 0);
    long a = seedServerFolder(accountId, "Customers.A", "A", "USER", customer, 4);
    long archive = seedServerFolder(accountId, "Zarchive", "Zarchive", "ARCHIVE", null, 1);
    String token = jwtTokenProvider.generateAccessToken(owner, "user-" + owner);

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/folders", accountId)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(3))
        .andExpect(jsonPath("$[0].id").value(archive))
        .andExpect(jsonPath("$[0].role").value("ARCHIVE"))
        .andExpect(jsonPath("$[0].displayName").value("Zarchive"))
        .andExpect(jsonPath("$[1].id").value(a))
        .andExpect(jsonPath("$[1].parentId").value(customer))
        .andExpect(jsonPath("$[1].unreadCount").value(4))
        .andExpect(jsonPath("$[1].totalCount").value(7))
        .andExpect(jsonPath("$[1].selectable").value(true))
        .andExpect(jsonPath("$[1].syncedSince").doesNotExist())
        .andExpect(jsonPath("$[2].id").value(customer))
        .andExpect(jsonPath("$[2].parentId").doesNotExist());
  }

  /** WP-960: 남의 계정 메일함 목록은 404. */
  @Test
  void folders_deniedForOtherUsersAccount() throws Exception {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner-folders2-" + System.nanoTime() + "@test.local");
    seedServerFolder(accountId, "Archive", "Archive", "ARCHIVE", null, 0);
    String otherToken = jwtTokenProvider.generateAccessToken(other, "user-" + other);

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/folders", accountId)
                .header("Authorization", "Bearer " + otherToken))
        .andExpect(status().isNotFound());
  }

  /** WP-960: folderId 보기 — 목록·건수·모두 읽음이 그 메일함만 다루고, 모두 읽음은 서버 안 읽은 수를 줄인다. 남의 메일함 id 는 404. */
  @Test
  void folderIdViews_listCountMarkAllRead_scopedToFolder() throws Exception {
    long owner = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner-fview-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long project = seedServerFolder(accountId, "Projects", "Projects", "USER", null, 5);
    seedMessage(accountId, inbox, false, null);
    long p1 = seedMessage(accountId, project, false, null);
    long p2 = seedMessage(accountId, project, false, null);
    seedMessage(accountId, project, true, null);
    String token = jwtTokenProvider.generateAccessToken(owner, "user-" + owner);

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/messages", accountId)
                .param("folderId", String.valueOf(project))
                .param("category", "업무") // folderId 가 있으면 무시
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(3));
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/messages", accountId)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(1)); // folderId 없으면 기존(INBOX)
    String asOf =
        mvc.perform(
                get("/api/v1/mail/accounts/{a}/messages/unread-count", accountId)
                    .param("folderId", String.valueOf(project))
                    .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(2))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String asOfValue = com.jayway.jsonpath.JsonPath.read(asOf, "$.asOf");

    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/mark-all-read", accountId)
                .param("folderId", String.valueOf(project))
                .header("Authorization", "Bearer " + token)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{\"asOf\":\"" + asOfValue + "\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(2));
    assertThat(messageRepo.findDueSeenSyncItems(accountId, 10))
        .extracting(i -> i.messageId())
        .containsExactlyInAnyOrder(p1, p2);
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/folders", accountId)
                .header("Authorization", "Bearer " + token))
        .andExpect(jsonPath("$[0].unreadCount").value(3)); // 5 - 2

    // 다른 계정의 메일함 id → 404
    long other = TestFixtures.createHuman(dsl);
    long otherAccount = createAccount(other, "other-fview-" + System.nanoTime() + "@test.local");
    long otherFolder = seedServerFolder(otherAccount, "Theirs", "Theirs", "USER", null, 0);
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/messages", accountId)
                .param("folderId", String.valueOf(otherFolder))
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isNotFound());
  }

  /** WP-960: 메일함 동기화 API — 받은편지함은 400, 없는 메일함·남의 계정은 404. */
  @Test
  void folderSync_rejectsInbox400_unknownOrOthers404() throws Exception {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner-fsync-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long project = seedServerFolder(accountId, "Projects", "Projects", "USER", null, 0);
    String token = jwtTokenProvider.generateAccessToken(owner, "user-" + owner);
    String otherToken = jwtTokenProvider.generateAccessToken(other, "user-" + other);

    mvc.perform(
            post("/api/v1/mail/accounts/{a}/folders/{f}/sync", accountId, inbox)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/v1/mail/accounts/{a}/folders/{f}/sync", accountId, Long.MAX_VALUE)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isNotFound());
    mvc.perform(
            post("/api/v1/mail/accounts/{a}/folders/{f}/sync", accountId, project)
                .header("Authorization", "Bearer " + otherToken))
        .andExpect(status().isNotFound());
  }

  /**
   * WP-965: 목록 커서 — 앞 페이지 마지막 행의 receivedAt·id 를 beforeAt·beforeId 로 넘기면 그 다음 행부터 온다(JSON 의
   * receivedAt 문자열을 그대로 넘겨도 마이크로초까지 맞는다).
   */
  @Test
  void messages_beforeCursor_returnsNextPage() throws Exception {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "cursor-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long newest = seedMessage(accountId, inbox, true, null);
    long middle = seedMessage(accountId, inbox, true, null);
    long oldest = seedMessage(accountId, inbox, true, null);
    // 수신 시각을 마이크로초 단위로 벌려 둔다(최신 → 오래된 순)
    setReceivedAt(newest, "2026-10-20T10:00:00.123456Z");
    setReceivedAt(middle, "2026-10-19T10:00:00.654321Z");
    setReceivedAt(oldest, "2026-10-18T10:00:00.000001Z");
    String token = jwtTokenProvider.generateAccessToken(userId, "user-" + userId);

    String firstPage =
        mvc.perform(
                get("/api/v1/mail/accounts/{a}/messages", accountId)
                    .param("limit", "1")
                    .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(newest))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String receivedAt = com.jayway.jsonpath.JsonPath.read(firstPage, "$[0].receivedAt");

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/messages", accountId)
                .param("limit", "5")
                .param("beforeAt", receivedAt)
                .param("beforeId", String.valueOf(newest))
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(2))
        .andExpect(jsonPath("$[0].id").value(middle))
        .andExpect(jsonPath("$[1].id").value(oldest));
  }

  /**
   * WP-965: 이전 메일 더 가져오기 — 받은편지함·보낸편지함만(그 밖은 400), 남의 계정은 404, 아직 동기화 전이면 받지 않고 running(잠시 뒤 다시).
   */
  @Test
  void fetchOlder_validatesFolderAndOwner() throws Exception {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "older-" + System.nanoTime() + "@test.local");
    String token = jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
    long otherId = TestFixtures.createHuman(dsl);
    String otherToken = jwtTokenProvider.generateAccessToken(otherId, "user-" + otherId);

    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/older", accountId)
                .param("folder", "INBOX")
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.running").value(true))
        .andExpect(jsonPath("$.saved").value(0))
        .andExpect(jsonPath("$.hasMore").value(true));

    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/older", accountId)
                .param("folder", "Projects")
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest());

    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/older", accountId)
                .param("folder", "SENT")
                .header("Authorization", "Bearer " + otherToken))
        .andExpect(status().isNotFound());
  }

  private void setReceivedAt(long messageId, String at) {
    dsl.update(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE)
        .set(
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.RECEIVED_AT,
            java.time.OffsetDateTime.parse(at))
        .where(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }
}

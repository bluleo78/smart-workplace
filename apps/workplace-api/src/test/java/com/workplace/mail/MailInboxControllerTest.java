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
      messageRepo.updateSummary(msg, aiSummary);
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
    messageRepo.updateClassification(m, "업무", true);
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

  /** WP-146: POST /messages/{m}/read — 회신필요 메일을 읽음 처리하면 카운트가 0, 두 번 불러도 200(멱등). */
  @Test
  void markRead_marksSeenIdempotently() throws Exception {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "read-test-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m = seedMessage(accountId, inbox, false, null);
    messageRepo.updateClassification(m, "업무", true);
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
    messageRepo.updateClassification(m, "업무", true);
    String otherToken = jwtTokenProvider.generateAccessToken(other, "user-" + other);

    mvc.perform(
            post("/api/v1/mail/messages/{m}/read", m)
                .header("Authorization", "Bearer " + otherToken))
        .andExpect(status().isNotFound());
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isEqualTo(1);
  }
}

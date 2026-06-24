package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
import org.jooq.impl.DSL;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailInboxController P2 엔드포인트 통합 테스트. 처리완료(POST/DELETE) + 카운트(GET) + 소유권 거부 검증. 실 JWT + MockMvc로
 * 전체 보안 체인 통과. @Transactional로 공유 test DB 무오염 보장.
 */
@AutoConfigureMockMvc
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
            3143,
            MailSecurity.NONE,
            email,
            "127.0.0.1",
            3025,
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
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SUBJECT,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SNIPPET,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SEEN,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.HAS_ATTACHMENT,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.RECEIVED_AT)
            .values(
                accountId,
                folderId,
                "msg-" + System.nanoTime() + "@test.local",
                "thread-" + System.nanoTime(),
                "sender@example.com",
                "테스트 제목",
                "스니펫",
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

  /**
   * 처리완료 POST→카운트 0→처리완료 DELETE→카운트 1 왕복 검증. 회신필요 메시지를 처리완료하면 카운트에서 제외되고, 되돌리면 다시 포함된다.
   */
  @Test
  void needsReplyDone_marksAndClears() throws Exception {
    // 시드: 사용자/계정/INBOX 폴더/회신필요 메시지
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "mark-test-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m = seedMessage(accountId, inbox, false, null);
    // ai_needs_reply=true 로 분류해 회신필요 카운트에 잡히게 함
    messageRepo.updateClassification(m, "업무", true);

    String token = jwtTokenProvider.generateAccessToken(userId, "user-" + userId);

    // 회신필요 카운트 초기값 = 1
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isEqualTo(1);

    // POST: 처리완료 마킹
    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/{m}/needs-reply-done", accountId, m)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());

    // 처리완료 후 DB 반영 검증
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isZero();

    // GET: 카운트 API 검증
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/needs-reply-count", accountId)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(0));

    // DELETE: 처리완료 해제
    mvc.perform(
            delete("/api/v1/mail/accounts/{a}/messages/{m}/needs-reply-done", accountId, m)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());

    // 해제 후 다시 카운트 1 복원
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isEqualTo(1);
  }

  /**
   * 다른 사용자 소유 계정에 처리완료 시도 시 404. 계정 소유 검사가 실제로 차단하는지 검증하고, DB는 변경되지 않음을 확인한다.
   */
  @Test
  void needsReplyDone_deniedForOtherUsersAccount() throws Exception {
    // 계정 소유자(owner)와 다른 사용자(other)
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner-" + System.nanoTime() + "@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m = seedMessage(accountId, inbox, false, null);
    messageRepo.updateClassification(m, "업무", true);

    // other 사용자로 처리완료 시도 → 404
    String otherToken = jwtTokenProvider.generateAccessToken(other, "user-" + other);
    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/{m}/needs-reply-done", accountId, m)
                .header("Authorization", "Bearer " + otherToken))
        .andExpect(status().isNotFound());

    // DB 미변경 — 여전히 회신필요 1건
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isEqualTo(1);
  }
}

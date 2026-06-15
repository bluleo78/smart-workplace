package com.workplace.mail.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * GET /api/v1/me/mail-summary 통합 테스트. 실 JWT + MockMvc 로 전체 보안 체인을 통과시키고, 본인 INBOX 의 안읽음 수와 최근 안읽은
 * 메일을 검증한다. 테스트 프로파일은 connection-init 으로 app.tenant_id=1 을 주입하므로(DashboardEndpointTest 참고) 동일 풀
 * 커넥션으로 시드한 메일 행은 tenant RLS 하에서도 읽힌다(별도 멤버십 시드 불필요).
 */
@AutoConfigureMockMvc
@Transactional
class MeMailSummaryControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** box@test.local 계정을 직접 삽입(연결테스트 우회)하고 accountId 반환. */
  private long insertAccount(long userId) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "box@test.local",
            "테스트박스",
            "127.0.0.1",
            3143,
            MailSecurity.NONE,
            "box@test.local",
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            "box@test.local",
            "pw",
            false);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  /** imap_uid·subject·seen·receivedAt 을 명시한 메시지(헤더+스니펫). */
  private ParsedMessage msg(long uid, String subject, boolean seen, Instant receivedAt) {
    return new ParsedMessage(
        uid,
        "<m" + uid + "@x>",
        "<m" + uid + "@x>",
        null,
        null,
        "a@x.com",
        "A",
        "box@test.local",
        null,
        subject,
        receivedAt,
        receivedAt,
        seen,
        false,
        "본문" + uid,
        null,
        "스니펫" + uid,
        List.of());
  }

  @Test
  void summary_counts_unread_and_lists_recent() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long account = insertAccount(user);
    long folderId = folderRepo.ensureFolder(account, "INBOX").id();

    Instant base = Instant.now().truncatedTo(ChronoUnit.SECONDS);
    // 안읽음 2건(서로 다른 imap_uid·receivedAt) + 읽음 1건. 최신순 정렬 검증을 위해 시간 차이를 둔다.
    messageRepo.insertIgnoreConflict(
        account, folderId, msg(1, "오래된 안읽음", false, base.minus(2, ChronoUnit.MINUTES)));
    messageRepo.insertIgnoreConflict(
        account, folderId, msg(2, "최신 안읽음", false, base.minus(1, ChronoUnit.MINUTES)));
    messageRepo.insertIgnoreConflict(account, folderId, msg(3, "읽음", true, base));

    String token = jwtTokenProvider.generateAccessToken(user, "user-" + user);

    mvc.perform(get("/api/v1/me/mail-summary").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.unreadCount").value(2))
        .andExpect(jsonPath("$.recent.length()").value(2))
        // 최신순: receivedAt 이 더 큰 "최신 안읽음" 이 먼저, 읽음은 제외.
        .andExpect(jsonPath("$.recent[0].subject").value("최신 안읽음"))
        .andExpect(jsonPath("$.recent[0].seen").value(false))
        .andExpect(jsonPath("$.recent[1].subject").value("오래된 안읽음"));
  }
}

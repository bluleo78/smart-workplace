package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.AiAccountRef;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** EmailAccountRepository CRUD·소유 격리·soft delete 통합 테스트. 메서드 @Transactional 로 공유 test DB 롤백. */
@Transactional
class EmailAccountRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository repo;

  private EmailAccountRequest sampleReq(String email) {
    return new EmailAccountRequest(
        email,
        "표시명",
        "imap.example.com",
        993,
        MailSecurity.SSL_TLS,
        email,
        "smtp.example.com",
        587,
        MailSecurity.STARTTLS,
        email,
        "plain-pw",
        false);
  }

  private EmailAccountRequest aiReq(String email) {
    return new EmailAccountRequest(
        email,
        "AI 계정",
        "imap.example.com",
        993,
        MailSecurity.SSL_TLS,
        email,
        "smtp.example.com",
        587,
        MailSecurity.STARTTLS,
        email,
        "plain-pw",
        true); // aiEnabled=true
  }

  @Test
  void insert_then_findByIdAndUser_returnsResponseWithoutPassword() {
    long user = TestFixtures.createHuman(dsl);
    long id = repo.insert(user, sampleReq("a@example.com"), "ENC");

    Optional<EmailAccountResponse> found = repo.findByIdAndUser(user, id);
    assertThat(found).isPresent();
    assertThat(found.get().emailAddress()).isEqualTo("a@example.com");
    assertThat(found.get().imapPort()).isEqualTo(993);
    assertThat(found.get().imapSecurity()).isEqualTo(MailSecurity.SSL_TLS);
    assertThat(found.get().smtpSecurity()).isEqualTo(MailSecurity.STARTTLS);
  }

  @Test
  void findByIdAndUser_otherUser_returnsEmpty() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long id = repo.insert(owner, sampleReq("b@example.com"), "ENC");

    assertThat(repo.findByIdAndUser(other, id)).isEmpty();
  }

  @Test
  void listByUser_returnsOnlyOwnActiveAccounts() {
    long user = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    repo.insert(user, sampleReq("c@example.com"), "ENC");
    repo.insert(user, sampleReq("d@example.com"), "ENC");
    repo.insert(other, sampleReq("e@example.com"), "ENC");

    List<EmailAccountResponse> list = repo.listByUser(user);
    assertThat(list)
        .extracting(EmailAccountResponse::emailAddress)
        .containsExactlyInAnyOrder("c@example.com", "d@example.com");
  }

  @Test
  void findEncryptedPassword_scopedToUser() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long id = repo.insert(owner, sampleReq("f@example.com"), "SECRET-ENC");

    assertThat(repo.findEncryptedPassword(owner, id)).contains("SECRET-ENC");
    assertThat(repo.findEncryptedPassword(other, id)).isEmpty();
  }

  @Test
  void existsByUserAndAddress_trueOnlyForActiveOwn() {
    long user = TestFixtures.createHuman(dsl);
    repo.insert(user, sampleReq("g@example.com"), "ENC");

    assertThat(repo.existsByUserAndAddress(user, "g@example.com")).isTrue();
    assertThat(repo.existsByUserAndAddress(user, "nope@example.com")).isFalse();
  }

  @Test
  void update_changesFields_andKeepsScope() {
    long user = TestFixtures.createHuman(dsl);
    long id = repo.insert(user, sampleReq("h@example.com"), "ENC");

    EmailAccountRequest changed =
        new EmailAccountRequest(
            "h2@example.com",
            "새이름",
            "imap2.example.com",
            143,
            MailSecurity.STARTTLS,
            "h2@example.com",
            "smtp2.example.com",
            465,
            MailSecurity.SSL_TLS,
            "h2@example.com",
            "ignored",
            false);
    repo.update(user, id, changed, "ENC2");

    EmailAccountResponse r = repo.findByIdAndUser(user, id).orElseThrow();
    assertThat(r.emailAddress()).isEqualTo("h2@example.com");
    assertThat(r.imapHost()).isEqualTo("imap2.example.com");
    assertThat(r.imapPort()).isEqualTo(143);
    assertThat(repo.findEncryptedPassword(user, id)).contains("ENC2");
  }

  @Test
  void softDelete_removesFromListAndReturnsRowCount() {
    long user = TestFixtures.createHuman(dsl);
    long id = repo.insert(user, sampleReq("i@example.com"), "ENC");

    assertThat(repo.softDelete(user, id)).isEqualTo(1);
    assertThat(repo.listByUser(user)).isEmpty();
    assertThat(repo.softDelete(user, id)).isEqualTo(0);
  }

  /** AI ON 활성 계정만 listAiEnabledAccounts 에 포함되어야 한다. AI OFF / disabled 계정은 제외. */
  @Test
  void listAiEnabledAccounts_활성_AI_ON_계정만() {
    long userId = TestFixtures.createHuman(dsl);
    long aiOn = repo.insert(userId, aiReq("ai-on@example.com"), "ENC"); // ai_enabled, not disabled
    repo.insert(userId, sampleReq("ai-off@example.com"), "ENC"); // ai off — 제외
    long aiOnDisabled = repo.insert(userId, aiReq("ai-on-disabled@example.com"), "ENC");
    repo.softDelete(userId, aiOnDisabled); // disabled — 제외

    List<AiAccountRef> refs = repo.listAiEnabledAccounts();
    assertThat(refs).extracting(AiAccountRef::accountId).containsExactly(aiOn);
  }

  /** updateAiEnabledForAll — caller 계정만 변경, 타인 계정 불변(크로스-유저 격리). */
  @Test
  void updateAiEnabledForAll_callerOnly_otherUserUnchanged() {
    long caller = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);

    long id1 = repo.insert(caller, sampleReq("x1@example.com"), "ENC"); // aiEnabled=false
    long id2 = repo.insert(caller, sampleReq("x2@example.com"), "ENC"); // aiEnabled=false
    long idOther = repo.insert(other, sampleReq("y1@example.com"), "ENC"); // aiEnabled=false

    int affected = repo.updateAiEnabledForAll(caller, true);
    assertThat(affected).isEqualTo(2); // caller 2건만

    // caller 계정 모두 true 로 변경
    assertThat(repo.findByIdAndUser(caller, id1).orElseThrow().aiEnabled()).isTrue();
    assertThat(repo.findByIdAndUser(caller, id2).orElseThrow().aiEnabled()).isTrue();
    // other 계정 불변
    assertThat(repo.findByIdAndUser(other, idOther).orElseThrow().aiEnabled()).isFalse();
  }

  /** isAnyAiEnabled — ai_enabled=true 인 계정이 하나라도 있을 때 true, 없으면 false. */
  @Test
  void isAnyAiEnabled_returnsTrueWhenAtLeastOneEnabled() {
    long user = TestFixtures.createHuman(dsl);
    assertThat(repo.isAnyAiEnabled(user)).isFalse(); // 계정 없음

    repo.insert(user, sampleReq("z1@example.com"), "ENC"); // aiEnabled=false
    assertThat(repo.isAnyAiEnabled(user)).isFalse();

    repo.insert(user, aiReq("z2@example.com"), "ENC"); // aiEnabled=true
    assertThat(repo.isAnyAiEnabled(user)).isTrue();
  }

  /** aiEnabled=true 로 저장한 계정을 재조회하면 aiEnabled 가 true 이어야 한다. */
  @Test
  void insert_withAiEnabled_true_isPersistedAndReturned() {
    long user = TestFixtures.createHuman(dsl);
    EmailAccountRequest req =
        new EmailAccountRequest(
            "ai@example.com",
            "AI 계정",
            "imap.example.com",
            993,
            MailSecurity.SSL_TLS,
            "ai@example.com",
            "smtp.example.com",
            587,
            MailSecurity.STARTTLS,
            "ai@example.com",
            "plain-pw",
            true); // AI 비서 활성화
    long id = repo.insert(user, req, "ENC");

    EmailAccountResponse found = repo.findByIdAndUser(user, id).orElseThrow();
    assertThat(found.aiEnabled()).isTrue();
  }
}

package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.exception.DuplicateEmailAccountException;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailConnectionException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.EmailAccountService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * EmailAccountService CRUD·암복호화·연결 테스트 게이트·소유 격리 통합 테스트. GreenMail(IMAP 3143 / SMTP 3025, 평문)로 실연결을
 * 검증하므로 host=127.0.0.1, security=NONE 으로 요청을 구성한다.
 */
@Transactional
class EmailAccountServiceTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired EmailAccountService service;
  @Autowired EmailAccountRepository repo;
  @Autowired EncryptionService encryption;

  /** GreenMail 에 붙는 정상 요청(비밀번호 password). */
  private EmailAccountRequest greenMailReq(String password) {
    return new EmailAccountRequest(
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
        password);
  }

  @Test
  void create_persistsAndEncryptsPassword() {
    long user = TestFixtures.createHuman(dsl);

    EmailAccountResponse res = service.create(user, greenMailReq("pw"));

    assertThat(res.emailAddress()).isEqualTo("box@test.local");
    String enc = repo.findEncryptedPassword(user, res.id()).orElseThrow();
    assertThat(enc).isNotEqualTo("pw");
    assertThat(encryption.decrypt(enc)).isEqualTo("pw");
  }

  @Test
  void create_blankPassword_throwsValidation() {
    long user = TestFixtures.createHuman(dsl);
    assertThatThrownBy(() -> service.create(user, greenMailReq("  ")))
        .isInstanceOf(MailValidationException.class);
  }

  @Test
  void create_duplicateAddress_throwsConflict() {
    long user = TestFixtures.createHuman(dsl);
    service.create(user, greenMailReq("pw"));
    assertThatThrownBy(() -> service.create(user, greenMailReq("pw")))
        .isInstanceOf(DuplicateEmailAccountException.class);
  }

  @Test
  void create_badCredentials_throwsConnectionAndDoesNotPersist() {
    long user = TestFixtures.createHuman(dsl);
    assertThatThrownBy(() -> service.create(user, greenMailReq("wrong-pw")))
        .isInstanceOf(MailConnectionException.class);
    assertThat(service.list(user)).isEmpty();
  }

  @Test
  void list_isScopedToUser() {
    long user = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    service.create(user, greenMailReq("pw"));

    assertThat(service.list(user)).hasSize(1);
    assertThat(service.list(other)).isEmpty();
  }

  @Test
  void update_blankPassword_keepsExistingEncryptedPassword() {
    long user = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(user, greenMailReq("pw"));

    EmailAccountRequest update =
        new EmailAccountRequest(
            "box@test.local",
            "새표시명",
            "127.0.0.1",
            3143,
            MailSecurity.NONE,
            "box@test.local",
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            "box@test.local",
            "");
    EmailAccountResponse res = service.update(user, created.id(), update);

    assertThat(res.displayName()).isEqualTo("새표시명");
    String encAfter = repo.findEncryptedPassword(user, created.id()).orElseThrow();
    assertThat(encryption.decrypt(encAfter)).isEqualTo("pw");
  }

  @Test
  void update_otherUser_throwsNotFound() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(owner, greenMailReq("pw"));

    assertThatThrownBy(() -> service.update(other, created.id(), greenMailReq("pw")))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }

  @Test
  void delete_otherUser_throwsNotFound() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(owner, greenMailReq("pw"));

    assertThatThrownBy(() -> service.delete(other, created.id()))
        .isInstanceOf(EmailAccountNotFoundException.class);
    assertThat(service.list(owner)).hasSize(1);
  }

  @Test
  void test_returnsResultWithoutPersisting() {
    long user = TestFixtures.createHuman(dsl);
    var ok = service.test(greenMailReq("pw"));
    assertThat(ok.success()).isTrue();
    assertThat(service.list(user)).isEmpty();

    var bad = service.test(greenMailReq("wrong-pw"));
    assertThat(bad.success()).isFalse();
    assertThat(bad.imapOk()).isFalse();
  }

  @Test
  void update_toExistingActiveAddress_throwsConflict() {
    long user = TestFixtures.createHuman(dsl);
    // 활성 계정 A: box@test.local (정상 생성)
    service.create(user, greenMailReq("pw"));
    // 계정 B: box2@test.local — 연결테스트 우회 위해 repo 로 직접 삽입
    EmailAccountRequest bReq =
        new EmailAccountRequest(
            "box2@test.local",
            "B",
            "127.0.0.1",
            3143,
            MailSecurity.NONE,
            "box2@test.local",
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            "box2@test.local",
            "pw");
    long bId = repo.insert(user, bReq, encryption.encrypt("pw"));
    // B 의 주소를 A 와 동일하게 변경 시도(비번 빈값=유지) → 연결테스트 전에 중복 409
    EmailAccountRequest toDup = greenMailReq("");
    assertThatThrownBy(() -> service.update(user, bId, toDup))
        .isInstanceOf(DuplicateEmailAccountException.class);
  }
}

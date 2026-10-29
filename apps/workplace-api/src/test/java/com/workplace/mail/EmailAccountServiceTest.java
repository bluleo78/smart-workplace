package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
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
import com.workplace.mail.service.MailClassifyBackfillService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * EmailAccountService CRUD·암복호화·연결 테스트 게이트·소유 격리 통합 테스트. GreenMail(IMAP/SMTP — MailTestPorts, 평문)로
 * 실연결을 검증하므로 host=127.0.0.1, security=NONE 으로 요청을 구성한다.
 */
@Transactional
class EmailAccountServiceTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired EmailAccountService service;
  @Autowired EmailAccountRepository repo;
  @Autowired EncryptionService encryption;

  /** AI 분류 백필 서비스 — 호출 여부만 검증하므로 mock. */
  @MockitoBean MailClassifyBackfillService classifyBackfillService;

  /** GreenMail 에 붙는 정상 요청(비밀번호 password). */
  private EmailAccountRequest greenMailReq(String password) {
    return new EmailAccountRequest(
        "box@test.local",
        "테스트박스",
        "127.0.0.1",
        MailTestPorts.IMAP,
        MailSecurity.NONE,
        "box@test.local",
        "127.0.0.1",
        MailTestPorts.SMTP,
        MailSecurity.NONE,
        "box@test.local",
        password,
        false);
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

  /** GreenMail 요청에서 IMAP 호스트·포트만 바꾼 요청 — SMTP 는 허용 목록의 127.0.0.1(GreenMail) 그대로. */
  private EmailAccountRequest withImap(String host, int port, String password) {
    EmailAccountRequest g = greenMailReq(password);
    return new EmailAccountRequest(
        g.emailAddress(),
        g.displayName(),
        host,
        port,
        g.imapSecurity(),
        g.imapUsername(),
        g.smtpHost(),
        g.smtpPort(),
        g.smtpSecurity(),
        g.smtpUsername(),
        g.password(),
        g.aiEnabled());
  }

  @Test
  void test_internalImapHost_isBlockedBeforeConnecting_smtpCheckedSeparately() {
    // WP-740: ::1(허용 목록 밖 루프백) 1번 포트 — 예전엔 실제로 접속해 「서버에 연결할 수 없습니다」(닫힌 포트)를 돌려줘 포트 탐색이 됐다
    var r = service.test(withImap("::1", 1, "pw"));

    assertThat(r.imapOk()).isFalse();
    assertThat(r.imapError()).isEqualTo("내부망 주소로는 접속할 수 없습니다 — 메일 서버 주소를 확인하세요");
    // 호스트마다 따로 판정 — 허용된 SMTP(GreenMail)는 정상 검증된다
    assertThat(r.smtpOk()).isTrue();
  }

  @Test
  void create_internalHost_isRejectedAndNotPersisted() {
    long user = TestFixtures.createHuman(dsl);
    // 127.1 은 127.0.0.1 의 축약형 — 문자열은 허용 목록과 달라도 풀린 주소로 판정해 막는다
    assertThatThrownBy(() -> service.create(user, withImap("127.1", 1, "pw")))
        .isInstanceOfSatisfying(
            MailConnectionException.class,
            e ->
                assertThat(e.result().imapError())
                    .isEqualTo("내부망 주소로는 접속할 수 없습니다 — 메일 서버 주소를 확인하세요"));
    assertThat(service.list(user)).isEmpty();
  }

  @Test
  void update_toInternalHost_isRejected() {
    long user = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(user, greenMailReq("pw"));

    assertThatThrownBy(() -> service.update(user, created.id(), withImap("::1", 1, "")))
        .isInstanceOfSatisfying(
            MailConnectionException.class,
            e ->
                assertThat(e.result().imapError())
                    .isEqualTo("내부망 주소로는 접속할 수 없습니다 — 메일 서버 주소를 확인하세요"));
    // 저장된 계정 기준 테스트(/{id}/test)도 같은 판정
    assertThat(service.test(user, created.id(), withImap("::1", 1, "")).imapError())
        .isEqualTo("내부망 주소로는 접속할 수 없습니다 — 메일 서버 주소를 확인하세요");
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

  /** 대소문자만 바꾼 같은 주소(BOX@TEST.LOCAL)도 같은 메일함이라 409 — 연결 테스트 전에 막혀 행이 생기지 않는다(WP-1111). */
  @Test
  void create_caseVariantOfExistingAddress_throwsConflict() {
    long user = TestFixtures.createHuman(dsl);
    service.create(user, greenMailReq("pw"));
    EmailAccountRequest upper = withAddress(greenMailReq("pw"), "BOX@TEST.LOCAL");
    assertThatThrownBy(() -> service.create(user, upper))
        .isInstanceOf(DuplicateEmailAccountException.class);
    assertThat(service.list(user)).hasSize(1);
  }

  /** 계정 주소의 대소문자만 바꿔 저장하는 것은 자기 자신이라 중복이 아니다. */
  @Test
  void update_caseOfOwnAddress_isNotConflict() {
    long user = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(user, greenMailReq("pw"));
    EmailAccountRequest renamed = withAddress(greenMailReq(""), "Box@Test.Local");
    assertThat(service.update(user, created.id(), renamed).emailAddress())
        .isEqualTo("Box@Test.Local");
  }

  /** 요청의 메일 주소만 바꾼 사본. */
  private static EmailAccountRequest withAddress(EmailAccountRequest r, String emailAddress) {
    return new EmailAccountRequest(
        emailAddress,
        r.displayName(),
        r.imapHost(),
        r.imapPort(),
        r.imapSecurity(),
        r.imapUsername(),
        r.smtpHost(),
        r.smtpPort(),
        r.smtpSecurity(),
        r.smtpUsername(),
        r.password(),
        r.aiEnabled());
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
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            "box@test.local",
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            "box@test.local",
            "",
            false);
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
  void testExisting_blankPassword_usesStoredPassword() {
    // #448: 수정 폼은 비밀번호를 비워두므로, 저장된 비밀번호로 폴백해야 IMAP/SMTP 인증이 통과한다.
    long user = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(user, greenMailReq("pw"));

    var result = service.test(user, created.id(), greenMailReq(""));

    assertThat(result.success()).isTrue();
    assertThat(result.imapOk()).isTrue();
    assertThat(result.smtpOk()).isTrue();
  }

  @Test
  void testExisting_explicitPassword_overridesStored() {
    // 비밀번호를 새로 입력하면 저장값 대신 입력값으로 테스트한다(틀린 비번 → 인증 실패).
    long user = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(user, greenMailReq("pw"));

    var result = service.test(user, created.id(), greenMailReq("wrong-pw"));

    assertThat(result.success()).isFalse();
    assertThat(result.imapOk()).isFalse();
  }

  @Test
  void testExisting_otherUser_throwsNotFound() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(owner, greenMailReq("pw"));

    assertThatThrownBy(() -> service.test(other, created.id(), greenMailReq("")))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }

  @Test
  void update_triggers_classifyBackfill_only_on_false_to_true() {
    // aiEnabled=false 로 계정 생성 후 off→on 전환 시 classify 백필이 1회 호출되어야 한다.
    // 이미 on 상태에서 다시 on 으로 PUT 하면 호출이 없어야 한다(가드=중복 방지).
    long user = TestFixtures.createHuman(dsl);
    EmailAccountResponse created = service.create(user, greenMailReq("pw")); // aiEnabled=false

    // off→on: classify 백필 1회 호출
    EmailAccountRequest onReq =
        new EmailAccountRequest(
            "box@test.local",
            "테스트박스",
            "127.0.0.1",
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            "box@test.local",
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            "box@test.local",
            "pw",
            true /* aiEnabled = true */);
    service.update(user, created.id(), onReq);
    verify(classifyBackfillService, times(1)).classifyRecentUnread(user, created.id());

    // on→on: 이미 on 이므로 추가 호출 없음
    service.update(user, created.id(), onReq);
    verifyNoMoreInteractions(classifyBackfillService);
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
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            "box2@test.local",
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            "box2@test.local",
            "pw",
            false);
    long bId = repo.insert(user, bReq, encryption.encrypt("pw"));
    // B 의 주소를 A 와 동일하게 변경 시도(비번 빈값=유지) → 연결테스트 전에 중복 409
    EmailAccountRequest toDup = greenMailReq("");
    assertThatThrownBy(() -> service.update(user, bId, toDup))
        .isInstanceOf(DuplicateEmailAccountException.class);
    // 대소문자만 바꾼 A 의 주소도 같은 메일함이라 409(WP-1111)
    EmailAccountRequest toCaseDup = withAddress(greenMailReq(""), "Box@Test.Local");
    assertThatThrownBy(() -> service.update(user, bId, toCaseDup))
        .isInstanceOf(DuplicateEmailAccountException.class);
  }
}

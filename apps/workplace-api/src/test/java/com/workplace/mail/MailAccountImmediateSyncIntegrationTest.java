package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.service.EmailAccountService;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 메일 계정 연결 직후 즉시 동기화 production 경로 통합 (#514).
 *
 * <p>{@code EmailAccountService.create()}(@Transactional)를 실제 호출 → 커밋 → MailAccountConnectedEvent 의
 * AFTER_COMMIT 리스너({@code MailAccountSyncDispatcher}) → @Async sync 까지 전체 경로를 검증한다. 스케줄러를 호출하지
 * 않고도(즉, 3분 주기를 기다리지 않고도) 계정 추가 직후 메일이 적재되는지 확인하는 회귀 가드.
 *
 * <p>이 클래스는 @Transactional 을 절대 붙이지 않는다 — 외부 트랜잭션 안에서는 AFTER_COMMIT 이 발화하지 않아 검증이 무력화된다(#476 교훈).
 * 커밋된 row 를 추적해 @AfterEach 에서 회수한다. tenant 는 ThreadLocal(TenantContext)로 주입 — @Async 워커에 decorator
 * 가 전파해 새 트랜잭션의 GUC 를 채운다.
 */
@DisplayName("메일 계정 연결 직후 → 커밋 → AFTER_COMMIT → 즉시 동기화 통합 (#514)")
class MailAccountImmediateSyncIntegrationTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired EmailAccountService emailAccountService;
  @Autowired DSLContext dsl;

  /** 비동기 본문 보충 목킹 — 즉시 sync 의 백필 트리거를 무동작으로 만들어 단언을 결정적으로 만든다. */
  @MockitoBean MailBackfillService backfillService;

  private Long createdAccountId;
  private Long createdUserId;

  /** RLS 게이트: ThreadLocal tenant 주입(decorator 가 @Async 워커로 전파). */
  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.set(1L);
    if (createdAccountId != null) {
      // email_account 삭제 → email_message CASCADE
      dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(createdAccountId)).execute();
    }
    if (createdUserId != null) {
      dsl.deleteFrom(USER).where(USER.ID.eq(createdUserId)).execute();
    }
    createdAccountId = null;
    createdUserId = null;
    TenantContext.clear();
  }

  /** GreenMail(IMAP 3143 / SMTP 3025)을 가리키는 계정 등록 요청. */
  private EmailAccountRequest greenMailRequest() {
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
        "pw",
        false);
  }

  private int messageCountFor(long accountId) {
    return dsl.fetchCount(
        dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId)));
  }

  @Test
  @DisplayName("계정 등록 직후 스케줄러 없이 메일이 동기화된다")
  void create_triggersImmediateSyncAfterCommit() {
    createdUserId = TestFixtures.createHuman(dsl);

    // 계정 등록 전에 메일박스에 한 통 도착시켜 둔다 — 첫 즉시 sync 가 이 메일을 적재해야 한다.
    GreenMailUtil.sendTextEmailTest("box@test.local", "sender@example.com", "즉시동기화-제목", "본문");
    greenMail.waitForIncomingEmail(1);

    // production 경로: create() 커밋 → AFTER_COMMIT → @Async 즉시 sync.
    EmailAccountResponse acc = emailAccountService.create(createdUserId, greenMailRequest());
    createdAccountId = acc.id();

    // 스케줄러를 호출하지 않는다 — 즉시 sync 만으로 메일이 적재되어야 한다.
    final long accId = acc.id();
    await()
        .atMost(Duration.ofSeconds(10))
        .untilAsserted(
            () -> {
              TenantContext.set(1L);
              assertThat(messageCountFor(accId)).as("계정 등록 직후 즉시 동기화로 적재된 메일").isPositive();
            });
  }
}

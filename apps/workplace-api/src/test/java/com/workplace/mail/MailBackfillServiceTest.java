package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailBackfillService 통합 테스트 — GreenMail(IMAP 3143)로 INBOX 를 채우고 메타 전용 동기화 후 누락 본문을 일괄 보충함을 검증한다.
 *
 * <p>비동기 진입점 {@code backfill(@Async)} 은 별도 스레드/트랜잭션이라 @Transactional 테스트의 미커밋 데이터를 보지 못하고 경쟁한다. 따라서
 * 동기 본체 {@link MailBackfillService#backfillNow(long, long)} 을 직접 호출해 같은 스레드/트랜잭션에서 결과를 단언한다.
 *
 * <p>참고: sync 는 미적재(>0) 시 실제 {@code @Async backfill} 도 트리거하지만 그 비동기 스레드는 별도 커넥션/트랜잭션이라 테스트의 미커밋
 * 데이터를 못 봐 inert(no-op) 다 — countMissingBody==2 단언과 충돌하지 않는다. 본문 적재는 동기 backfillNow 가 수행한다. 계정
 * aiEnabled=false 라 분류 경로는 타지 않으며, mailClient 는 @MockitoBean 으로 실호출을 차단한다.
 */
@Transactional
class MailBackfillServiceTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailBackfillService backfillService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** ai-agent 실호출 차단(분류 경로 방어 — 계정 aiEnabled=false 라 호출되지 않지만 안전망). */
  @MockitoBean AiAgentMailClient mailClient;

  /** 메타 전용 동기화로 남은 누락 본문 2건을 backfillNow 가 모두 보충하는지 검증. */
  @Test
  void backfillNow_fillsAllMissingBodies() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "a@x.com", "1", "본문1");
    GreenMailUtil.sendTextEmailTest("box@test.local", "b@x.com", "2", "본문2");
    greenMail.waitForIncomingEmail(2);

    syncService.sync(user, accountId); // 메타만 저장(본문 미적재)
    assertThat(messageRepo.countMissingBody(accountId)).isEqualTo(2);

    backfillService.backfillNow(user, accountId); // 동기 본체 — 같은 트랜잭션에서 검증

    assertThat(messageRepo.countMissingBody(accountId)).isZero();
  }
}

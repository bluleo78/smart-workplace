package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.ClassifyResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailBodyFetcher 통합 테스트 — GreenMail(IMAP 3143)에서 단건 본문을 적재해 캐시(body_fetched_at)·본문·분류를 검증한다.
 *
 * <p>sync 는 메타만 저장하므로 본문/스니펫은 적재 전 null 이고 body_fetched_at 도 null 이다. 따라서 sync 직후가 곧 '미적재' 상태이며,
 * fetchBody 가 실제로 본문을 내려받아 채우는지(그리고 멱등/분류) 를 그대로 검증할 수 있다.
 */
@Transactional
class MailBodyFetcherTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailBodyFetcher bodyFetcher;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** ai-agent 실호출 차단. */
  @MockitoBean AiAgentMailClient mailClient;

  /** 비서 해석 — 분류 테스트에서만 스텁. */
  @MockitoBean AssistantResolver assistantResolver;

  @Test
  void fetchBody_본문적재_및_캐시() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "제목", "본문입니다");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);
    long messageId = messageRepo.listMissingBody(accountId, 10).get(0).messageId();

    bodyFetcher.fetchBody(user, messageRepo.findBodyTarget(accountId, messageId).orElseThrow());

    BodyTarget after = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    // Task5: bodyFetchedAt 은 email_content.body_fetched_at 기준
    assertThat(after.bodyFetchedAt()).isNotNull();
    // Task5: 본문은 email_content 에 기록됨 — envelope JOIN content 로 검증(Task6 이전까지 reader 미이관)
    String bodyViaContent =
        dsl.select(EMAIL_CONTENT.BODY_TEXT)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .fetchOneInto(String.class);
    assertThat(bodyViaContent).contains("본문입니다");
  }

  /** 이미 적재된 대상(body_fetched_at != null)은 no-op — IMAP 미접속. */
  @Test
  void fetchBody_이미적재면_noop() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "제목", "본문입니다");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);
    long messageId = messageRepo.listMissingBody(accountId, 10).get(0).messageId();
    // 1차 적재로 body_fetched_at 채움
    bodyFetcher.fetchBody(user, messageRepo.findBodyTarget(accountId, messageId).orElseThrow());
    BodyTarget loaded = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    assertThat(loaded.bodyFetchedAt()).isNotNull();

    // 2차 호출은 가드로 즉시 return — 예외 없이 멱등
    bodyFetcher.fetchBody(user, loaded);
  }

  /** ai_enabled=true → 본문 적재 후 messageId 기반 분류 결과가 저장된다. */
  @Test
  void fetchBody_aiEnabled_분류기록() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, true);
    GreenMailUtil.sendTextEmailTest("box@test.local", "sender@example.com", "업무 보고", "보고서 내용");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);
    long messageId = messageRepo.listMissingBody(accountId, 10).get(0).messageId();

    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
    when(mailClient.classify(any())).thenReturn(new ClassifyResult("업무", true));

    bodyFetcher.fetchBody(user, messageRepo.findBodyTarget(accountId, messageId).orElseThrow());

    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).hasSize(1);
    assertThat(list.get(0).aiCategory()).isEqualTo("업무");
    assertThat(list.get(0).aiNeedsReply()).isTrue();
  }
}

package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.mail.service.MailClassifyBackfillService;
import com.workplace.support.IntegrationTestBase;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-149 AI 켬(off→on) 백필 — 최근 안읽은 미분석 INBOX 메일에 ④ + ⑤ 를 실행한다. 배포 전에 분류된 메일(ai_needs_reply 있음)은 대상이
 * 아니다(재분석은 WP-151). 동기 본체 {@code classifyRecentUnreadNow} 를 직접 호출한다.
 */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailClassifyBackfillServiceTest extends IntegrationTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000);

  @Autowired DSLContext dsl;
  @Autowired MailClassifyBackfillService classifyBackfillService;
  @Autowired EmailContentRepository contentRepo;

  @MockitoBean AiAgentMailClient mailClient;
  @MockitoBean AssistantResolver assistantResolver;

  @BeforeEach
  void assistants() {
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.empty());
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
  }

  private Boolean needsReply(long id) {
    return dsl.select(EMAIL_MESSAGE.AI_NEEDS_REPLY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOneInto(Boolean.class);
  }

  @Test
  void classifyRecentUnreadNow_analyzesUnanalyzed() {
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, "업무"));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);

    classifyBackfillService.classifyRecentUnreadNow(box.userId(), box.accountId());

    assertThat(needsReply(env)).isTrue();
  }

  @Test
  void classifyRecentUnreadNow_noAssistant_skips() {
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.empty());
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);

    classifyBackfillService.classifyRecentUnreadNow(box.userId(), box.accountId());

    verify(mailClient, never()).analyzePersonal(any());
    assertThat(needsReply(env)).isNull();
  }

  @Test
  void classifyRecentUnreadNow_legacyClassified_notReanalyzed() {
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, false)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();

    classifyBackfillService.classifyRecentUnreadNow(box.userId(), box.accountId());

    verify(mailClient, never()).analyzePersonal(any());
  }
}

package com.workplace.mail.service;

import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** WP-149 본문 적재 직후 분석 — 안 읽은 INBOX 만(판단 13), ③ 실패해도 ④ 는 진행(best-effort). */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailAnalysisAfterLoadTest extends IntegrationTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @Autowired MailAnalysisService analysis;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EmailFolderRepository folderRepo;

  @MockitoBean AiAgentMailClient mailClient;
  @MockitoBean AssistantResolver assistantResolver;

  @BeforeEach
  void assistants() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.empty());
  }

  @Test
  void inbox_contentFailure_stillRunsPersonal() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzeContent(any()))
        .thenThrow(new MailAiException("AI 요청에 실패했어요.", new RuntimeException("boom")));
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, null));

    analysis.analyzeAfterLoad(box.userId(), env); // 예외가 새지 않는다

    verify(mailClient).analyzeContent(any());
    verify(mailClient).analyzePersonal(any());
  }

  /** 판단 13: 읽은 INBOX 메일은 적재 직후 선제 분석하지 않는다(요약은 열람 시 GET …/summary 가 만든다). */
  @Test
  void readInbox_skipsBackgroundAnalysis() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    MailAnalysisFixtures.markSeen(dsl, env);

    analysis.analyzeAfterLoad(box.userId(), env);

    verify(mailClient, never()).analyzeContent(any());
    verify(mailClient, never()).analyzePersonal(any());
  }

  @Test
  void nonInboxFolder_skipsBackgroundAnalysis() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long sent = folderRepo.ensureFolder(box.accountId(), "SENT").id();
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(
            dsl, box.accountId(), sent, content, box.address(), "x@acme.com", null);

    analysis.analyzeAfterLoad(box.userId(), env);

    verify(mailClient, never()).analyzeContent(any());
    verify(mailClient, never()).analyzePersonal(any());
  }
}

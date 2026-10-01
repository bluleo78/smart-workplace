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
import com.workplace.mail.outbound.MailAiMessages.AnalyzeContentResult;
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

/** WP-149 본문 적재 직후 분석 — ③ 은 INBOX 전체·④ 는 안 읽은 INBOX(판단 13 수정), ③ 실패해도 ④ 는 진행(best-effort). */
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

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache()); // 예외가 새지 않는다

    verify(mailClient).analyzeContent(any());
    verify(mailClient).analyzePersonal(any());
  }

  /** I1: 읽은 INBOX 메일도 ③(분류)은 선제 실행하고 ④(회신필요·개인 요약)만 안 읽은 메일로 제한한다. */
  @Test
  void readInbox_runsContentOnly() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    MailAnalysisFixtures.markSeen(dsl, env);
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", "• 요약"));

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    verify(mailClient).analyzeContent(any());
    verify(mailClient, never()).analyzePersonal(any());
  }

  /** 안 읽은 INBOX 는 ③·④ 모두 실행한다. */
  @Test
  void unreadInbox_runsBoth() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", "• 요약"));
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, null));

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    verify(mailClient).analyzeContent(any());
    verify(mailClient).analyzePersonal(any());
  }

  /** 읽은 INBOX 메일 + 계정 AI 꺼짐 → ③ 도 하지 않는다(WP-149 이전 분류 범위와 동일 — 비용 방지). */
  @Test
  void readInbox_aiDisabled_runsNothing() {
    Box box = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    MailAnalysisFixtures.markSeen(dsl, env);

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    verify(mailClient, never()).analyzeContent(any());
    verify(mailClient, never()).analyzePersonal(any());
  }

  /** 안 읽은 INBOX 메일 + 계정 AI 꺼짐 → ③ 은 공통 비서 조건대로 실행, ④ 는 AI 꺼짐이라 미실행. */
  @Test
  void unreadInbox_aiDisabled_runsContentOnly() {
    Box box = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", "• 요약"));

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    verify(mailClient).analyzeContent(any());
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

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    verify(mailClient, never()).analyzeContent(any());
    verify(mailClient, never()).analyzePersonal(any());
  }
}

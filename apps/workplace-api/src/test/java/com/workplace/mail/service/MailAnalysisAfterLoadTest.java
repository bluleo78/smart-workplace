package com.workplace.mail.service;

import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;
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
import com.workplace.mail.service.MailAnalysisService.AfterLoadOutcome;
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-149 본문 적재 직후 분석 — ③ 은 INBOX 전체·④ 는 안 읽은 INBOX(판단 13 수정), 모델 실패가 아닌 ③ 실패면 ④ 는 진행(best-effort).
 */
@Transactional
class MailAnalysisAfterLoadTest extends ExternalClientMockedTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @Autowired MailAnalysisService analysis;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EmailFolderRepository folderRepo;

  @Autowired AiAgentMailClient mailClient;
  @Autowired AssistantResolver assistantResolver;

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
    when(mailClient.analyzeContent(any())).thenThrow(new IllegalStateException("모델 실패가 아닌 ③ 실패"));
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, null));

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache()); // 예외가 새지 않는다

    verify(mailClient).analyzeContent(any());
    verify(mailClient).analyzePersonal(any());
  }

  /** WP-1812: 읽은 INBOX 메일의 ③ 이 MailAiException 이면 응답한 단계가 없으므로 AI_FAILED 를 돌려준다(백필 회로가 실패로 센다). */
  @Test
  void contentAiFailure_returnsAiFailed() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    MailAnalysisFixtures.markSeen(dsl, env);
    when(mailClient.analyzeContent(any()))
        .thenThrow(new MailAiException("AI 요청에 실패했어요.", new RuntimeException("boom")));

    AfterLoadOutcome outcome =
        analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    assertThat(outcome).isEqualTo(AfterLoadOutcome.AI_FAILED);
  }

  /** WP-1812: 안 읽은 메일이라도 ③ 이 모델 실패면 ④ 를 부르지 않고 AI_FAILED — 모델이 멈췄을 때 시간 초과를 메일당 두 번 기다리지 않는다. */
  @Test
  void unread_contentModelFailure_skipsPersonalAndReturnsAiFailed() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzeContent(any()))
        .thenThrow(new MailAiException("AI 요청에 실패했어요.", new RuntimeException("boom")));

    AfterLoadOutcome outcome =
        analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    assertThat(outcome).isEqualTo(AfterLoadOutcome.AI_FAILED);
    verify(mailClient, never()).analyzePersonal(any());
  }

  /** WP-1812: 분석 대상이 아니면(읽은 메일 + AI 꺼짐) 모델을 부르지 않으므로 SKIPPED — 회로에 영향이 없다. */
  @Test
  void notAnalyzable_returnsSkipped() {
    Box box = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    MailAnalysisFixtures.markSeen(dsl, env);

    AfterLoadOutcome outcome =
        analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    assertThat(outcome).isEqualTo(AfterLoadOutcome.SKIPPED);
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

  /** 회신필요 기간(2일) 밖 옛 메일 → 본문을 막 적재했어도 ③·④ 를 하지 않는다(열람 시 온디맨드). */
  @Test
  void oldMail_outsideWindow_runsNothing() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    MailAnalysisFixtures.receivedDaysAgo(dsl, env, 3);

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

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

    analysis.analyzeAfterLoad(box.userId(), env, analysis.newProfileCache());

    verify(mailClient, never()).analyzeContent(any());
    verify(mailClient, never()).analyzePersonal(any());
  }
}

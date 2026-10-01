package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static com.workplace.mail.service.MailAnalysisFixtures.SHORT_BODY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.AnalyzeContentRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzeContentResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.util.Optional;
import org.jooq.DSLContext;
import org.jooq.Record4;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** WP-149 ③ 원본 분석 통합 테스트 — 원본 1회, 요약 생략 조건, 실패 시 미기록, 늦게 온 분류로 ⑤ 재계산. */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailContentAnalysisTest extends IntegrationTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @Autowired MailAnalysisService analysis;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;

  @MockitoBean AiAgentMailClient mailClient;
  @MockitoBean AssistantResolver assistantResolver;

  @BeforeEach
  void workspaceAssistant() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
  }

  /** content 의 (category, summary, skipped, summarized_at). */
  private Record4<String, String, Boolean, java.time.OffsetDateTime> contentRow(long contentId) {
    return dsl.select(
            EMAIL_CONTENT.AI_CATEGORY,
            EMAIL_CONTENT.AI_SUMMARY,
            EMAIL_CONTENT.AI_SUMMARY_SKIPPED,
            EMAIL_CONTENT.AI_SUMMARIZED_AT)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .fetchOne();
  }

  private Boolean finalNeedsReply(long envelopeId) {
    return dsl.select(EMAIL_MESSAGE.AI_NEEDS_REPLY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .fetchOneInto(Boolean.class);
  }

  @Test
  void sharedContent_analyzedOnce_forTwoRecipients() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    Box b = MailAnalysisFixtures.mailbox(dsl, true);
    long content =
        MailAnalysisFixtures.content(
            dsl, contentRepo, LONG_BODY + "\n\n-----Original Message-----\n이전 메일 내용", "미리보기");
    long envA =
        MailAnalysisFixtures.envelope(dsl, a, content, "boss@corp.com", a.address(), b.address());
    long envB =
        MailAnalysisFixtures.envelope(dsl, b, content, "boss@corp.com", a.address(), b.address());
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", "• 배포 일정 확인"));

    analysis.analyzeContent(a.userId(), envA);
    analysis.analyzeContent(b.userId(), envB);

    ArgumentCaptor<AnalyzeContentRequest> req =
        ArgumentCaptor.forClass(AnalyzeContentRequest.class);
    verify(mailClient, times(1)).analyzeContent(req.capture());
    assertThat(req.getValue().includeCategory()).isTrue();
    assertThat(req.getValue().includeSummary()).isTrue();
    assertThat(req.getValue().body()).contains("배포 일정").doesNotContain("이전 메일 내용");
    var row = contentRow(content);
    assertThat(row.value1()).isEqualTo("업무");
    assertThat(row.value2()).isEqualTo("• 배포 일정 확인");
    assertThat(row.value3()).isFalse();
    assertThat(row.value4()).isNotNull();
  }

  @Test
  void shortBody_skipsSummary_butKeepsCategory() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, SHORT_BODY, SHORT_BODY);
    long env = MailAnalysisFixtures.envelope(dsl, a, content, "boss@corp.com", a.address(), null);
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", "무시될 요약"));

    analysis.analyzeContent(a.userId(), env);

    ArgumentCaptor<AnalyzeContentRequest> req =
        ArgumentCaptor.forClass(AnalyzeContentRequest.class);
    verify(mailClient).analyzeContent(req.capture());
    assertThat(req.getValue().includeSummary()).isFalse();
    assertThat(req.getValue().includeCategory()).isTrue();
    var row = contentRow(content);
    assertThat(row.value1()).isEqualTo("업무");
    assertThat(row.value2()).isNull();
    assertThat(row.value3()).isTrue(); // 생략 표시 — 버튼 근거
    assertThat(row.value4()).isNotNull(); // 생략해도 시도 기록
  }

  @Test
  void autoGenerated_sendsSnippet_andSkipsSummary() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "주간 소식 미리보기");
    contentRepo.markAutoGenerated(content);
    long env = MailAnalysisFixtures.envelope(dsl, a, content, "news@corp.com", a.address(), null);
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("뉴스레터", null));

    analysis.analyzeContent(a.userId(), env);

    ArgumentCaptor<AnalyzeContentRequest> req =
        ArgumentCaptor.forClass(AnalyzeContentRequest.class);
    verify(mailClient).analyzeContent(req.capture());
    assertThat(req.getValue().body()).isEqualTo("주간 소식 미리보기");
    assertThat(req.getValue().autoGenerated()).isTrue();
    assertThat(req.getValue().includeSummary()).isFalse();
    assertThat(contentRow(content).value1()).isEqualTo("뉴스레터");
  }

  @Test
  void unknownCategory_storedAsNull() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = MailAnalysisFixtures.envelope(dsl, a, content, "boss@corp.com", a.address(), null);
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("기타", "• 요약"));

    analysis.analyzeContent(a.userId(), env);

    assertThat(contentRow(content).value1()).isNull();
    assertThat(contentRow(content).value2()).isEqualTo("• 요약");
  }

  @Test
  void noWorkspaceAssistant_noCall() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = MailAnalysisFixtures.envelope(dsl, a, content, "boss@corp.com", a.address(), null);

    analysis.analyzeContent(a.userId(), env);

    verify(mailClient, never()).analyzeContent(any());
    assertThat(contentRow(content).value4()).isNull();
  }

  @Test
  void notFetched_noCall() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = MailAnalysisFixtures.envelope(dsl, a, content, "boss@corp.com", a.address(), null);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FETCHED_AT, (java.time.OffsetDateTime) null)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();

    analysis.analyzeContent(a.userId(), env);

    verify(mailClient, never()).analyzeContent(any());
  }

  @Test
  void llmFailure_recordsNothing() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = MailAnalysisFixtures.envelope(dsl, a, content, "boss@corp.com", a.address(), null);
    when(mailClient.analyzeContent(any()))
        .thenThrow(new MailAiException("AI 요청에 실패했어요.", new RuntimeException("boom")));

    assertThatThrownBy(() -> analysis.analyzeContent(a.userId(), env))
        .isInstanceOf(MailAiException.class);

    assertThat(contentRow(content).value4()).isNull(); // 다음 백필 대상
  }

  @Test
  void lateCategory_recomputesAnalyzedSiblingsOnly() {
    Box a = MailAnalysisFixtures.mailbox(dsl, true);
    Box b = MailAnalysisFixtures.mailbox(dsl, true);
    Box legacy = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long envA = MailAnalysisFixtures.envelope(dsl, a, content, "shop@corp.com", a.address(), null);
    long envB = MailAnalysisFixtures.envelope(dsl, b, content, "shop@corp.com", b.address(), null);
    long envLegacy =
        MailAnalysisFixtures.envelope(
            dsl, legacy, content, "shop@corp.com", legacy.address(), null);
    MailAnalysisFixtures.markPersonallyAnalyzed(dsl, envA, true); // ④ 먼저 끝남 — 최종 true
    MailAnalysisFixtures.markPersonallyAnalyzed(dsl, envB, true);
    // 배포 전 분류된 사본: raw 없음 + 최종값만 있음 — ⑤ 재계산 대상이 아니다
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, true)
        .where(EMAIL_MESSAGE.ID.eq(envLegacy))
        .execute();
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("프로모션", "• 할인"));

    analysis.analyzeContent(a.userId(), envA);

    assertThat(finalNeedsReply(envA)).isFalse();
    assertThat(finalNeedsReply(envB)).isFalse();
    assertThat(finalNeedsReply(envLegacy)).isTrue();
  }

  @Test
  void secondCall_doesNotCallAgain() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = MailAnalysisFixtures.envelope(dsl, a, content, "boss@corp.com", a.address(), null);
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", null));

    analysis.analyzeContent(a.userId(), env);
    analysis.analyzeContent(a.userId(), env);

    verify(mailClient, times(1)).analyzeContent(any());
  }
}

package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static com.workplace.mail.service.MailAnalysisFixtures.SHORT_BODY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.AnalyzeContentResult;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.util.Optional;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-149 ④ 개인 분석 통합 테스트 — 사본별 1회, 규칙 덮어쓰기(⑤), CC 는 LLM 판정, 분류 보충(공통 비서 없을 때만·덮어쓰기 없음), 개인 요약 생략·형식
 * 오류, 실패 시 미기록, ③·④ 순서 무관.
 */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailPersonalAnalysisTest extends IntegrationTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @Autowired MailAnalysisService analysis;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;

  @MockitoBean AiAgentMailClient mailClient;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoSpyBean NeedsReplyFinalizer finalizer;

  @BeforeEach
  void assistants() {
    // 기본: 공통 비서만 있는 사용자처럼 resolveOrEmpty 는 있고, 개인 비서·공통 비서(③용)는 없음
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.empty());
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
  }

  private static AnalyzePersonalResult reply(boolean needsReply) {
    return new AnalyzePersonalResult(needsReply, null, false, null);
  }

  private Record envelope(long id) {
    return dsl.select(
            EMAIL_MESSAGE.AI_NEEDS_REPLY,
            EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW,
            EMAIL_MESSAGE.AI_ANALYZED_AT,
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARY,
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT,
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOne();
  }

  private String contentCategory(long contentId) {
    return dsl.select(EMAIL_CONTENT.AI_CATEGORY)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .fetchOneInto(String.class);
  }

  private AnalyzePersonalRequest captured() {
    ArgumentCaptor<AnalyzePersonalRequest> req =
        ArgumentCaptor.forClass(AnalyzePersonalRequest.class);
    verify(mailClient).analyzePersonal(req.capture());
    return req.getValue();
  }

  @Test
  void toMe_noWorkspaceAssistant_requestsAndFillsCategory() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(
            dsl, box, content, "minsu@acme.com", box.address(), "x@acme.com, y@acme.com");
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, "업무"));

    analysis.analyzePersonal(box.userId(), env);

    AnalyzePersonalRequest req = captured();
    assertThat(req.includeNeedsReply()).isTrue();
    assertThat(req.includeCategory()).isTrue(); // 공통 비서 없음 + content 분류 비어 있음
    assertThat(req.includePersonalSummary()).isFalse(); // 개인 비서 없음
    assertThat(req.recipient().myRole()).isEqualTo("TO");
    assertThat(req.recipient().toCount()).isEqualTo(1);
    assertThat(req.recipient().ccCount()).isEqualTo(2);
    assertThat(req.me().addresses()).containsExactly(box.address());
    Record row = envelope(env);
    assertThat(row.get(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW)).isTrue();
    assertThat(row.get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isTrue();
    assertThat(row.get(EMAIL_MESSAGE.AI_ANALYZED_AT)).isNotNull();
    assertThat(contentCategory(content)).isEqualTo("업무");
  }

  @Test
  void existingContentCategory_notRequested_notOverwritten() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY, "알림")
        .where(EMAIL_CONTENT.ID.eq(content))
        .execute();
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, "업무"));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(captured().includeCategory()).isFalse();
    assertThat(contentCategory(content)).isEqualTo("알림");
    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW)).isTrue();
    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse(); // 알림 → 규칙
  }

  @Test
  void workspaceAssistantPresent_categoryNotRequested() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(captured().includeCategory()).isFalse();
  }

  @Test
  void ccOnly_followsLlm() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(
            dsl, box, content, "minsu@acme.com", "team@acme.com", box.address());
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(captured().recipient().myRole()).isEqualTo("CC");
    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isTrue();
  }

  @Test
  void notInToOrCc_forcedFalse() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", "team@acme.com", null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(captured().recipient().myRole()).isEqualTo("NONE");
    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW)).isTrue();
    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse();
  }

  @Test
  void senderIsMe_forcedFalse() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(
            dsl, box, content, box.address().toUpperCase(), box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse();
  }

  @Test
  void autoLocalPart_forcedFalse() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(
            dsl, box, content, "no-reply@service.com", box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse();
  }

  @Test
  void personalAssistant_longBody_storesPersonalSummary() {
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, "• 나에게: 금요일까지 일정 확인", true, null));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(captured().includePersonalSummary()).isTrue();
    Record row = envelope(env);
    assertThat(row.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY)).isEqualTo("• 나에게: 금요일까지 일정 확인");
    assertThat(row.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT)).isNotNull();
    assertThat(row.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED)).isFalse();
  }

  @Test
  void personalAssistant_shortBody_marksSkipped_withoutRequesting() {
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, SHORT_BODY, SHORT_BODY);
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(captured().includePersonalSummary()).isFalse();
    Record row = envelope(env);
    assertThat(row.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED)).isTrue();
    assertThat(row.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT)).isNull();
    assertThat(row.get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isTrue(); // 회신필요는 요약 생략과 무관
  }

  @Test
  void personalAssistant_rulesHit_skipsPersonalSummary() {
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(
            dsl, box, content, "noreply@service.com", box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(false));

    analysis.analyzePersonal(box.userId(), env);

    assertThat(captured().includePersonalSummary()).isFalse(); // 규칙에 걸려도 LLM 은 부르되 요약은 요청 안 함
    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED)).isTrue();
  }

  @Test
  void invalidPersonalSummary_keepsNeedsReply_leavesSummaryUnattempted() {
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, null));

    analysis.analyzePersonal(box.userId(), env);

    Record row = envelope(env);
    assertThat(row.get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isTrue();
    assertThat(row.get(EMAIL_MESSAGE.AI_ANALYZED_AT)).isNotNull();
    assertThat(row.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT)).isNull(); // 열람 시 요약만 다시 시도
    assertThat(row.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED)).isFalse();
  }

  @Test
  void llmFailure_leavesUnanalyzed() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any()))
        .thenThrow(new MailAiException("AI 요청에 실패했어요.", new RuntimeException("boom")));

    assertThatThrownBy(() -> analysis.analyzePersonal(box.userId(), env))
        .isInstanceOf(MailAiException.class);

    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_ANALYZED_AT)).isNull();
    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isNull();
  }

  @Test
  void missingNeedsReply_leavesUnanalyzed() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(null, null, false, null));

    assertThatThrownBy(() -> analysis.analyzePersonal(box.userId(), env))
        .isInstanceOf(IllegalStateException.class);

    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_ANALYZED_AT)).isNull();
  }

  @Test
  void analyzedOnce_perEnvelope() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(false));

    analysis.analyzePersonal(box.userId(), env);
    analysis.analyzePersonal(box.userId(), env);

    verify(mailClient, times(1)).analyzePersonal(any());
  }

  @Test
  void aiDisabledAccount_noCall() {
    Box box = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);

    analysis.analyzePersonal(box.userId(), env);

    verify(mailClient, never()).analyzePersonal(any());
  }

  @Test
  void noAssistant_noCall() {
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.empty());
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);

    analysis.analyzePersonal(box.userId(), env);

    verify(mailClient, never()).analyzePersonal(any());
  }

  @Test
  void finalValue_sameRegardlessOfOrder() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("프로모션", null));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long contentA = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long contentB = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long personalFirst =
        MailAnalysisFixtures.envelope(dsl, box, contentA, "shop@corp.com", box.address(), null);
    long contentFirst =
        MailAnalysisFixtures.envelope(dsl, box, contentB, "shop@corp.com", box.address(), null);

    analysis.analyzePersonal(box.userId(), personalFirst); // ④ 먼저 → 이 시점엔 true
    assertThat(envelope(personalFirst).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isTrue();
    analysis.analyzeContent(box.userId(), personalFirst); // ③ 늦게 → 재계산
    analysis.analyzeContent(box.userId(), contentFirst); // ③ 먼저
    analysis.analyzePersonal(box.userId(), contentFirst); // ④ 늦게

    assertThat(envelope(personalFirst).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse();
    assertThat(envelope(contentFirst).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse();
  }

  @Test
  void postCommitRecompute_runsAgain() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    analysis.analyzePersonal(box.userId(), env);

    // 저장 트랜잭션 안 1회 + ③ 과 겹침을 메우는 커밋 후 1회
    verify(finalizer, times(2)).recompute(env);
  }

  @Test
  void categoryLandingAfterSave_isPickedUpByPostCommitRecompute() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));
    // 첫 recompute(저장 트랜잭션 안) 직후 ③ 이 분류를 저장한 상황을 흉내 낸다
    org.mockito.Mockito.doAnswer(
            inv -> {
              Object r = inv.callRealMethod();
              dsl.update(EMAIL_CONTENT)
                  .set(EMAIL_CONTENT.AI_CATEGORY, "프로모션")
                  .where(EMAIL_CONTENT.ID.eq(content))
                  .execute();
              return r;
            })
        .doCallRealMethod()
        .when(finalizer)
        .recompute(env);

    analysis.analyzePersonal(box.userId(), env);

    assertThat(envelope(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse();
  }
}

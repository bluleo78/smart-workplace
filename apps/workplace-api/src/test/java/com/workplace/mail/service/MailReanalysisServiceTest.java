package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;
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
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
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
 * WP-151 새 기준 재분석 — ai_classify_version 이 낮은 AI 사용 계정만, 계정당 1회만. 옛 기준 분류 행을 ④ + ⑤ 로 다시 판정하고, 기존 개인
 * 요약이 있으면 needsReply 만 요청한다. 비서가 없으면 버전을 소진하지 않고, 시도가 전부 실패하면 버전을 되돌린다. "나" 프로필은 계정 1개 재분석 동안 한 번만
 * 읽는다(WP-150 배치 캐시).
 */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailReanalysisServiceTest extends IntegrationTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @Autowired MailReanalysisService reanalysis;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;

  @MockitoBean AiAgentMailClient mailClient;
  @MockitoBean AssistantResolver assistantResolver;
  // WP-150 "나" 프로필 빌더 — 계정 루프 동안 캐시 1개를 쓰는지(메일마다 다시 읽지 않는지) 호출 수로 확인한다
  @MockitoSpyBean UserMailProfileBuilder profileBuilder;

  @BeforeEach
  void assistants() {
    // 기본: 공통 비서로 ④ 를 돌리는 사용자(개인 비서 없음, ③ 용 공통 비서 없음 → ④ 가 분류 보충)
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.empty());
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
  }

  private static AnalyzePersonalResult reply(boolean needsReply) {
    return new AnalyzePersonalResult(needsReply, null, false, "업무");
  }

  /** 배포 전 기준으로 분류된 사본 — ai_needs_reply 만 있고 raw·ai_analyzed_at 은 NULL. */
  private long legacyEnvelope(Box box, long content, String from, String to, boolean oldValue) {
    long env = MailAnalysisFixtures.envelope(dsl, box, content, from, to, null);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, oldValue)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    return env;
  }

  private int version(long accountId) {
    return dsl.select(EMAIL_ACCOUNT.AI_CLASSIFY_VERSION)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .fetchOneInto(Integer.class);
  }

  private Record row(long id) {
    return dsl.select(
            EMAIL_MESSAGE.AI_NEEDS_REPLY,
            EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW,
            EMAIL_MESSAGE.AI_ANALYZED_AT,
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOne();
  }

  @Test
  void outdatedAccount_reanalyzesLegacyRows_andSetsVersion() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    // 옛 기준 false → 새 기준(LLM true, To 가 나) → true
    long a = legacyEnvelope(box, content, "minsu@acme.com", box.address(), false);
    // 옛 기준 true, LLM true 지만 To/CC 에 내가 없음 → ⑤ 규칙으로 false
    long b = legacyEnvelope(box, content, "minsu@acme.com", "someone@acme.com", true);
    // 아직 분류되지 않은 행도 대상
    long c =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    assertThat(reanalysis.reanalyzeAccountNow(box.userId(), box.accountId())).isTrue();

    verify(mailClient, times(3)).analyzePersonal(any());
    // 메일 3건이어도 "나" 프로필은 계정 루프 동안 1회만 조회(WP-150 배치 캐시 — 2인자 호출이면 3회)
    verify(profileBuilder, times(1)).build(box.userId());
    assertThat(version(box.accountId())).isEqualTo(MailReanalysisService.CURRENT_CLASSIFY_VERSION);
    for (long id : new long[] {a, b, c}) {
      assertThat(row(id).get(EMAIL_MESSAGE.AI_ANALYZED_AT)).isNotNull();
      assertThat(row(id).get(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW)).isTrue();
    }
    assertThat(row(a).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isTrue();
    assertThat(row(b).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse(); // 규칙 덮어쓰기
    assertThat(row(c).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isTrue();
  }

  @Test
  void legacyTrue_llmFalse_clearsFlag() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(false));

    reanalysis.reanalyzeAccountNow(box.userId(), box.accountId());

    assertThat(row(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isFalse();
    assertThat(row(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW)).isFalse();
  }

  @Test
  void secondRun_noLlmCalls() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    when(mailClient.analyzePersonal(any())).thenReturn(reply(true));

    assertThat(reanalysis.reanalyzeAccountNow(box.userId(), box.accountId())).isTrue();
    // 새 옛-분류 행이 생겨도 같은 버전에서는 다시 돌지 않는다(계정당 1회)
    legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    assertThat(reanalysis.reanalyzeAccountNow(box.userId(), box.accountId())).isFalse();

    verify(mailClient, times(1)).analyzePersonal(any());
  }

  @Test
  void currentVersionAccount_untouched() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_CLASSIFY_VERSION, MailReanalysisService.CURRENT_CLASSIFY_VERSION)
        .where(EMAIL_ACCOUNT.ID.eq(box.accountId()))
        .execute();
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);

    assertThat(reanalysis.reanalyzeAccountNow(box.userId(), box.accountId())).isFalse();

    verify(mailClient, never()).analyzePersonal(any());
    assertThat(row(env).get(EMAIL_MESSAGE.AI_NEEDS_REPLY)).isTrue(); // 옛 값 그대로
  }

  @Test
  void aiDisabled_notClaimed() {
    Box box = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);

    assertThat(reanalysis.reanalyzeAccountNow(box.userId(), box.accountId())).isFalse();

    verify(mailClient, never()).analyzePersonal(any());
    assertThat(version(box.accountId())).isZero();
  }

  @Test
  void noAssistant_notClaimed() {
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.empty());
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);

    assertThat(reanalysis.reanalyzeAccountNow(box.userId(), box.accountId())).isFalse();

    verify(mailClient, never()).analyzePersonal(any());
    assertThat(version(box.accountId())).isZero(); // 비서 설정 후 다시 대상이 된다
  }

  @Test
  void existingPersonalSummary_requestsNeedsReplyOnly() {
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY, "• 기존 개인 요약")
        .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    when(mailClient.analyzePersonal(any())).thenReturn(reply(false));

    reanalysis.reanalyzeAccountNow(box.userId(), box.accountId());

    ArgumentCaptor<AnalyzePersonalRequest> req =
        ArgumentCaptor.forClass(AnalyzePersonalRequest.class);
    verify(mailClient).analyzePersonal(req.capture());
    assertThat(req.getValue().includeNeedsReply()).isTrue();
    assertThat(req.getValue().includePersonalSummary()).isFalse();
    assertThat(row(env).get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY)).isEqualTo("• 기존 개인 요약");
  }

  @Test
  void capsAtFifty() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    for (int i = 0; i < MailReanalysisService.LIMIT + 1; i++) {
      legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    }
    when(mailClient.analyzePersonal(any())).thenReturn(reply(false));

    reanalysis.reanalyzeAccountNow(box.userId(), box.accountId());

    verify(mailClient, times(MailReanalysisService.LIMIT)).analyzePersonal(any());
  }

  @Test
  void allAttemptsFail_releasesVersion() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    when(mailClient.analyzePersonal(any())).thenThrow(new MailAiException("down", null));

    assertThat(reanalysis.reanalyzeAccountNow(box.userId(), box.accountId())).isTrue();

    assertThat(version(box.accountId())).isZero(); // 다음 주기에 다시 시도
    assertThat(row(env).get(EMAIL_MESSAGE.AI_ANALYZED_AT)).isNull();
  }

  @Test
  void consecutiveFailures_stopEarly_andRelease() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    for (int i = 0; i < 10; i++) {
      legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    }
    when(mailClient.analyzePersonal(any())).thenThrow(new MailAiException("down", null));

    reanalysis.reanalyzeAccountNow(box.userId(), box.accountId());

    verify(mailClient, times(MailReanalysisService.MAX_CONSECUTIVE_FAILURES))
        .analyzePersonal(any());
    assertThat(version(box.accountId())).isZero();
  }

  @Test
  void partialFailure_keepsVersion() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    legacyEnvelope(box, content, "minsu@acme.com", box.address(), true);
    when(mailClient.analyzePersonal(any()))
        .thenThrow(new MailAiException("flaky", null))
        .thenReturn(reply(false));

    reanalysis.reanalyzeAccountNow(box.userId(), box.accountId());

    assertThat(version(box.accountId())).isEqualTo(MailReanalysisService.CURRENT_CLASSIFY_VERSION);
  }

  @Test
  void noTargets_keepsVersion() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);

    assertThat(reanalysis.reanalyzeAccountNow(box.userId(), box.accountId())).isTrue();

    verify(mailClient, never()).analyzePersonal(any());
    assertThat(version(box.accountId())).isEqualTo(MailReanalysisService.CURRENT_CLASSIFY_VERSION);
  }
}

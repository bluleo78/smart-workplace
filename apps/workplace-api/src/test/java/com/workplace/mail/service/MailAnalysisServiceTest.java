package com.workplace.mail.service;

import static com.workplace.jooq.Tables.AI_RUN;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.service.AssistantLimitWaitService;
import com.workplace.auth.service.AssistantResolution;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.LimitWaitFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.HttpServerErrorException;

/**
 * WP-2108 메일 분석의 사용 한도 대기 — 공통 비서가 대기 중이면 ③ 원본 분석은 건너뛰고(SKIPPED limit_wait) ④ 개인 분석이 분류를 떠맡지 않으며,
 * ai-agent 가 503 PROVIDER_LIMIT 를 내면 그 자격이 대기에 들어간다.
 */
@Transactional
class MailAnalysisServiceTest extends ExternalClientMockedTestBase {

  @Autowired MailAnalysisService analysis;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;
  @Autowired AiAgentMailClient mailClient;
  @Autowired AssistantResolver assistantResolver;
  @Autowired AssistantLimitWaitService waitService;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired PlatformTransactionManager ptm;

  private LimitWaitFixtures fixtures;

  @BeforeEach
  void fixtures() {
    TenantContext.set(1L);
    fixtures = new LimitWaitFixtures(ptm, dsl, credentialRepo);
  }

  @AfterEach
  void cleanFixtures() {
    fixtures.cleanup();
    // 건너뜀 기록은 별도(REQUIRES_NEW) 트랜잭션으로 커밋돼 롤백되지 않는다 — 다른 시험이 같은 종류의 행 수를 세므로 지운다.
    var t = new org.springframework.transaction.support.TransactionTemplate(ptm);
    t.setPropagationBehavior(
        org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    t.executeWithoutResult(
        s ->
            dsl.deleteFrom(AI_RUN)
                .where(AI_RUN.KIND.eq("MAIL_ANALYZE_CONTENT"))
                .and(AI_RUN.ERROR_REASON.eq("limit_wait"))
                .execute());
  }

  @Test
  void 공통비서_대기중_원본분석은_건너뛰고_개인분석이_분류를_떠맡지_않는다() {
    long credentialId = 960_000_000L + System.nanoTime() % 1_000_000L;
    doReturn(AssistantResolution.waiting(credentialId, Instant.now().plus(Duration.ofHours(1))))
        .when(assistantResolver)
        .workspaceResolution();
    when(assistantResolver.hasWorkspaceAssistant()).thenReturn(true);
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "minsu@acme.com", box.address(), null);

    assertThat(analysis.analyzeContent(box.userId(), env)).isFalse();

    verify(mailClient, never()).analyzeContent(any());
    var rows =
        dsl.selectFrom(AI_RUN)
            .where(AI_RUN.KIND.eq("MAIL_ANALYZE_CONTENT"))
            .and(AI_RUN.TARGET_ID.eq(String.valueOf(env)))
            .and(AI_RUN.ERROR_REASON.eq("limit_wait"))
            .and(AI_RUN.STATUS.eq("SKIPPED"))
            .fetch();
    assertThat(rows).hasSize(1);

    // 개인 분석 — 공통 비서가 대기 중이어도 「있다」 이므로 분류 요청을 싣지 않는다.
    doReturn(AssistantResolution.ready(new AssistantSpec(9L, "m", "NORMAL", 8, 60_000)))
        .when(assistantResolver)
        .resolution(box.userId());
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, null));
    analysis.analyzePersonal(box.userId(), env, analysis.newProfileCache());
    ArgumentCaptor<AnalyzePersonalRequest> cap =
        ArgumentCaptor.forClass(AnalyzePersonalRequest.class);
    verify(mailClient).analyzePersonal(cap.capture());
    assertThat(cap.getValue().includeCategory()).isFalse();
  }

  @Test
  void 원본분석_503_PROVIDER_LIMIT_이면_공통비서_자격이_대기에_들어간다() {
    var f = fixtures.create();
    doReturn(AssistantResolution.ready(f.spec())).when(assistantResolver).workspaceResolution();
    Box box = MailAnalysisFixtures.mailbox(dsl, false);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env =
        MailAnalysisFixtures.envelope(dsl, box, content, "boss@corp.com", box.address(), null);
    Instant resets = Instant.now().plus(Duration.ofHours(2));
    String body = "{\"reason\":\"PROVIDER_LIMIT\",\"resetsAt\":\"" + resets + "\"}";
    var unavailable =
        new MailAiUnavailableException(
            "AI 비서를 사용할 수 없어요.",
            new HttpServerErrorException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "",
                new HttpHeaders(),
                body.getBytes(StandardCharsets.UTF_8),
                StandardCharsets.UTF_8));
    when(mailClient.analyzeContent(any())).thenThrow(unavailable);

    assertThatThrownBy(() -> analysis.analyzeContent(box.userId(), env))
        .isInstanceOf(MailAiUnavailableException.class);

    assertThat(waitService.activeUntil(f.credentialId()))
        .hasValueSatisfying(
            u ->
                assertThat(u)
                    .isCloseTo(
                        resets, org.assertj.core.api.Assertions.within(2, ChronoUnit.SECONDS)));
  }
}

package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchEntry;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchRequest;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** WP-185 전체 메일 카테고리 일괄 분류 — 대상 선정·저장 규칙·실패 처리. */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailCategoryBackfillIT extends IntegrationTestBase {

  private static final AssistantSpec WORKSPACE =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);
  private static final AssistantSpec PERSONAL =
      new AssistantSpec(9L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @Autowired MailCategoryBackfillService service;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;

  @MockitoBean AiAgentMailClient mailClient;
  @MockitoBean AssistantResolver assistantResolver;

  @BeforeEach
  void workspaceAssistant() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(WORKSPACE));
  }

  /** 에이전트가 요청 id 마다 같은 분류를 돌려주게 한다. */
  private void answerAll(String category) {
    when(mailClient.classifyBatch(any()))
        .thenAnswer(
            inv -> {
              ClassifyBatchRequest req = inv.getArgument(0);
              return new ClassifyBatchResult(
                  req.items().stream()
                      .map(it -> new ClassifyBatchEntry(it.id(), category))
                      .toList());
            });
  }

  private Record2<String, OffsetDateTime> contentState(long contentId) {
    return dsl.select(EMAIL_CONTENT.AI_CATEGORY, EMAIL_CONTENT.AI_CATEGORIZED_AT)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .fetchOne();
  }

  @Test
  void oldReadMail_isClassified() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    long env = MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    MailAnalysisFixtures.receivedDaysAgo(dsl, env, 30);
    MailAnalysisFixtures.markSeen(dsl, env);
    answerAll("업무");

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    assertThat(contentState(c).value1()).isEqualTo("업무");
    assertThat(contentState(c).value2()).isNotNull();
  }

  @Test
  void existingCategory_isNotSelectedNorOverwritten() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY, "개인")
        .where(EMAIL_CONTENT.ID.eq(c))
        .execute();

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    verify(mailClient, never()).classifyBatch(any());
    assertThat(contentState(c).value1()).isEqualTo("개인");
  }

  @Test
  void nullCategory_marksAttempted_andIsNotRetried() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    answerAll(null);

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());
    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    verify(mailClient, times(1)).classifyBatch(any());
    assertThat(contentState(c).value1()).isNull();
    assertThat(contentState(c).value2()).isNotNull();
  }

  @Test
  void agentDown_recordsNothing() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    when(mailClient.classifyBatch(any())).thenThrow(new MailAiUnavailableException("down"));

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    assertThat(contentState(c).value1()).isNull();
    assertThat(contentState(c).value2()).isNull();
  }

  @Test
  void unfetchedEnvelope_isExcluded() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    long env = MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FETCHED_AT, (OffsetDateTime) null)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    verify(mailClient, never()).classifyBatch(any());
  }

  @Test
  void noAssistant_skipsCall() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    verify(mailClient, never()).classifyBatch(any());
  }

  @Test
  void personalAssistant_usedWhenNoWorkspace_andAiEnabled() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    Box a = MailAnalysisFixtures.mailbox(dsl, true);
    when(assistantResolver.resolvePersonalOrEmpty(a.userId())).thenReturn(Optional.of(PERSONAL));
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    answerAll("업무");

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    ArgumentCaptor<ClassifyBatchRequest> req = ArgumentCaptor.forClass(ClassifyBatchRequest.class);
    verify(mailClient).classifyBatch(req.capture());
    assertThat(req.getValue().assistantAgentId()).isEqualTo(9L);
  }

  @Test
  void thirtyMails_areSentInTwoBatches_newestFirst() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    for (int i = 0; i < 30; i++) {
      long c =
          MailAnalysisFixtures.content(
              dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
      long env = MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
      MailAnalysisFixtures.receivedDaysAgo(dsl, env, i);
    }
    answerAll("업무");

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    ArgumentCaptor<ClassifyBatchRequest> req = ArgumentCaptor.forClass(ClassifyBatchRequest.class);
    verify(mailClient, times(2)).classifyBatch(req.capture());
    assertThat(req.getAllValues().get(0).items()).hasSize(25);
    assertThat(req.getAllValues().get(1).items()).hasSize(5);
  }

  /** 회차 예산(maxBatches)을 넘겨 받으면 계정 상한보다 먼저 그 예산에서 멈추고, 실제로 부른 묶음 수를 돌려준다. */
  @Test
  void budget_stopsAtGivenBatches_andReturnsCallCount() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    for (int i = 0; i < 30; i++) {
      long c =
          MailAnalysisFixtures.content(
              dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
      long env = MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
      MailAnalysisFixtures.receivedDaysAgo(dsl, env, i);
    }
    answerAll("업무");

    int used = service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard(), 1);

    assertThat(used).isEqualTo(1);
    verify(mailClient, times(1)).classifyBatch(any());
  }

  /** 예산이 0 이면 비서 해석도 LLM 호출도 하지 않는다. */
  @Test
  void zeroBudget_makesNoCall() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    answerAll("업무");

    int used = service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard(), 0);

    assertThat(used).isZero();
    verify(mailClient, never()).classifyBatch(any());
  }

  @Test
  void unrequestedIdInResponse_isIgnored() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    Box other = MailAnalysisFixtures.mailbox(dsl, false);
    long mine =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    long envMine = MailAnalysisFixtures.envelope(dsl, a, mine, "boss@corp.com", a.address(), null);
    long theirs =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    long envTheirs =
        MailAnalysisFixtures.envelope(dsl, other, theirs, "x@corp.com", other.address(), null);
    when(mailClient.classifyBatch(any()))
        .thenReturn(
            new ClassifyBatchResult(
                List.of(
                    new ClassifyBatchEntry(envMine, "업무"),
                    new ClassifyBatchEntry(envTheirs, "개인"))));

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    assertThat(contentState(mine).value1()).isEqualTo("업무");
    assertThat(contentState(theirs).value1()).isNull();
    assertThat(contentState(theirs).value2()).isNull();
  }

  @Test
  void sharedContent_classifiedOnce() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), "cc@corp.com");
    answerAll("업무");

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());
    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    verify(mailClient, times(1)).classifyBatch(any());
    assertThat(contentState(c).value1()).isEqualTo("업무");
  }

  @Test
  void autoGenerated_sendsSnippet_andLongBodyIsCut() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long auto =
        MailAnalysisFixtures.content(dsl, contentRepo, MailAnalysisFixtures.LONG_BODY, "미리보기 문장");
    contentRepo.markAutoGenerated(auto);
    long envAuto = MailAnalysisFixtures.envelope(dsl, a, auto, "news@corp.com", a.address(), null);
    String longBody = "가".repeat(900);
    long big = MailAnalysisFixtures.content(dsl, contentRepo, longBody, "s");
    long envBig = MailAnalysisFixtures.envelope(dsl, a, big, "boss@corp.com", a.address(), null);
    answerAll("업무");

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    ArgumentCaptor<ClassifyBatchRequest> req = ArgumentCaptor.forClass(ClassifyBatchRequest.class);
    verify(mailClient).classifyBatch(req.capture());
    var byId =
        req.getValue().items().stream()
            .collect(java.util.stream.Collectors.toMap(it -> it.id(), it -> it.bodyHead()));
    assertThat(byId.get(envAuto)).isEqualTo("미리보기 문장");
    assertThat(byId.get(envBig)).hasSize(500);
  }

  /** 가장 최신 메일 1통이 독이어서 포함된 요청이 항상 502 면 — 단건 폴백으로 독만 시도 처리하고 나머지는 분류한다. */
  @Test
  void poisonMail_isIsolatedBySingleItemFallback_andOthersClassified() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long[] contents = new long[3];
    long[] envs = new long[3];
    for (int i = 0; i < 3; i++) {
      contents[i] =
          MailAnalysisFixtures.content(
              dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
      envs[i] = MailAnalysisFixtures.envelope(dsl, a, contents[i], "b@corp.com", a.address(), null);
      MailAnalysisFixtures.receivedDaysAgo(dsl, envs[i], i); // i=0 이 최신 = 독
    }
    long poison = envs[0];
    when(mailClient.classifyBatch(any()))
        .thenAnswer(
            inv -> {
              ClassifyBatchRequest req = inv.getArgument(0);
              if (req.items().stream().anyMatch(it -> it.id() == poison)) {
                throw new MailAiException("502", new RuntimeException("bad gateway"));
              }
              return new ClassifyBatchResult(
                  req.items().stream().map(it -> new ClassifyBatchEntry(it.id(), "업무")).toList());
            });

    int used = service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    // 묶음(3통) 실패 1 + 독 단건 실패 1 + 나머지 단건 2 = 4 호출
    assertThat(used).isEqualTo(4);
    assertThat(contentState(contents[0]).value1()).isNull();
    assertThat(contentState(contents[0]).value2()).isNotNull();
    assertThat(contentState(contents[1]).value1()).isEqualTo("업무");
    assertThat(contentState(contents[2]).value1()).isEqualTo("업무");
  }

  /** 단건 호출이라도 ai-agent 불가(503)면 독이라는 증거가 아니므로 아무것도 기록하지 않는다. */
  @Test
  void singleItemAgentUnavailable_marksNothing() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "b@corp.com", a.address(), null);
    when(mailClient.classifyBatch(any())).thenThrow(new MailAiUnavailableException("down"));

    service.classifyAccountNow(a.userId(), a.accountId(), new AgentOutageGuard());

    verify(mailClient, times(1)).classifyBatch(any());
    assertThat(contentState(c).value2()).isNull();
  }
}

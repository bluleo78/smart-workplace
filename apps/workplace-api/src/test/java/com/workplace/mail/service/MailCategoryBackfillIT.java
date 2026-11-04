package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
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
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchItem;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchRequest;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** WP-185 전체 메일 카테고리 일괄 분류 — 대상 선정·저장 규칙·실패 처리. */
@Transactional
@RecordApplicationEvents
class MailCategoryBackfillIT extends ExternalClientMockedTestBase {

  private static final AssistantSpec WORKSPACE =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);
  private static final AssistantSpec PERSONAL =
      new AssistantSpec(9L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @Autowired MailCategoryBackfillService service;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired ApplicationEvents events;

  @Autowired AiAgentMailClient mailClient;
  @Autowired AssistantResolver assistantResolver;

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

  /** WP-1347 재시도 상태 — 시도 횟수와 다음 시도 시각. */
  private Record2<Short, OffsetDateTime> retryState(long contentId) {
    return dsl.select(EMAIL_CONTENT.AI_CATEGORY_ATTEMPTS, EMAIL_CONTENT.AI_CATEGORY_NEXT_ATTEMPT_AT)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .fetchOne();
  }

  /** 다음 시도 시각을 과거로 당겨 다시 고를 수 있게 한다. */
  private void pullNextAttemptIntoPast(long contentId) {
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY_NEXT_ATTEMPT_AT, dbNow().minusMinutes(1))
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .execute();
  }

  /** 다음 시도 시각이 DB now + delay(±1분) 인지 단언한다. */
  private void assertNextAttemptIn(long contentId, Duration delay) {
    assertThat(retryState(contentId).value2())
        .isCloseTo(dbNow().plus(delay), within(1, ChronoUnit.MINUTES));
  }

  /** 아직 한 번도 실패를 기록하지 않은 상태(시도 0·다음 시각 없음). */
  private void assertNoRetryRecorded(long contentId) {
    assertThat(retryState(contentId).value1()).isEqualTo((short) 0);
    assertThat(retryState(contentId).value2()).isNull();
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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    assertThat(contentState(c).value1()).isEqualTo("업무");
    assertThat(contentState(c).value2()).isNotNull();
  }

  @Test
  void filledCategory_notifiesEveryOwnerOfSharedContent() {
    // WP-359: 분류는 공유 원본에 저장되므로 같은 원본을 가진 다른 사용자 화면도 무효화해야 한다
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    Box b = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), b.address());
    MailAnalysisFixtures.envelope(dsl, b, c, "boss@corp.com", a.address(), b.address());
    answerAll("업무");

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    assertThat(MailAnalysisFixtures.mailChanges(events))
        .extracting(MailAnalysisFixtures::ownerOf)
        .containsExactlyInAnyOrder(MailAnalysisFixtures.owner(a), MailAnalysisFixtures.owner(b));
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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    verify(mailClient, never()).classifyBatch(any());
    assertThat(contentState(c).value1()).isEqualTo("개인");
  }

  /** WP-1347: 빈 분류는 영구 제외하지 않고 1h 뒤 재시도로 미룬다 — 그 전에는 다시 고르지 않는다. */
  @Test
  void nullCategory_schedulesRetry_andIsNotRetriedBeforeNext() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    answerAll(null);

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);
    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    verify(mailClient, times(1)).classifyBatch(any());
    assertThat(contentState(c).value1()).isNull();
    assertThat(contentState(c).value2()).isNull();
    assertThat(retryState(c).value1()).isEqualTo((short) 1);
    assertNextAttemptIn(c, Duration.ofHours(1));
  }

  /** 사내 구성원이 보낸 메일과 자동 발송 메일은 분류 입력에 그 신호를 싣는다(WP-1342). 아니면 false. */
  @Test
  void classifyBatch_sendsMemberAndAutoGeneratedFlags() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    TestFixtures.activeMemberOfCurrentTenant(dsl, a.userId());
    long memberContent =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    long member =
        MailAnalysisFixtures.envelope(
            dsl, a, memberContent, a.address().toUpperCase(), a.address(), null);
    long autoContent =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AUTO_GENERATED, true)
        .where(EMAIL_CONTENT.ID.eq(autoContent))
        .execute();
    long auto =
        MailAnalysisFixtures.envelope(dsl, a, autoContent, "news@ext.com", a.address(), null);
    answerAll("업무");

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    ArgumentCaptor<ClassifyBatchRequest> req = ArgumentCaptor.forClass(ClassifyBatchRequest.class);
    verify(mailClient).classifyBatch(req.capture());
    ClassifyBatchItem m =
        req.getValue().items().stream().filter(i -> i.id() == member).findFirst().orElseThrow();
    ClassifyBatchItem x =
        req.getValue().items().stream().filter(i -> i.id() == auto).findFirst().orElseThrow();
    assertThat(m.senderIsMember()).isTrue();
    assertThat(m.autoGenerated()).isFalse();
    assertThat(x.senderIsMember()).isFalse();
    assertThat(x.autoGenerated()).isTrue();
  }

  /** 「(광고)」 제목인데 모델이 업무라고 해도 프로모션으로 저장한다(WP-1340). */
  @Test
  void classifyBatch_savesPromotion_whenAgentSaysWorkForAdSubject() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    subject(c, "(광고) 우리가 [일하는 사이]");
    MailAnalysisFixtures.envelope(dsl, a, c, "event@wanted.co.kr", a.address(), null);
    answerAll("업무");

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    assertThat(contentState(c).value1()).isEqualTo("프로모션");
  }

  /** 사내 구성원이 보낸 정기 브리프를 모델이 뉴스레터라고 해도 업무로 저장한다(WP-1342). */
  @Test
  void classifyBatch_savesWork_whenMemberNewsletter() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    TestFixtures.activeMemberOfCurrentTenant(dsl, a.userId());
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    subject(c, "iA_CLOUD_DAILY_MARKET_BRIEF_261028");
    MailAnalysisFixtures.envelope(dsl, a, c, a.address(), a.address(), null);
    answerAll("뉴스레터");

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    assertThat(contentState(c).value1()).isEqualTo("업무");
  }

  private void subject(long contentId, String subject) {
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.SUBJECT, subject)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .execute();
  }

  /** 「(광고)」 제목인데 모델이 분류를 비워도 결정적 보정이 프로모션으로 채운다(WP-1340) — 빈 결과 재시도(WP-1347)로 미루지 않고 완료로 기록한다. */
  @Test
  void classifyBatch_savesPromotion_whenAgentReturnsEmptyForAdSubject() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    subject(c, "(광고) 11월 할인 안내");
    MailAnalysisFixtures.envelope(dsl, a, c, "event@shop.co.kr", a.address(), null);
    answerAll(null);

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    assertThat(contentState(c).value1()).isEqualTo("프로모션");
    assertThat(contentState(c).value2()).isNotNull();
    assertThat(retryState(c).value1()).isEqualTo((short) 0);
  }

  @Test
  void agentDown_recordsNothing() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, a, c, "boss@corp.com", a.address(), null);
    when(mailClient.classifyBatch(any())).thenThrow(new MailAiUnavailableException("down"));

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    assertThat(contentState(c).value1()).isNull();
    assertThat(contentState(c).value2()).isNull();
    assertNoRetryRecorded(c);
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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);
    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    ArgumentCaptor<ClassifyBatchRequest> req = ArgumentCaptor.forClass(ClassifyBatchRequest.class);
    verify(mailClient).classifyBatch(req.capture());
    var byId =
        req.getValue().items().stream()
            .collect(java.util.stream.Collectors.toMap(it -> it.id(), it -> it.bodyHead()));
    assertThat(byId.get(envAuto)).isEqualTo("미리보기 문장");
    assertThat(byId.get(envBig)).hasSize(500);
  }

  /**
   * 가장 최신 메일 1통이 독이어서 포함된 요청이 항상 502 면 — 단건 폴백으로 독을 격리하고 나머지는 분류한다. WP-1347: 독은 영구 제외(시도 시각)하지 않고
   * 1h 뒤 재시도로 미룬다.
   */
  @Test
  void poisonMail_schedulesRetry_insteadOfMarking() {
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

    int used =
        service.classifyAccountNow(
            a.userId(),
            a.accountId(),
            new AgentOutageGuard(),
            MailCategoryBackfillService.MAX_BATCHES);

    // 묶음(3통) 실패 1 + 독 단건 실패 1 + 나머지 단건 2 = 4 호출
    assertThat(used).isEqualTo(4);
    assertThat(contentState(contents[0]).value1()).isNull();
    assertThat(contentState(contents[0]).value2()).isNull();
    assertThat(retryState(contents[0]).value1()).isEqualTo((short) 1);
    assertNextAttemptIn(contents[0], Duration.ofHours(1));
    assertThat(contentState(contents[1]).value1()).isEqualTo("업무");
    assertThat(contentState(contents[1]).value2()).isNotNull();
    assertThat(contentState(contents[2]).value1()).isEqualTo("업무");
    assertNoRetryRecorded(contents[1]);
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

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    verify(mailClient, times(1)).classifyBatch(any());
    assertThat(contentState(c).value2()).isNull();
    assertNoRetryRecorded(c);
  }

  /**
   * WP-1347: 다음 시도 시각이 미래면 고르지 않고, 지나면 다시 고른다. 실패가 1h·6h·24h 간격으로 미뤄지고 4번째 실패에서 시도 시각을 남겨 더 고르지
   * 않는다.
   */
  @Test
  void poisonMail_isPickedAgainAfterNextAttempt_andFinalAfterFourth() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    long env = MailAnalysisFixtures.envelope(dsl, a, c, "b@corp.com", a.address(), null);
    when(mailClient.classifyBatch(any()))
        .thenThrow(new MailAiException("502", new RuntimeException("bad gateway")));

    // 1번째 실패 → 1h 뒤. 다음 시각이 미래라 후보에 없다
    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);
    assertThat(retryState(c).value1()).isEqualTo((short) 1);
    assertNextAttemptIn(c, Duration.ofHours(1));
    assertThat(messageRepo.listUncategorizedIds(a.accountId(), 10)).doesNotContain(env);

    // 시각을 과거로 당기면 다시 후보
    pullNextAttemptIntoPast(c);
    assertThat(messageRepo.listUncategorizedIds(a.accountId(), 10)).contains(env);

    // 2번째 실패 → 6h 뒤
    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);
    assertThat(retryState(c).value1()).isEqualTo((short) 2);
    assertNextAttemptIn(c, Duration.ofHours(6));

    // 3번째 실패 → 24h 뒤
    pullNextAttemptIntoPast(c);
    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);
    assertThat(retryState(c).value1()).isEqualTo((short) 3);
    assertNextAttemptIn(c, Duration.ofHours(24));
    assertThat(contentState(c).value2()).isNull();

    // 4번째 실패 → 최종: 시도 시각을 남기고 더 고르지 않는다
    pullNextAttemptIntoPast(c);
    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);
    assertThat(retryState(c).value1()).isEqualTo((short) 4);
    assertThat(contentState(c).value2()).isNotNull();
    assertThat(messageRepo.listUncategorizedIds(a.accountId(), 10)).doesNotContain(env);

    verify(mailClient, times(4)).classifyBatch(any());
  }

  /**
   * WP-1347: 묶음 응답이 성공이어도 한 메일이 빠졌거나 분류가 null·5종 밖이면 그 메일만 시도 1회로 세고 재시도로 미룬다. 나머지는 저장·시도 시각 기록.
   */
  @Test
  void emptyResult_countsAsAttempt() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long[] contents = new long[4];
    long[] envs = new long[4];
    for (int i = 0; i < 4; i++) {
      contents[i] =
          MailAnalysisFixtures.content(
              dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
      envs[i] = MailAnalysisFixtures.envelope(dsl, a, contents[i], "b@corp.com", a.address(), null);
      MailAnalysisFixtures.receivedDaysAgo(dsl, envs[i], i);
    }
    // envs[0] 정상, envs[1] null, envs[2] 5종 밖, envs[3] 응답에서 빠짐
    when(mailClient.classifyBatch(any()))
        .thenReturn(
            new ClassifyBatchResult(
                List.of(
                    new ClassifyBatchEntry(envs[0], "업무"),
                    new ClassifyBatchEntry(envs[1], null),
                    new ClassifyBatchEntry(envs[2], "기타없음"))));

    service.classifyAccountNow(
        a.userId(), a.accountId(), new AgentOutageGuard(), MailCategoryBackfillService.MAX_BATCHES);

    verify(mailClient, times(1)).classifyBatch(any());
    assertThat(contentState(contents[0]).value1()).isEqualTo("업무");
    assertThat(contentState(contents[0]).value2()).isNotNull();
    assertNoRetryRecorded(contents[0]);
    for (int i = 1; i < 4; i++) {
      assertThat(contentState(contents[i]).value1()).isNull();
      assertThat(contentState(contents[i]).value2()).isNull();
      assertThat(retryState(contents[i]).value1()).isEqualTo((short) 1);
      assertNextAttemptIn(contents[i], Duration.ofHours(1));
    }
  }

  /** WP-1363: 동시에 분류가 성공해 ai_category 가 찬 content 는 실패 기록이 건드리지 않는다. */
  @Test
  void recordCategoryFailure_skipsAlreadyCategorized() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    long env = MailAnalysisFixtures.envelope(dsl, a, c, "b@corp.com", a.address(), null);
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY, "업무")
        .where(EMAIL_CONTENT.ID.eq(c))
        .execute();

    int changed =
        messageRepo.recordCategoryFailure(
            env, List.of(Duration.ofHours(1), Duration.ofHours(6), Duration.ofHours(24)));

    assertThat(changed).isZero();
    assertNoRetryRecorded(c);
    assertThat(contentState(c).value2()).isNull();
  }

  /**
   * WP-1347: 묶음 실패 → 1통씩 단계에서 첫 메일은 502(독 기록), 둘째 메일에서 ai-agent 불가면 회차를 멈춘다 — 앞서 남긴 독 기록은 유지하고 둘째는
   * 아무것도 기록하지 않는다.
   */
  @Test
  void unavailableMidSingleItems_keepsEarlierPoisonRecord() {
    Box a = MailAnalysisFixtures.mailbox(dsl, false);
    long[] contents = new long[2];
    long[] envs = new long[2];
    for (int i = 0; i < 2; i++) {
      contents[i] =
          MailAnalysisFixtures.content(
              dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
      envs[i] = MailAnalysisFixtures.envelope(dsl, a, contents[i], "b@corp.com", a.address(), null);
      MailAnalysisFixtures.receivedDaysAgo(dsl, envs[i], i); // i=0 이 최신 → 단건 단계에서 먼저 부른다
    }
    long first = envs[0];
    when(mailClient.classifyBatch(any()))
        .thenAnswer(
            inv -> {
              ClassifyBatchRequest req = inv.getArgument(0);
              if (req.items().size() > 1 || req.items().get(0).id() == first) {
                throw new MailAiException("502", new RuntimeException("bad gateway"));
              }
              throw new MailAiUnavailableException("down");
            });
    AgentOutageGuard guard = new AgentOutageGuard();

    int used =
        service.classifyAccountNow(
            a.userId(), a.accountId(), guard, MailCategoryBackfillService.MAX_BATCHES);

    // 묶음 1 + 첫 단건 1 + 둘째 단건 1 = 3 호출, 그 뒤 멈춤(멈추지 않으면 둘째를 다시 불러 예산 4 를 다 쓴다)
    assertThat(used).isEqualTo(3);
    assertThat(retryState(contents[0]).value1()).isEqualTo((short) 1);
    assertNextAttemptIn(contents[0], Duration.ofHours(1));
    assertThat(contentState(contents[0]).value2()).isNull();
    assertNoRetryRecorded(contents[1]);
    assertThat(contentState(contents[1]).value2()).isNull();
  }
}

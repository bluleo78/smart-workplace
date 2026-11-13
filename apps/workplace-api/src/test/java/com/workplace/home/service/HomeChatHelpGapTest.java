package com.workplace.home.service;

import static com.workplace.jooq.Tables.HELP_METRIC_DAILY;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.help.service.HelpGapRecorder;
import com.workplace.home.dto.AiScreenContext;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.AiAgentSuggestionClient;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import org.jooq.Record;
import org.jooq.Result;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 홈 채팅 답변 끝의 매뉴얼 공백 표식을 서버가 지표로 남기는지 검증(WP-1512). 비-@Transactional — 펌프 스레드가 커밋해야 한다. */
class HomeChatHelpGapTest extends ExternalClientMockedTestBase {

  @Autowired HomeChatService composeService;
  @Autowired AiAgentChatClient chatClient;
  @Autowired AssistantResolver assistantResolver;

  /** 후속 질문 호출을 막는다(연결 거부 WARN 방지). */
  @Autowired AiAgentSuggestionClient suggestionClient;

  @Autowired HelpGapRecorder recorder;

  private final List<Long> createdUserIds = new ArrayList<>();
  private Executor prev;

  /** 기록 실행기를 호출 스레드로 바꾸고 테넌트를 세운다 — 펌프 스레드 안에서 동기로 기록되게. */
  @BeforeEach
  void setUp() {
    prev = recorder.useExecutorForTest(Runnable::run);
    TenantContext.set(1L);
  }

  /** 실행기 복원, 지표 행·사용자 정리. */
  @AfterEach
  void tearDown() {
    recorder.useExecutorForTest(prev);
    cleanupInTenant(1L, () -> baseDsl.deleteFrom(HELP_METRIC_DAILY).execute());
    if (!createdUserIds.isEmpty()) {
      baseDsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
      createdUserIds.clear();
    }
    TenantContext.clear();
  }

  private long user(String n) {
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, n)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, n)
            .set(USER.EMAIL, n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  private static AiScreenContext ctx() {
    return new AiScreenContext(
        "설정",
        null,
        null,
        new AiScreenContext.Help(
            new AiScreenContext.Section("agent.run.repo", List.of("에이전트"), "본문"),
            null,
            null,
            null,
            null));
  }

  /** 질문을 보내고 done 이 처리될 때까지 기다린다. */
  private void chat(long uid, String question, String answer, AiScreenContext screen)
      throws Exception {
    chat(uid, question, answer, screen, () -> {});
  }

  /**
   * 질문을 보내고 done 이 처리될 때까지 기다린다. beforeDone 은 펌프 스레드에서 done 콜백 직전에 돈다(답 저장 실패 같은 상황을 만든다). 기록 실행기가
   * 호출 스레드라 done 콜백이 돌아온 시점에 기록도 끝나 있다 — 래치가 순서를 보장하므로 따로 기다리지 않는다.
   */
  private void chat(
      long uid, String question, String answer, AiScreenContext screen, Runnable beforeDone)
      throws Exception {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
    CountDownLatch done = new CountDownLatch(1);
    doAnswer(
            inv -> {
              AiAgentChatClient.DoneHandler onDone = inv.getArgument(2);
              beforeDone.run();
              onDone.accept(answer, null, null);
              done.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());
    composeService.startChat(uid, null, question, screen, List.of(), null, null, null);
    assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
  }

  private Result<Record> rows() {
    return rowsIn(1L);
  }

  /** 지정 워크스페이스에서 보이는 지표 행(RLS 적용). */
  private Result<Record> rowsIn(long tenantId) {
    return callInTenant(tenantId, () -> baseDsl.select().from(HELP_METRIC_DAILY).fetch());
  }

  @Test
  void gapAnswerIsRecordedWithMaskedQuestionAndSection() throws Exception {
    long uid = user("gap" + System.nanoTime());
    chat(
        uid,
        "토큰 sk-ant-api03-AbCdEf1234567890 넣는 법",
        "매뉴얼에서 찾지 못했습니다.\n\n[매뉴얼 보강](manual-gap:)",
        ctx());
    Result<Record> r = rows();
    assertThat(r).hasSize(1);
    assertThat(r.get(0).get(HELP_METRIC_DAILY.KIND)).isEqualTo("AI_GAP");
    assertThat(r.get(0).get(HELP_METRIC_DAILY.TERM)).isEqualTo("토큰 [가림] 넣는 법");
    assertThat(r.get(0).get(HELP_METRIC_DAILY.HELP_ID)).isEqualTo("agent.run.repo");
    assertThat(r.get(0).get(HELP_METRIC_DAILY.ROUTE)).isEmpty();
    assertThat(r.get(0).get(HELP_METRIC_DAILY.COUNT)).isEqualTo(1L);
  }

  @Test
  void ordinaryAnswerRecordsNothing() throws Exception {
    long uid = user("ord" + System.nanoTime());
    chat(uid, "질문", "처리했어요", ctx());
    assertThat(rows()).isEmpty();
  }

  @Test
  void gapWithoutHelpContextHasEmptyHelpId() throws Exception {
    long uid = user("nohelp" + System.nanoTime());
    chat(uid, "질문", "못 찾았어요\n\n[매뉴얼 보강](manual-gap:)", null);
    Result<Record> r = rows();
    assertThat(r).hasSize(1);
    assertThat(r.get(0).get(HELP_METRIC_DAILY.HELP_ID)).isEmpty();
  }

  /** 답이 저장되지 않았으면(대화가 생성 중 지워져 messageId 가 null) 공백 표식이 있어도 기록하지 않는다 — 「답을 저장한 뒤」 기록. */
  @Test
  void unsavedAnswerRecordsNothing() throws Exception {
    long uid = user("unsaved" + System.nanoTime());
    chat(
        uid,
        "질문",
        "못 찾았어요\n\n[매뉴얼 보강](manual-gap:)",
        ctx(),
        () ->
            cleanupInTenant(
                1L,
                () ->
                    baseDsl
                        .deleteFrom(HOME_SESSION)
                        .where(HOME_SESSION.USER_ID.eq(uid))
                        .execute()));
    assertThat(rows()).isEmpty();
  }

  /**
   * 실제 기록 실행기(별도 스레드)로 넘겨도 부른 스레드의 테넌트로 기록된다 — 실행기 스레드에는 TenantContext 가 없어 기록기가 잡아 넘기는 것을 확인한다.
   * 테넌트 1 은 커넥션 GUC 기본값이라 넘기기가 빠져도 우연히 맞으므로, 두 번째 워크스페이스에서 기록하고 테넌트 1 에는 보이지 않는지 본다.
   */
  @Test
  void realExecutorRecordsInCallerTenantOnly() {
    recorder.useExecutorForTest(prev); // 스프링이 만든 helpMetricExecutor 로 되돌린다
    long tenant2 = TestFixtures.createTenant(baseDsl, "ACTIVE");
    try {
      TenantContext.set(tenant2);
      recorder.recordIfGap("비동기 질문", "못 찾았어요\n\n[매뉴얼 보강](manual-gap:)", "agent.run.repo");
      TenantContext.set(1L);
      await()
          .atMost(Duration.ofSeconds(10))
          .untilAsserted(
              () ->
                  assertThat(rowsIn(tenant2))
                      .singleElement()
                      .satisfies(
                          r -> assertThat(r.get(HELP_METRIC_DAILY.TERM)).isEqualTo("비동기 질문")));
      assertThat(rows()).isEmpty();
    } finally {
      TenantContext.set(1L);
      cleanupInTenant(tenant2, () -> baseDsl.deleteFrom(HELP_METRIC_DAILY).execute());
      // 다른 시험이 이 워크스페이스를 활성 테넌트로 집지 않게 정지시킨다(AiMemoryExpiryCleanupTest 와 같은 정리).
      baseDsl.update(TENANT).set(TENANT.STATUS, "SUSPENDED").where(TENANT.ID.eq(tenant2)).execute();
    }
  }
}

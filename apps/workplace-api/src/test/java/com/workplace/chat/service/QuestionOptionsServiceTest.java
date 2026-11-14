package com.workplace.chat.service;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.outbound.AiAgentSuggestionClient;
import com.workplace.home.outbound.ChatMessages.SuggestionRequest;
import com.workplace.support.AsyncPools;
import com.workplace.support.ExternalClientMockedTestBase;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * WP-1569 질문 답 선택지 보완 추출 — options 없이 올라온 AI 질문 글이 커밋되면 실행기에서 ai-agent(mode=answer)로 뽑아 저장하고
 * chat.message.options 를 스레드 멤버에게 보내는지, 빈 결과·실패·비서 없음·이미 선택지 있음·지워지거나 고쳐진 글이면 아무것도 하지 않는지 본다. 커밋
 * 뒤(AFTER_COMMIT) 흐름을 그대로 타야 하므로 @Transactional 을 쓰지 않고 시드를 커밋한 뒤 정리한다.
 */
class QuestionOptionsServiceTest extends ExternalClientMockedTestBase {

  private static final long TENANT = 1L;
  private static final String QUESTION = "A안과 B안 중 무엇으로 할까요? 추천은 A안입니다.";

  @Autowired ChatFixtures fx;
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;
  @Autowired QuestionOptionsService optionsService;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AiAgentSuggestionClient suggestionClient;
  @Autowired AssistantResolver assistantResolver;
  @Autowired SseRegistry sseRegistry;

  @Autowired
  @Qualifier("questionOptionsExecutor")
  ThreadPoolTaskExecutor suggestionExecutor;

  private final List<Map.Entry<String, Map<String, Object>>> events = new CopyOnWriteArrayList<>();
  private final List<Collection<Long>> recipients = new CopyOnWriteArrayList<>();
  private static final AssistantSpec SPEC =
      new AssistantSpec(77L, "claude-sonnet-5-5", "NORMAL", 8, 60000, "claude-haiku-5-5");

  private ChatFixtures.AgentSetup s;
  private long threadId;

  @BeforeEach
  void setUp() {
    doAnswer(
            inv -> {
              @SuppressWarnings("unchecked")
              Map<String, Object> p = (Map<String, Object>) inv.getArgument(2);
              String name = inv.getArgument(1);
              events.add(Map.entry(name, p));
              if ("chat.message.options".equals(name)) recipients.add(inv.getArgument(0));
              return null;
            })
        .when(sseRegistry)
        .fanOut(any(), any(), any());
    s = fx.setupWithAgent();
    threadId =
        callInTenant(
            TENANT,
            () ->
                threadService
                    .getOrCreate(
                        s.base().reporterId(), s.base().projectKey(), s.base().issueNumber())
                    .threadId());
  }

  @AfterEach
  void cleanup() {
    AsyncPools.awaitIdle(suggestionExecutor);
    fx.cleanupAll();
  }

  @Test
  void 선택지_없는_질문은_커밋_뒤_뽑은_선택지를_저장하고_스레드_멤버에게_알린다() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    when(suggestionClient.suggest(any())).thenReturn(List.of(" A안 ", "B안", "A안"));

    long id = postQuestion(null);
    AsyncPools.awaitIdle(suggestionExecutor);

    assertThat(storedOptions(id)).containsExactly("A안", "B안");
    ArgumentCaptor<SuggestionRequest> req = ArgumentCaptor.forClass(SuggestionRequest.class);
    verify(suggestionClient).suggest(req.capture());
    assertThat(req.getValue().mode()).isEqualTo("answer");
    assertThat(req.getValue().question()).isEqualTo(QUESTION);
    assertThat(req.getValue().agentId()).isEqualTo(77L);
    assertThat(req.getValue().model()).isEqualTo("claude-haiku-5-5");
    assertThat(req.getValue().count()).isEqualTo(4);
    // 이벤트는 그 메시지의 선택지만 싣고, 수신자는 스레드 멤버(질문한 AI 포함)다.
    assertThat(payloads("chat.message.options"))
        .containsExactly(
            Map.of("threadId", threadId, "messageId", id, "options", List.of("A안", "B안")));
    assertThat(recipients.get(0)).contains(s.agentId(), s.base().reporterId());
  }

  @Test
  void 개인_프로젝트는_소유자의_비서로_뽑는다() {
    callInTenant(
        TENANT,
        () ->
            dsl.update(PROJECT)
                .set(PROJECT.TYPE, "PERSONAL")
                .where(PROJECT.ID.eq(s.base().projectId()))
                .execute());
    when(assistantResolver.resolveOrEmpty(s.base().reporterId())).thenReturn(Optional.of(SPEC));
    when(suggestionClient.suggest(any())).thenReturn(List.of("예", "아니오"));

    long id = postQuestion(null);
    AsyncPools.awaitIdle(suggestionExecutor);

    assertThat(storedOptions(id)).containsExactly("예", "아니오");
    verify(assistantResolver, never()).resolveWorkspaceOrEmpty();
  }

  @Test
  void 보고와_함께_선택지가_오면_추출하지_않고_그_선택지를_생성_이벤트에_싣는다() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));

    long id = postQuestion(List.of("A안", "B안", "C안"));
    AsyncPools.awaitIdle(suggestionExecutor);

    verify(suggestionClient, never()).suggest(any());
    assertThat(storedOptions(id)).containsExactly("A안", "B안", "C안");
    assertThat(payloads("chat.message.created"))
        .singleElement()
        .satisfies(p -> assertThat(p).containsEntry("options", List.of("A안", "B안", "C안")));
    assertThat(payloads("chat.message.options")).isEmpty();
  }

  @Test
  void 뽑은_선택지가_2개_미만이면_저장하지_않는다() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    when(suggestionClient.suggest(any())).thenReturn(List.of("A안", "x".repeat(41)));

    long id = postQuestion(null);
    AsyncPools.awaitIdle(suggestionExecutor);

    assertThat(storedOptions(id)).isNull();
    assertThat(payloads("chat.message.options")).isEmpty();
  }

  @Test
  void 추출이_실패해도_아무것도_하지_않는다() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    when(suggestionClient.suggest(any())).thenThrow(new IllegalStateException("boom"));

    long id = postQuestion(null);
    AsyncPools.awaitIdle(suggestionExecutor);

    assertThat(storedOptions(id)).isNull();
    assertThat(payloads("chat.message.options")).isEmpty();
  }

  @Test
  void 연결된_비서가_없으면_ai_agent_를_부르지_않는다() {
    // 목 기본값 — resolveWorkspaceOrEmpty 는 빈 Optional.
    long id = postQuestion(null);
    AsyncPools.awaitIdle(suggestionExecutor);

    verify(suggestionClient, never()).suggest(any());
    assertThat(storedOptions(id)).isNull();
  }

  @Test
  void 질문이_아닌_진행_글은_추출하지_않는다() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));

    callInTenant(
        TENANT,
        () ->
            messageService.createFromReport(s.agentId(), threadId, "진행 중", false, List.of(), null));
    AsyncPools.awaitIdle(suggestionExecutor);

    verify(suggestionClient, never()).suggest(any());
  }

  @Test
  void 추출하는_동안_지워지거나_고쳐진_글과_이미_선택지가_있는_글은_덮지_않는다() {
    // 생성 때는 비서가 없어 백그라운드 추출이 아무것도 하지 않는다 — 아래에서 extract 를 직접 부른다.
    long deleted = postQuestion(null);
    long edited = postQuestion(null);
    long filled = postQuestion(List.of("가", "나"));
    AsyncPools.awaitIdle(suggestionExecutor);
    callInTenant(
        TENANT,
        () -> {
          dsl.update(CHAT_MESSAGE)
              .set(CHAT_MESSAGE.DELETED_AT, OffsetDateTime.now())
              .where(CHAT_MESSAGE.ID.eq(deleted))
              .execute();
          return dsl.update(CHAT_MESSAGE)
              .set(CHAT_MESSAGE.EDITED_AT, OffsetDateTime.now())
              .where(CHAT_MESSAGE.ID.eq(edited))
              .execute();
        });
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    when(suggestionClient.suggest(any())).thenReturn(List.of("A안", "B안"));

    inTenant(
        () -> {
          optionsService.extract(threadId, deleted, s.base().projectKey(), QUESTION);
          optionsService.extract(threadId, edited, s.base().projectKey(), QUESTION);
          optionsService.extract(threadId, filled, s.base().projectKey(), QUESTION);
        });

    assertThat(storedOptions(deleted)).isNull();
    assertThat(storedOptions(edited)).isNull();
    assertThat(storedOptions(filled)).containsExactly("가", "나");
    assertThat(payloads("chat.message.options")).isEmpty();
  }

  @Test
  void 질문_글의_멘션_토큰은_이름으로_바꿔_보낸다() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    when(suggestionClient.suggest(any())).thenReturn(List.of("A안", "B안"));
    long reporter = s.base().reporterId();
    String name =
        callInTenant(
            TENANT,
            () -> dsl.select(USER.NAME).from(USER).where(USER.ID.eq(reporter)).fetchOne(USER.NAME));

    postQuestion("<@" + reporter + "> 님, A안과 B안 중 무엇으로 할까요?", null);
    AsyncPools.awaitIdle(suggestionExecutor);

    ArgumentCaptor<SuggestionRequest> req = ArgumentCaptor.forClass(SuggestionRequest.class);
    verify(suggestionClient).suggest(req.capture());
    assertThat(req.getValue().question())
        .isEqualTo("@" + name + " 님, A안과 B안 중 무엇으로 할까요?")
        .doesNotContain("<@");
  }

  @Test
  void 멘션_목록에_없는_토큰은_사용자로_바꾼다() {
    assertThat(
            QuestionOptionsService.questionText(
                "<@1> 와 <@999> 중 누가 볼까요?", List.of(new UserSummary(1L, "kim", "김철수", "HUMAN"))))
        .isEqualTo("@김철수 와 @사용자 중 누가 볼까요?");
  }

  @Test
  void 질문_글을_고치면_답_선택지를_지우고_null_로_알린다() {
    long id = postQuestion(List.of("A안", "B안"));
    events.clear();

    ChatMessageResponse saved =
        callInTenant(
            TENANT,
            () ->
                messageService.update(
                    s.agentId(), id, new UpdateChatMessageRequest("C안과 D안 중에서는요?")));

    assertThat(saved.options()).isNull();
    assertThat(storedOptions(id)).isNull();
    Map<String, Object> expected = new HashMap<>();
    expected.put("threadId", threadId);
    expected.put("messageId", id);
    expected.put("options", null);
    assertThat(payloads("chat.message.options")).containsExactly(expected);
    // 다시 뽑지 않는다.
    AsyncPools.awaitIdle(suggestionExecutor);
    verify(suggestionClient, never()).suggest(any());
  }

  @Test
  void 선택지_없는_글을_고치면_선택지_이벤트를_보내지_않는다() {
    long id = postQuestion(null);
    AsyncPools.awaitIdle(suggestionExecutor);
    events.clear();

    callInTenant(
        TENANT,
        () -> messageService.update(s.agentId(), id, new UpdateChatMessageRequest("고친 질문")));

    assertThat(payloads("chat.message.updated")).hasSize(1);
    assertThat(payloads("chat.message.options")).isEmpty();
  }

  /** AI 구성원 이름으로 질문 글을 커밋한다 — 커밋 뒤 보완 추출 리스너가 돈다. */
  private long postQuestion(List<String> options) {
    return postQuestion(QUESTION, options);
  }

  private long postQuestion(String body, List<String> options) {
    return callInTenant(
        TENANT,
        () ->
            messageService
                .createFromReport(s.agentId(), threadId, body, true, List.of(), options)
                .id());
  }

  /** 테넌트 문맥만 세우고(트랜잭션 없음) 실행 — 실행기 스레드처럼 extract 가 스스로 트랜잭션을 연다. */
  private void inTenant(Runnable body) {
    Long prev = TenantContext.get();
    TenantContext.set(TENANT);
    try {
      body.run();
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 저장된 options — NULL 이면 null. */
  private List<String> storedOptions(long messageId) {
    JSONB raw =
        callInTenant(
            TENANT,
            () ->
                dsl.select(CHAT_MESSAGE.OPTIONS)
                    .from(CHAT_MESSAGE)
                    .where(CHAT_MESSAGE.ID.eq(messageId))
                    .fetchOne(CHAT_MESSAGE.OPTIONS));
    if (raw == null) return null;
    try {
      return om.readerForListOf(String.class).readValue(raw.data());
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private List<Map<String, Object>> payloads(String event) {
    return events.stream().filter(e -> e.getKey().equals(event)).map(Map.Entry::getValue).toList();
  }
}

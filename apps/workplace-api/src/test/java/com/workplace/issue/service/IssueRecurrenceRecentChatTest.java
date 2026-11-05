package com.workplace.issue.service;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent.ChatLine;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.stream.IntStream;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 반복 회차 이벤트의 이슈 챗 맥락(WP-1375) 통합 테스트 — 최근 사람 글(맡긴 사람·새 글 표시·HUMAN 만·삭제 제외·상한 20건/1000자/합계 6000자)과
 * 담당 AI 의 마지막 글(1500자)을 정기 회차·이어 처리·테스트 실행 이벤트에 싣는지, 반복 업무 이슈의 이슈 챗 이벤트에 반복 요약을 싣는지 본다.
 *
 * <p>테스트 트랜잭션 안에서는 DB 의 NOW() 가 트랜잭션 시작 시각으로 고정돼 글 순서가 갈리지 않는다 — 글은 created_at 을 명시해 직접 넣고,
 * lastRunAt 도 명시 시각으로 둔다. 페이로드 키 유무(recentChat·lastResult·recurrence)는 dispatcher 단위 테스트가 본다.
 */
@Transactional
@RecordApplicationEvents
class IssueRecurrenceRecentChatTest extends IntegrationTestBase {

  private static final String INTERNAL_TOKEN = "test-token";

  /**
   * 글 시각의 기준 — 지금보다 한참 전이라 회차 시각(지금)보다 늘 앞선다. DB(timestamptz)는 마이크로초까지만 저장하므로, 나노초 시계(리눅스)에서 잘리지 않은
   * 값과 왕복 후 값을 isEqualTo 로 비교하면 깨진다 — 마이크로초로 잘라 둔다(WP-1381).
   */
  private static final Instant BASE =
      Instant.now().truncatedTo(ChronoUnit.MICROS).minus(2, ChronoUnit.DAYS);

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired IssueService issueService;
  @Autowired IssueAssigneeRepository assigneeRepository;
  @Autowired PersonalAssistantRepository personalAssistantRepository;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired IssueRecurrenceService recurrenceService;
  @Autowired ChatThreadRepository chatThreadRepository;
  @Autowired ApplicationEvents events;

  private long owner;
  private long agent;
  private long otherAgent;
  private String key;
  private long issueId;
  private int number;
  private long threadId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, owner, "USER");
    agent = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    otherAgent = withMembership(TestFixtures.createAgentNoToken(dsl));
    personalAssistantRepository.setAgentId(owner, agent);
    var project =
        projectService.create(owner, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    key = project.key();
    projectMemberRepository.insert(project.id(), agent, "MEMBER");
    var issue =
        issueService.create(
            owner,
            key,
            new CreateIssueRequest("매일 정리", "오늘 할 일을 정리해 줘", null, null, null, null, null, null));
    issueId = issue.id();
    number = issue.number();
    assigneeRepository.add(issueId, agent, owner);
    threadId = chatThreadRepository.insertIfAbsent(issueId);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────────── 정기 회차 ─────────────────────────────

  @Test
  void 반복_회차_이벤트에_최근_사람_글과_새_글_표시가_실린다() throws Exception {
    save();
    Instant lastRun = BASE.plus(1, ChronoUnit.HOURS);
    // 지난 회차 전 글도 싣는다 — 계속 지킬 결정이 지난 회차 전에 남았을 수 있다. 새 글이 아닐 뿐이다.
    message(owner, "지난 회차 전 글", BASE);
    message(owner, "메일은 보내지 마", lastRun.plusSeconds(60));
    // 다른 AI(이슈챗 AI 등)의 글은 사람 글이 아니다.
    message(otherAgent, "이슈챗 AI 의 답", lastRun.plusSeconds(120));
    long deleted = message(owner, "지운 글", lastRun.plusSeconds(150));
    dsl.update(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.DELETED_AT, OffsetDateTime.now())
        .where(CHAT_MESSAGE.ID.eq(deleted))
        .execute();
    message(owner, "보고서는 표로", lastRun.plusSeconds(180));
    setLastRunAt(lastRun);

    var e = runDue();

    assertThat(e.recentChat()).isNotNull();
    assertThat(e.recentChat().humanMessages())
        .extracting(ChatLine::body, ChatLine::isNew)
        .containsExactly(
            tuple("지난 회차 전 글", false), tuple("메일은 보내지 마", true), tuple("보고서는 표로", true));
    var second = e.recentChat().humanMessages().get(1);
    assertThat(second.authorName()).isEqualTo(userName(owner));
    assertThat(second.createdAt()).isEqualTo(lastRun.plusSeconds(60));
    // 담당 AI 글이 없으면 담당 AI 의 마지막 글도 없다.
    assertThat(e.recentChat().lastResult()).isNull();
    // 새 글 기준은 이번 실행 전 값 — 이번 회차는 lastRunAt 을 「지금」으로 옮긴다(그 값을 기준으로 썼다면 모두 새 글이 아니었다).
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.LAST_RUN_AT).toInstant()).isAfter(lastRun);
  }

  @Test
  void 반복을_맡긴_사람의_글만_owner_다() throws Exception {
    save();
    // 같은 프로젝트의 다른 사람 — 이슈챗에 글을 쓸 수 있지만 반복을 맡긴 사람(저장한 사람)이 아니다.
    long colleague = withMembership(TestFixtures.createHuman(dsl));
    message(owner, "메일은 보내지 마", BASE);
    message(colleague, "아니 메일 보내", BASE.plusSeconds(1));

    var human = runDue().recentChat().humanMessages();

    assertThat(human)
        .extracting(ChatLine::body, ChatLine::owner)
        .containsExactly(tuple("메일은 보내지 마", true), tuple("아니 메일 보내", false));
    assertThat(human.get(1).authorName()).isEqualTo(userName(colleague));
  }

  @Test
  void 첫_회차는_최근_사람_글_20건까지() throws Exception {
    save();
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.LAST_RUN_AT)).isNull();
    IntStream.rangeClosed(1, 25).forEach(i -> message(owner, "글 " + i, BASE.plusSeconds(i)));

    var human = runDue().recentChat().humanMessages();

    // 가장 최근 20건(6~25)을 오래된 순으로.
    assertThat(human)
        .extracting(ChatLine::body)
        .containsExactlyElementsOf(IntStream.rangeClosed(6, 25).mapToObj(i -> "글 " + i).toList());
    // 지난 회차가 없으면(lastRunAt null) 모두 새 글이다.
    assertThat(human).allMatch(ChatLine::isNew);
  }

  @Test
  void 글이_1000자를_넘으면_자른다() throws Exception {
    save();
    String longBody = "가".repeat(999) + "나".repeat(500);
    message(owner, longBody, BASE);
    message(owner, "다".repeat(1000), BASE.plusSeconds(1));

    var human = runDue().recentChat().humanMessages();

    // 「…」까지 1000자 — ai-agent 가 같은 상한(UTF-16 length)을 다시 적용해도 그대로다.
    assertThat(human.get(0).body()).hasSize(1000).isEqualTo("가".repeat(999) + "…");
    // 딱 1000자는 자르지 않는다.
    assertThat(human.get(1).body()).isEqualTo("다".repeat(1000));
  }

  @Test
  void 합계_6000자를_넘으면_오래된_것부터_버린다() throws Exception {
    save();
    // 1000자 글 8건(합계 8000자) — 최근 6건(합계 6000자)만 남는다.
    IntStream.rangeClosed(1, 8)
        .forEach(i -> message(owner, (char) ('0' + i) + "x".repeat(999), BASE.plusSeconds(i)));

    var human = runDue().recentChat().humanMessages();

    assertThat(human)
        .extracting(l -> l.body().charAt(0))
        .containsExactly('3', '4', '5', '6', '7', '8');
    assertThat(human.stream().mapToInt(l -> l.body().length()).sum()).isEqualTo(6000);
  }

  @Test
  void 직전_회차_결과는_담당_AI_의_마지막_글_1500자() throws Exception {
    save();
    message(agent, "그제 결과", BASE);
    message(agent, "어제 결과 " + "라".repeat(2000), BASE.plusSeconds(60));
    // 담당 AI 가 아닌 AI 의 더 늦은 글은 직전 결과가 아니다.
    message(otherAgent, "다른 AI 글", BASE.plusSeconds(120));
    // 지운 담당 AI 글도 아니다.
    long deleted = message(agent, "지운 결과", BASE.plusSeconds(180));
    dsl.update(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.DELETED_AT, OffsetDateTime.now())
        .where(CHAT_MESSAGE.ID.eq(deleted))
        .execute();

    var chat = runDue().recentChat();

    assertThat(chat).isNotNull();
    // 사람 글이 없어도 직전 결과만으로 싣는다(사람 글은 빈 목록).
    assertThat(chat.humanMessages()).isEmpty();
    assertThat(chat.lastResult().body()).hasSize(1500).startsWith("어제 결과 ").endsWith("라…");
    assertThat(chat.lastResult().createdAt()).isEqualTo(BASE.plusSeconds(60));
  }

  @Test
  void 사람_글도_직전_결과도_없으면_recentChat_키가_없다() throws Exception {
    save();
    // AI 가 아닌 다른 AI 글만 — 사람 글도 담당 AI 글도 아니다.
    message(otherAgent, "다른 AI 글", BASE);

    assertThat(runDue().recentChat()).isNull();
  }

  @Test
  void 첨부만_있는_글_본문_null_은_빠지고_회차가_실패하지_않는다() throws Exception {
    save();
    // 첨부만 있는 글은 본문이 NULL 로 저장된다(V82) — 사람 글·직전 결과 모두에서 빠지고 회차는 그대로 나간다.
    message(owner, "표로 정리해 줘", BASE);
    message(owner, null, BASE.plusSeconds(1));
    message(agent, "어제 결과", BASE.plusSeconds(2));
    message(agent, null, BASE.plusSeconds(3));

    var chat = runDue().recentChat();

    assertThat(chat.humanMessages()).extracting(ChatLine::body).containsExactly("표로 정리해 줘");
    assertThat(chat.lastResult().body()).isEqualTo("어제 결과");
  }

  @Test
  void 빈_본문_글은_20건에_세지_않는다() throws Exception {
    save();
    // 본문 있는 글 20건 사이사이에 빈 본문(화면의 첨부만 글 '')·공백뿐인 글이 끼어도 20건이 모두 실린다.
    IntStream.rangeClosed(1, 20)
        .forEach(
            i -> {
              message(owner, "글 " + i, BASE.plusSeconds(i * 10L));
              message(owner, i % 2 == 0 ? "" : "  \n ", BASE.plusSeconds(i * 10L + 1));
            });
    message(agent, " ", BASE.plusSeconds(500));

    var chat = runDue().recentChat();

    assertThat(chat.humanMessages())
        .extracting(ChatLine::body)
        .containsExactlyElementsOf(IntStream.rangeClosed(1, 20).mapToObj(i -> "글 " + i).toList());
    // 담당 AI 의 유일한 글이 공백뿐이면 직전 결과는 없다.
    assertThat(chat.lastResult()).isNull();
  }

  // ───────────────────────────── 이어 처리·테스트 실행 ─────────────────────────────

  @Test
  void 이어_처리와_테스트_실행_이벤트도_recentChat_을_싣는다() throws Exception {
    save();
    // 테스트 실행(「지금 실행」) — 정기 회차를 보낸 적이 없어(lastRunAt null) 최근 사람 글을 싣는다.
    message(owner, "표로 정리해 줘", BASE);
    recurrenceService.runNow(owner, key, number);
    var testRun =
        events.stream(IssueRecurringRunEvent.class).filter(IssueRecurringRunEvent::test).toList();
    assertThat(testRun).hasSize(1);
    assertThat(testRun.get(0).recentChat().humanMessages())
        .extracting(ChatLine::body)
        .containsExactly("표로 정리해 줘");
    // 테스트 실행 결과를 받아 대기를 비운다(그 결과 글이 담당 AI 의 마지막 글이 된다).
    report(testRun.get(0).runId(), "테스트 결과", false).andExpect(status().isNoContent());

    // 정기 회차가 질문으로 끝나고 소유자가 답한다 → 이어 처리.
    var regular = runDue();
    report(regular.runId(), "초안을 채널에 올릴까요?", true).andExpect(status().isNoContent());
    // 화면 API 로 남긴 답 글의 created_at 은 테스트 트랜잭션 시작 시각이다 — 기준(lastRunAt)을 그보다 앞으로 둔다.
    setLastRunAt(BASE.plusSeconds(30));
    chat(owner, "올려 줘");

    var followUp =
        events.stream(IssueRecurringRunEvent.class).filter(e -> e.followUp() != null).toList();
    assertThat(followUp).hasSize(1);
    var chat = followUp.get(0).recentChat();
    // 기준 이전 글(표로 정리해 줘)도 실리되 새 글이 아니고, 답 글은 새 글이다. 담당 AI 의 마지막 글은 그 AI 가 남긴 질문 글이다.
    assertThat(chat.humanMessages())
        .extracting(ChatLine::body, ChatLine::isNew, ChatLine::owner)
        .containsExactly(tuple("표로 정리해 줘", false, true), tuple("올려 줘", true, true));
    assertThat(chat.lastResult().body()).isEqualTo("초안을 채널에 올릴까요?");
  }

  // ───────────────────────────── 이슈 챗 이벤트 ─────────────────────────────

  @Test
  void 반복_업무_이슈의_이슈챗_이벤트에_recurrence_요약이_실린다() throws Exception {
    save();
    long id = chat(owner, "<@" + agent + "> 오늘 것도 해 줘?");

    var r = chatEvent(id).recurrence();
    assertThat(r).isNotNull();
    assertThat(r.rrule()).isEqualTo("FREQ=DAILY");
    assertThat(r.time()).isEqualTo("08:00");
    assertThat(r.enabled()).isTrue();
    assertThat(r.agentName()).isEqualTo(userName(agent));
    // 맡긴 사람(반복을 저장한 사람) — 이슈챗 AI 가 다른 사람의 지시를 「맡긴 사람 확인이 필요하다」고 답하게 한다.
    assertThat(r.ownerName()).isEqualTo(userName(owner));
    assertThat(r.nextRunAt())
        .isEqualTo(recurrenceRow().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant());
  }

  @Test
  void 반복_없는_이슈의_이슈챗_이벤트에는_recurrence_가_없다() throws Exception {
    long id = chat(owner, "<@" + agent + "> 오늘 것도 해 줘?");

    assertThat(chatEvent(id).recurrence()).isNull();
  }

  @Test
  void 서버가_실행하지_않는_AI_만_멘션하면_반복_요약을_읽지_않는다() throws Exception {
    save();
    // 외부(EXTERNAL) AI 는 ai-agent 로 가지 않는다 — dispatcher 가 발사하지 않으니 요약도 싣지 않는다.
    dsl.update(com.workplace.jooq.Tables.USER)
        .set(com.workplace.jooq.Tables.USER.AGENT_RUNTIME, "EXTERNAL")
        .where(com.workplace.jooq.Tables.USER.ID.eq(otherAgent))
        .execute();
    long id = chat(owner, "<@" + otherAgent + "> 오늘 것도 해 줘?");

    assertThat(chatEvent(id).recurrence()).isNull();
  }

  @Test
  void 이어_처리로_이미_깨운_AI_만_멘션한_답에는_반복_요약을_싣지_않는다() throws Exception {
    save();
    var regular = runDue();
    report(regular.runId(), "초안을 채널에 올릴까요?", true).andExpect(status().isNoContent());
    // 답이 담당 AI 를 멘션해도 이어 처리로 이미 깨웠다 — dispatcher 가 그 AI 를 빼 발사하지 않는다.
    long id = chat(owner, "<@" + agent + "> 올려 줘");

    var e = chatEvent(id);
    assertThat(e.followUpAgentId()).isEqualTo(agent);
    assertThat(e.recurrence()).isNull();
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  /** 매일 08:00 반복을 저장한다. */
  private void save() throws Exception {
    call(
            put(path())
                .content(om.writeValueAsString(Map.of("rrule", "FREQ=DAILY", "time", "08:00"))),
            owner)
        .andExpect(status().isOk());
  }

  /** 회차 시각을 지난 시각으로 당겨 한 회차를 보내고 그 이벤트를 돌려준다. */
  private IssueRecurringRunEvent runDue() {
    long sentBefore =
        events.stream(IssueRecurringRunEvent.class).filter(e -> e.round() != null).count();
    dsl.update(ISSUE_RECURRENCE)
        .set(
            ISSUE_RECURRENCE.NEXT_RUN_AT,
            Instant.now().minusSeconds(60 + sentBefore).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    var regular =
        events.stream(IssueRecurringRunEvent.class).filter(e -> e.round() != null).toList();
    return regular.get(regular.size() - 1);
  }

  /** 이 이슈 챗에 글을 직접 넣는다 — created_at 을 명시해 순서를 정한다. */
  private long message(long author, String body, Instant at) {
    return dsl.insertInto(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.THREAD_ID, threadId)
        .set(CHAT_MESSAGE.AUTHOR_ID, author)
        .set(CHAT_MESSAGE.BODY, body)
        .set(CHAT_MESSAGE.MENTIONS, JSONB.valueOf("[]"))
        .set(CHAT_MESSAGE.CREATED_AT, at.atOffset(ZoneOffset.UTC))
        .returning(CHAT_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 사람이 화면 API 로 이 이슈 챗에 글을 남기고 그 글 id 를 돌려준다. */
  private long chat(long as, String body) throws Exception {
    JsonNode r =
        om.readTree(
            call(
                    post("/api/v1/chat/threads/" + threadId + "/messages")
                        .content(om.writeValueAsString(Map.of("body", body))),
                    as)
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString());
    return r.get("id").asLong();
  }

  private ChatMessageCreatedEvent chatEvent(long messageId) {
    return events.stream(ChatMessageCreatedEvent.class)
        .filter(e -> e.messageId() == messageId)
        .findFirst()
        .orElseThrow();
  }

  private void setLastRunAt(Instant t) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.LAST_RUN_AT, t.atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  private org.jooq.Record recurrenceRow() {
    return dsl.selectFrom(ISSUE_RECURRENCE).where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)).fetchOne();
  }

  private String userName(long id) {
    return dsl.select(com.workplace.jooq.Tables.USER.NAME)
        .from(com.workplace.jooq.Tables.USER)
        .where(com.workplace.jooq.Tables.USER.ID.eq(id))
        .fetchOne(com.workplace.jooq.Tables.USER.NAME);
  }

  /** ai-agent 의 회차 결과 보고(내부 API) — 담당 AI 이름으로 결과를 남긴다. */
  private ResultActions report(String runId, String message, boolean question) throws Exception {
    var r =
        mvc.perform(
            post("/api/v1/internal/issue-recurrence/" + issueId + "/runs")
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(agent))
                .header("X-On-Behalf-Of-Tenant", "1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(
                        Map.of(
                            "runId",
                            runId,
                            "ok",
                            true,
                            "message",
                            message,
                            "question",
                            question))));
    TenantContext.set(1L);
    return r;
  }

  private String path() {
    return "/api/v1/projects/" + key + "/issues/" + number + "/recurrence";
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}

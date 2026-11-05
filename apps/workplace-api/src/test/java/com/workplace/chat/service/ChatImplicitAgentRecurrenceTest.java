package com.workplace.chat.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.AgentsResumedByChatReply;
import com.workplace.issue.outbound.ImplicitChatAgents;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.service.IssueRecurrenceService;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
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
 * 실행 일정이 걸린 작업의 이슈챗은 멘션 없이도 담당 AI 가 답한다(WP-1377) — 통합 테스트.
 *
 * <p>사람 글을 화면 API 로 저장하고, 저장 트랜잭션이 챗 생성 이벤트에 싣는 implicitAgentId(멘션 없이 답할 AI)를 확인한다. 이 이벤트를 ai-agent
 * 로 보내는 발사(chat.message.posted, actingAgentId = implicitAgentId)는 AFTER_COMMIT 비동기라 롤백되는 이 테스트에서는
 * 돌지 않는다 — ChatEventDispatcherTest 가 AiAgentEventClient 목으로 확인한다. 스레드 응답의 implicitAgent(작성창 안내)도
 * 여기서 본다.
 *
 * <p>시드: 개인 프로젝트(owner + 개인 비서 agent)와 팀 프로젝트(alice·bob + 팀 AI teamAi) 이슈를 하나씩 둔다.
 */
@Transactional
@RecordApplicationEvents
class ChatImplicitAgentRecurrenceTest extends IntegrationTestBase {

  private static final String INTERNAL_TOKEN = "test-token";

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
  @Autowired ChatMessageRepository messageRepository;
  @Autowired ChatThreadMemberRepository memberRepository;
  @Autowired ApplicationEvents events;
  // 공통 spy(IntegrationTestBase) — 판정 실패 주입에 쓴다.
  @Autowired ImplicitChatAgents implicitAgents;

  // 개인 작업
  private long owner;
  private long agent;
  private String personalKey;
  private long personalIssue;
  private int personalNumber;

  // 팀 이슈
  private long alice;
  private long bob;
  private long teamAi;
  private long teamProject;
  private String teamKey;
  private long teamIssue;
  private int teamNumber;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = human();
    agent = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    personalAssistantRepository.setAgentId(owner, agent);
    var personal =
        projectService.create(owner, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    personalKey = personal.key();
    projectMemberRepository.insert(personal.id(), agent, "MEMBER");
    var pi =
        issueService.create(
            owner,
            personalKey,
            new CreateIssueRequest("매일 정리", "오늘 할 일을 정리해 줘", null, null, null, null, null, null));
    personalIssue = pi.id();
    personalNumber = pi.number();

    alice = human();
    bob = human();
    teamAi = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, alice));
    teamKey = "IM" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    teamProject = projectService.create(alice, new CreateProjectRequest(teamKey, "팀", "x")).id();
    projectMemberRepository.insert(teamProject, bob, "MEMBER");
    projectMemberRepository.insert(teamProject, teamAi, "MEMBER");
    var ti =
        issueService.create(
            alice,
            teamKey,
            new CreateIssueRequest("주간 보고", "이번 주 이슈를 정리해 줘", null, null, null, null, null, null));
    teamIssue = ti.id();
    teamNumber = ti.number();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────────── 개인 작업 ─────────────────────────────

  @Test
  void 개인_작업에_일정이_있으면_소유자의_멘션_없는_글에_일정_AI가_답한다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    long threadId = openThread(personalKey, personalNumber, owner);

    long id = chat(threadId, owner, "오늘은 회의록도 같이 정리해 줘");

    assertThat(created(id).implicitAgentId()).isEqualTo(agent);
    // WP-1375: 멘션 없이 깨우는 글도 멘션 경로처럼 반복 요약을 싣는다 — 이슈 챗 AI 가 반복 맥락을 알게.
    assertThat(created(id).recurrence()).isNotNull();
    assertThat(created(id).recurrence().rrule()).isEqualTo("FREQ=DAILY");
    // 답을 쓰려면 스레드 멤버여야 한다 — 멘션된 AI 처럼 넣는다.
    assertThat(memberRepository.isMember(threadId, agent)).isTrue();
  }

  @Test
  void 일정이_없으면_멘션_없는_글에_답하지_않는다() throws Exception {
    long threadId = openThread(personalKey, personalNumber, owner);
    long id = chat(threadId, owner, "고마워");
    assertThat(created(id).implicitAgentId()).isNull();
  }

  @Test
  void 지운_일정은_없는_일정이다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.DELETED, true)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(personalIssue))
        .execute();
    long threadId = openThread(personalKey, personalNumber, owner);
    assertThat(created(chat(threadId, owner, "고마워")).implicitAgentId()).isNull();
  }

  @Test
  void 꺼진_일정이어도_답한다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.ENABLED, false)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(personalIssue))
        .execute();
    long threadId = openThread(personalKey, personalNumber, owner);
    assertThat(created(chat(threadId, owner, "다시 해 줘")).implicitAgentId()).isEqualTo(agent);
  }

  @Test
  void 일정_AI가_외부_실행이면_답하지_않는다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(agent)).execute();
    long threadId = openThread(personalKey, personalNumber, owner);
    assertThat(created(chat(threadId, owner, "고마워")).implicitAgentId()).isNull();
    // 깨울 AI 가 없으면 반복 요약도 읽지 않는다(WP-1375 — 발사되지 않을 글).
    assertThat(events.stream(ChatMessageCreatedEvent.class).toList())
        .allSatisfy(e -> assertThat(e.recurrence()).isNull());
  }

  @Test
  void 멘션이_하나라도_있으면_멘션_규칙만_쓴다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    long threadId = openThread(personalKey, personalNumber, owner);
    // 다른 사람을 멘션한 글 — 사람끼리 멘션 대화에 일정 AI 가 끼지 않는다.
    long id = chat(threadId, owner, "<@" + alice + "> 이거 봐 주세요");
    var e = created(id);
    assertThat(e.mentions()).extracting(m -> m.id()).containsExactly(alice);
    assertThat(e.implicitAgentId()).isNull();
  }

  @Test
  void 질문의_답이라_이어_처리로_깨웠으면_일반_대화로_다시_깨우지_않는다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    // 정기 회차가 질문으로 끝나 답을 기다리는 질문이 남는다.
    String runId = dispatchOnce(personalIssue);
    report(personalIssue, agent, runId, "초안을 채널에 올릴까요?", true).andExpect(status().isNoContent());
    long threadId = openThread(personalKey, personalNumber, owner);

    long id = chat(threadId, owner, "올려 줘");

    var e = created(id);
    assertThat(e.followUpAgentId()).isEqualTo(agent);
    assertThat(e.implicitAgentId()).isNull();
  }

  @Test
  void 판정이_SQL_오류로_실패해도_글은_저장되고_답할_AI는_없다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    long threadId = openThread(personalKey, personalNumber, owner);
    // 실제 SQL 오류 — 세이브포인트 없이는 글 저장 트랜잭션이 망가져(aborted) 뒤 쿼리·커밋이 실패한다(WP-1377).
    doAnswer(
            inv -> {
              dsl.execute("select 1/0");
              return null;
            })
        .when(implicitAgents)
        .resolve(anyLong(), anyLong());

    long id = chat(threadId, owner, "오늘은 회의록도 같이 정리해 줘");

    assertThat(created(id).implicitAgentId()).isNull();
    // 같은 트랜잭션이 멀쩡해 글이 남아 있다.
    assertThat(dsl.fetchCount(CHAT_MESSAGE, CHAT_MESSAGE.ID.eq(id))).isEqualTo(1);
  }

  @Test
  void 판정이_SQL_오류로_실패해도_스레드_조회는_성공하고_안내는_없다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    doAnswer(
            inv -> {
              dsl.execute("select 1/0");
              return null;
            })
        .when(implicitAgents)
        .resolve(anyLong(), anyLong());

    JsonNode thread = thread(personalKey, personalNumber, owner);

    assertThat(thread.get("implicitAgent").isNull()).isTrue();
    assertThat(thread.get("threadId").asLong()).isPositive();
  }

  @Test
  void 외부_실행_AI가_담당이면_그_AI가_이어받고_일정_AI는_답하지_않는다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    long external =
        withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(external)).execute();
    assigneeRepository.add(personalIssue, external, owner);
    long threadId = openThread(personalKey, personalNumber, owner);

    // 화면은 외부 AI 안내만 — 일정 AI 안내는 싣지 않는다.
    JsonNode t = thread(personalKey, personalNumber, owner);
    assertThat(t.get("externalAgent").get("id").asLong()).isEqualTo(external);
    assertThat(t.get("implicitAgent").isNull()).isTrue();
    assertThat(created(chat(threadId, owner, "고마워")).implicitAgentId()).isNull();
  }

  @Test
  void 일정_AI가_담당에서_빠졌으면_일정이_남아도_답하지_않는다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    assigneeRepository.remove(personalIssue, agent);
    long threadId = openThread(personalKey, personalNumber, owner);

    assertThat(thread(personalKey, personalNumber, owner).get("implicitAgent").isNull()).isTrue();
    assertThat(created(chat(threadId, owner, "다시 해 줘")).implicitAgentId()).isNull();
  }

  @Test
  void 답변_필요로_멈춘_담당_AI를_재개_알림으로_또_깨우지_않는다() throws Exception {
    saveRecurrence(personalKey, personalNumber, owner, null);
    // 일정 AI 의 작업이 답변 필요로 멈춰 있다 — 사람 글이 작업 중으로 되돌린다.
    int paused =
        dsl.update(AGENT_WORK)
            .set(AGENT_WORK.STATE, "INPUT_REQUIRED")
            .where(AGENT_WORK.ISSUE_ID.eq(personalIssue))
            .and(AGENT_WORK.WORKER_ID.eq(agent))
            .and(AGENT_WORK.ENDED_AT.isNull())
            .execute();
    assertThat(paused).isEqualTo(1);
    long threadId = openThread(personalKey, personalNumber, owner);

    long id = chat(threadId, owner, "이렇게 해 줘");

    // 멘션 없이 답하는 AI 로 이미 깨우므로(chat.message.posted), 재개 알림(AgentsResumedByChatReply)으로는 깨우지 않는다.
    assertThat(created(id).implicitAgentId()).isEqualTo(agent);
    assertThat(events.stream(AgentsResumedByChatReply.class).flatMap(e -> e.workerIds().stream()))
        .doesNotContain(agent);
    // 작업은 여전히 작업 중으로 되돌린다.
    assertThat(
            dsl.select(AGENT_WORK.STATE)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ISSUE_ID.eq(personalIssue))
                .and(AGENT_WORK.WORKER_ID.eq(agent))
                .and(AGENT_WORK.ENDED_AT.isNull())
                .fetchOne(AGENT_WORK.STATE))
        .isEqualTo("WORKING");
  }

  // ───────────────────────────── 팀 이슈 ─────────────────────────────

  @Test
  void 팀_이슈에서_스레드_멤버가_글쓴이와_담당_AI뿐이면_늘_답한다() throws Exception {
    saveRecurrence(teamKey, teamNumber, alice, teamAi);
    long threadId = openThread(teamKey, teamNumber, alice);
    assertThat(memberRepository.findMemberIds(threadId)).containsExactlyInAnyOrder(alice, teamAi);

    long id = chat(threadId, alice, "이번 주는 배포 건도 넣어 줘");

    assertThat(created(id).implicitAgentId()).isEqualTo(teamAi);
  }

  @Test
  void 팀_이슈에서_멤버가_셋이면_직전_글이_담당_AI의_글일_때만_답한다() throws Exception {
    saveRecurrence(teamKey, teamNumber, alice, teamAi);
    long threadId = openThread(teamKey, teamNumber, alice);
    memberRepository.insertIgnoreConflict(threadId, List.of(bob));

    // 직전 글이 없거나 사람 글이면 사람끼리 대화로 둔다.
    long first = chat(threadId, alice, "bob 님 이거 확인했어요?");
    assertThat(created(first).implicitAgentId()).isNull();
    long second = chat(threadId, alice, "확인되면 알려 주세요");
    assertThat(created(second).implicitAgentId()).isNull();

    // 담당 AI 가 글을 남긴 바로 다음 글이면 이어서 답한다.
    messageRepository.insert(threadId, teamAi, "이번 주 정리입니다", List.of(), false);
    long third = chat(threadId, alice, "좋아요, 표로 바꿔 줘");
    assertThat(created(third).implicitAgentId()).isEqualTo(teamAi);
  }

  @Test
  void 스레드_멤버가_아무도_없으면_둘만의_대화로_보지_않는다() throws Exception {
    saveRecurrence(teamKey, teamNumber, alice, teamAi);
    long threadId = openThread(teamKey, teamNumber, alice);
    memberRepository.delete(threadId, alice);
    memberRepository.delete(threadId, teamAi);
    assertThat(memberRepository.findMemberIds(threadId)).isEmpty();

    // 빈 멤버 목록은 「글쓴이 + 담당 AI 뿐」이 아니다 — ALWAYS 로 올리지 않는다(WP-1377).
    JsonNode team = thread(teamKey, teamNumber, alice).get("implicitAgent");
    assertThat(team.get("mode").asText()).isEqualTo("AFTER_AI_REPLY");
  }

  @Test
  void 일정을_건_사람도_사람_담당자도_아니면_답하지_않는다() throws Exception {
    saveRecurrence(teamKey, teamNumber, alice, teamAi);
    long threadId = openThread(teamKey, teamNumber, alice);
    // bob 은 프로젝트 멤버지만 일정을 걸지도, 담당도 아니다 — 둘만의 스레드가 돼도 답하지 않는다.
    memberRepository.delete(threadId, alice);

    long id = chat(threadId, bob, "이거 뭐예요?");

    assertThat(created(id).implicitAgentId()).isNull();
  }

  @Test
  void 사람_담당자의_글에는_답한다() throws Exception {
    saveRecurrence(teamKey, teamNumber, alice, teamAi);
    assigneeRepository.add(teamIssue, bob, alice);
    long threadId = openThread(teamKey, teamNumber, alice);
    memberRepository.delete(threadId, alice);
    memberRepository.delete(threadId, bob);

    long id = chat(threadId, bob, "제가 이어 받을게요, 요약해 줘");

    assertThat(created(id).implicitAgentId()).isEqualTo(teamAi);
  }

  @Test
  void 담당_AI가_남의_개인_비서면_주인_글에만_답한다() throws Exception {
    long aliceAi = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, alice));
    personalAssistantRepository.setAgentId(alice, aliceAi);
    // 개인 비서 판별은 결정적 username(접두어 + 주인 id)이다.
    dsl.update(USER)
        .set(USER.USERNAME, "__assistant_u" + alice)
        .where(USER.ID.eq(aliceAi))
        .execute();
    projectMemberRepository.insert(teamProject, aliceAi, "MEMBER");
    saveRecurrence(teamKey, teamNumber, alice, aliceAi);
    // bob 을 사람 담당자로 — 일정 AI 가 개인 비서가 아니면 bob 의 글에도 답한다.
    assigneeRepository.add(teamIssue, bob, alice);
    long threadId = openThread(teamKey, teamNumber, alice);
    memberRepository.delete(threadId, bob);

    // 주인(alice)의 글 — 스레드에 alice·비서뿐이라 늘 답한다.
    assertThat(created(chat(threadId, alice, "정리해 줘")).implicitAgentId()).isEqualTo(aliceAi);

    // bob 의 글 — 남의 개인 비서는 깨우지 않는다. 직전 글을 비서 글로 둬도 마찬가지다.
    memberRepository.delete(threadId, alice);
    messageRepository.insert(threadId, aliceAi, "정리했습니다", List.of(), false);
    assertThat(created(chat(threadId, bob, "나도 부탁해")).implicitAgentId()).isNull();
  }

  // ───────────────────────────── 스레드 응답 ─────────────────────────────

  @Test
  void 스레드_응답은_멘션_없이_답할_AI와_방식을_싣는다() throws Exception {
    // 일정이 없으면 null.
    JsonNode none = thread(personalKey, personalNumber, owner);
    assertThat(none.get("implicitAgent").isNull()).isTrue();

    // 개인 작업 — ALWAYS.
    saveRecurrence(personalKey, personalNumber, owner, null);
    JsonNode personal = thread(personalKey, personalNumber, owner).get("implicitAgent");
    assertThat(personal.get("id").asLong()).isEqualTo(agent);
    assertThat(personal.get("name").asText()).isEqualTo(nameOf(agent));
    assertThat(personal.get("mode").asText()).isEqualTo("ALWAYS");

    // 팀 이슈 — 둘뿐이면 ALWAYS, 멤버가 늘면 AFTER_AI_REPLY.
    saveRecurrence(teamKey, teamNumber, alice, teamAi);
    long threadId = thread(teamKey, teamNumber, alice).get("threadId").asLong();
    assertThat(thread(teamKey, teamNumber, alice).get("implicitAgent").get("mode").asText())
        .isEqualTo("ALWAYS");
    memberRepository.insertIgnoreConflict(threadId, List.of(bob));
    JsonNode team = thread(teamKey, teamNumber, alice).get("implicitAgent");
    assertThat(team.get("id").asLong()).isEqualTo(teamAi);
    assertThat(team.get("mode").asText()).isEqualTo("AFTER_AI_REPLY");

    // 일정을 건 사람도 담당도 아닌 bob 에게는 싣지 않는다.
    assertThat(thread(teamKey, teamNumber, bob).get("implicitAgent").isNull()).isTrue();
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private String nameOf(long userId) {
    return dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.NAME);
  }

  /** 매일 08:00 일정을 저장한다. agentUserId 가 null 이면 저장하는 사람의 개인 비서가 맡는다. */
  private void saveRecurrence(String key, int number, long as, Long agentUserId) throws Exception {
    var m = new HashMap<String, Object>();
    m.put("rrule", "FREQ=DAILY");
    m.put("time", "08:00");
    if (agentUserId != null) m.put("agentUserId", agentUserId);
    call(
            put("/api/v1/projects/" + key + "/issues/" + number + "/recurrence")
                .content(om.writeValueAsString(m)),
            as)
        .andExpect(status().isOk());
  }

  /** 이슈 챗 스레드 응답(화면과 같은 API) — 없으면 초기 멤버(작성자·담당·지켜보는 사람)로 만든다. */
  private JsonNode thread(String key, int number, long as) throws Exception {
    return json(
        call(get("/api/v1/projects/" + key + "/issues/" + number + "/chat/thread"), as)
            .andExpect(status().isOk()));
  }

  private long openThread(String key, int number, long as) throws Exception {
    return thread(key, number, as).get("threadId").asLong();
  }

  /** 사람이 이슈 챗에 글을 남기고 그 글 id 를 돌려준다(화면과 같은 API). */
  private long chat(long threadId, long as, String body) throws Exception {
    JsonNode r =
        json(
            call(
                    post("/api/v1/chat/threads/" + threadId + "/messages")
                        .content(om.writeValueAsString(Map.of("body", body))),
                    as)
                .andExpect(status().isCreated()));
    return r.get("id").asLong();
  }

  /** 그 글의 챗 생성 이벤트. */
  private ChatMessageCreatedEvent created(long messageId) {
    return events.stream(ChatMessageCreatedEvent.class)
        .filter(e -> e.messageId() == messageId)
        .findFirst()
        .orElseThrow();
  }

  /** 회차 시각을 지난 시각으로 당겨 한 회차를 보내고 그 runId 를 돌려준다. */
  private String dispatchOnce(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, Instant.now().minusSeconds(60).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    return dsl.select(ISSUE_RECURRENCE.PENDING_RUN_ID)
        .from(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .fetchOne(ISSUE_RECURRENCE.PENDING_RUN_ID);
  }

  /** ai-agent 의 회차 결과 보고(내부 API)를 흉내 낸다. */
  private ResultActions report(
      long issueId, long as, String runId, String message, boolean question) throws Exception {
    var r =
        mvc.perform(
            post("/api/v1/internal/issue-recurrence/" + issueId + "/runs")
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(as))
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

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}

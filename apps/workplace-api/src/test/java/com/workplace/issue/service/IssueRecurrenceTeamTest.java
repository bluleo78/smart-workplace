package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AgentUsernames;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
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
 * 팀 프로젝트 이슈의 실행 일정(WP-1314) 통합 테스트 — 팀 이슈에 담당 AI 를 골라 저장·회차 실행, 실행 신원(개인 비서 = 주인 대행, 그 밖의 AI = 자기
 * 신원), 서버 실행 AI·구성원만 고르기, 남의 개인 비서 일정은 주인만(저장·고치기·끄기 403, 조회의 editable), 담당 AI 후보 목록.
 *
 * <p>시드: 팀 프로젝트(alice 소유, bob 멤버) + 이슈 1건. 프로젝트 구성원 AI 둘 — 공용 AI(teamAi, 누구의 비서도 아님)와 alice 의 개인
 * 비서(aliceAi). 모두 AI 키가 있다. @Transactional 이라 끝나면 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class IssueRecurrenceTeamTest extends IntegrationTestBase {

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
  @Autowired IssueRecurrenceFollowUpService followUpService;
  @Autowired ApplicationEvents events;

  private long alice;
  private long bob;
  private long teamAi;
  private long aliceAi;
  private long projectId;
  private String key;
  private long issueId;
  private int number;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    alice = human();
    bob = human();
    teamAi = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, alice));
    aliceAi = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, alice));
    personalAssistantRepository.setAgentId(alice, aliceAi);
    key = "RT" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId = projectService.create(alice, new CreateProjectRequest(key, "팀", "x")).id();
    projectMemberRepository.insert(projectId, bob, "MEMBER");
    projectMemberRepository.insert(projectId, teamAi, "MEMBER");
    projectMemberRepository.insert(projectId, aliceAi, "MEMBER");
    var issue =
        issueService.create(
            alice,
            key,
            new CreateIssueRequest("주간 보고", "이번 주 이슈를 정리해 줘", null, null, null, null, null, null));
    issueId = issue.id();
    number = issue.number();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 팀_이슈에_구성원_AI_를_맡기면_담당에_넣고_다음회차대기로_둔다() throws Exception {
    JsonNode body = json(call(put(path()).content(req(teamAi)), bob).andExpect(status().isOk()));
    assertThat(body.get("agentUserId").asLong()).isEqualTo(teamAi);
    assertThat(body.get("editable").asBoolean()).isTrue();
    assertThat(assigneeRepository.findUserIdsByIssue(issueId)).contains(teamAi);
    assertThat(
            dsl.select(AGENT_WORK.STATE)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                .and(AGENT_WORK.WORKER_ID.eq(teamAi))
                .and(AGENT_WORK.ENDED_AT.isNull())
                .fetchOne(AGENT_WORK.STATE))
        .isEqualTo("SCHEDULED");
  }

  @Test
  void 개인비서가_아닌_AI_의_회차는_그_AI_자기_신원으로_돈다() throws Exception {
    call(put(path()).content(req(teamAi)), bob).andExpect(status().isOk());
    var e = runOnce();
    assertThat(e.actingAgentId()).isEqualTo(teamAi);
    // 저장한 bob 의 권한을 빌리지 않는다 — AI 자기 이름·권한.
    assertThat(e.ownerUserId()).isEqualTo(teamAi);
  }

  @Test
  void 개인비서의_회차는_주인_대행으로_돈다() throws Exception {
    call(put(path()).content(req(aliceAi)), alice).andExpect(status().isOk());
    var e = runOnce();
    assertThat(e.actingAgentId()).isEqualTo(aliceAi);
    assertThat(e.ownerUserId()).isEqualTo(alice);
  }

  @Test
  void 고르지_않으면_저장하는_사람의_개인비서가_맡는다() throws Exception {
    JsonNode body = json(call(put(path()).content(req(null)), alice).andExpect(status().isOk()));
    assertThat(body.get("agentUserId").asLong()).isEqualTo(aliceAi);
  }

  @Test
  void 남의_개인비서는_고를_수_없다() throws Exception {
    call(put(path()).content(req(aliceAi)), bob)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.OTHERS_ASSISTANT));
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  @Test
  void 남의_개인비서_일정은_주인만_고치고_끈다() throws Exception {
    call(put(path()).content(req(aliceAi)), alice).andExpect(status().isOk());

    // bob 이 보면 고칠 수 없는 일정이다.
    JsonNode seen = json(call(get(path()), bob).andExpect(status().isOk()));
    assertThat(seen.get("editable").asBoolean()).isFalse();
    assertThat(json(call(get(path()), alice)).get("editable").asBoolean()).isTrue();

    // 시각을 바꾸거나 다른 AI 로 바꿔도, 끄려 해도 막는다.
    call(put(path()).content(req(aliceAi)), bob).andExpect(status().isForbidden());
    call(put(path()).content(req(teamAi)), bob).andExpect(status().isForbidden());
    call(put(path()).content(req(null)), bob).andExpect(status().isForbidden());
    call(delete(path()), bob).andExpect(status().isForbidden());

    var row =
        dsl.selectFrom(ISSUE_RECURRENCE).where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)).fetchOne();
    assertThat(row.getAgentUserId()).isEqualTo(aliceAi);
    assertThat(row.getCreatedBy()).isEqualTo(alice);
    assertThat(row.getDeleted()).isFalse();

    // 주인은 끈다.
    call(delete(path()), alice).andExpect(status().isNoContent());
  }

  @Test
  void 구성원이_아닌_AI_는_409() throws Exception {
    long outsider =
        withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, alice));
    call(put(path()).content(req(outsider)), bob)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.NOT_PROJECT_MEMBER));
  }

  @Test
  void 서버가_실행하지_않는_AI_와_키_없는_AI_는_409() throws Exception {
    long external =
        withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, alice));
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(external)).execute();
    projectMemberRepository.insert(projectId, external, "MEMBER");
    call(put(path()).content(req(external)), bob)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.NOT_SERVER_AGENT));

    long noKey = withMembership(TestFixtures.createAgentNoToken(dsl));
    projectMemberRepository.insert(projectId, noKey, "MEMBER");
    call(put(path()).content(req(noKey)), bob)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.NO_AGENT_KEY));

    // 사람은 서버 실행 AI 가 아니다.
    call(put(path()).content(req(alice)), bob).andExpect(status().isConflict());
  }

  @Test
  void 후보_목록은_서버실행_AI_중_남의_개인비서를_뺀다() throws Exception {
    long external =
        withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, alice));
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(external)).execute();
    projectMemberRepository.insert(projectId, external, "MEMBER");

    assertThat(agentIds(bob)).containsExactly(teamAi);
    // 주인에게는 자기 비서가 맨 앞에 「내 AI 비서」로 온다.
    JsonNode forAlice = json(call(get(path() + "/agents"), alice).andExpect(status().isOk()));
    assertThat(forAlice.get(0).get("id").asLong()).isEqualTo(aliceAi);
    assertThat(forAlice.get(0).get("personalAssistant").asBoolean()).isTrue();
    assertThat(agentIds(alice)).containsExactlyInAnyOrder(aliceAi, teamAi);
  }

  @Test
  void 팀_이슈에서_고르지_않고_내_비서가_없으면_후보_첫째가_맡는다() throws Exception {
    // bob 은 개인 비서가 없다 — 남의 비서(aliceAi)를 빼면 teamAi 가 첫째다.
    JsonNode body = json(call(put(path()).content(req(null)), bob).andExpect(status().isOk()));
    assertThat(body.get("agentUserId").asLong()).isEqualTo(teamAi);
  }

  @Test
  void 연결을_끊은_개인비서도_주인만_고른다() throws Exception {
    // 결정적 username(접두어 + 주인 id)의 비서 — 사람의 개인 비서 연결을 끊어도 그 주인 전용이다.
    dsl.update(USER)
        .set(USER.USERNAME, AgentUsernames.personalAssistantOf(alice))
        .where(USER.ID.eq(aliceAi))
        .execute();
    personalAssistantRepository.setAgentId(alice, null);

    // 주인이 저장하면 주인 대행으로 돈다(403 이 테스트 트랜잭션을 rollback-only 로 만들기 전에 회차를 돌린다).
    call(put(path()).content(req(aliceAi)), alice).andExpect(status().isOk());
    assertThat(runOnce().ownerUserId()).isEqualTo(alice);

    assertThat(agentIds(bob)).containsExactly(teamAi);
    call(put(path()).content(req(teamAi)), bob)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.OTHERS_ASSISTANT));
  }

  @Test
  void 대행할_주인이_프로젝트에서_빠지면_회차를_보내지_않고_일정을_거둔다() throws Exception {
    long bobAi = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, bob));
    personalAssistantRepository.setAgentId(bob, bobAi);
    projectMemberRepository.insert(projectId, bobAi, "MEMBER");
    call(put(path()).content(req(bobAi)), bob).andExpect(status().isOk());

    projectMemberRepository.delete(projectId, bob);
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, Instant.now().minusSeconds(60).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(events.stream(IssueRecurringRunEvent.class)).isEmpty();
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  // ───────────────────────────── 질문의 답으로 이어 처리(WP-1312) ─────────────────────────────

  @Test
  void 이어_처리도_정기_회차와_같은_신원으로_돈다_AI_자기_신원() throws Exception {
    call(put(path()).content(req(teamAi)), bob).andExpect(status().isOk());
    leaveQuestion("올릴까요?");

    assertThat(followUpService.answer(issueId, Long.MAX_VALUE, bob, "올려 줘")).hasValue(teamAi);
    var e = followUps().get(0);
    assertThat(e.actingAgentId()).isEqualTo(teamAi);
    // 저장·답한 bob 의 권한을 빌리지 않는다 — 정기 회차와 같이 AI 자기 신원. 답한 사람은 actor 로만 실린다.
    assertThat(e.ownerUserId()).isEqualTo(teamAi);
    assertThat(e.actor().id()).isEqualTo(bob);
  }

  @Test
  void 이어_처리도_개인비서면_주인_대행으로_돈다() throws Exception {
    call(put(path()).content(req(aliceAi)), alice).andExpect(status().isOk());
    leaveQuestion("올릴까요?");

    assertThat(followUpService.answer(issueId, Long.MAX_VALUE, alice, "올려 줘")).hasValue(aliceAi);
    assertThat(followUps().get(0).ownerUserId()).isEqualTo(alice);
  }

  @Test
  void 대행할_주인이_프로젝트에서_빠지면_이어_처리를_보내지_않고_질문을_비운다() throws Exception {
    long bobAi = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, bob));
    personalAssistantRepository.setAgentId(bob, bobAi);
    projectMemberRepository.insert(projectId, bobAi, "MEMBER");
    call(put(path()).content(req(bobAi)), bob).andExpect(status().isOk());
    leaveQuestion("올릴까요?");

    projectMemberRepository.delete(projectId, bob);
    assertThat(followUpService.answer(issueId, Long.MAX_VALUE, bob, "올려 줘")).isEmpty();
    assertThat(followUps()).isEmpty();
    assertThat(
            dsl.select(
                    ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID, ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)
                .from(ISSUE_RECURRENCE)
                .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
                .fetchOne())
        .satisfies(
            r -> {
              assertThat(r.value1()).isNull();
              assertThat(r.value2()).isNull();
            });
  }

  // ───────────────────────────── 지금 실행(WP-1313) ─────────────────────────────

  @Test
  void 남의_개인비서_일정은_주인만_지금_실행한다() throws Exception {
    call(put(path()).content(req(aliceAi)), alice).andExpect(status().isOk());

    call(post(path() + "/test-runs"), bob)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.OTHERS_ASSISTANT));
    assertThat(testRunId()).isNull();

    call(post(path() + "/test-runs"), alice).andExpect(status().isAccepted());
    assertThat(testRunId()).isNotNull();
  }

  @Test
  void 팀_AI_일정을_다른_구성원이_지금_실행하면_누른_사람이_답한다() throws Exception {
    // bob 이 저장한 공용 AI 일정을 alice 가 지금 실행한다 — 누른 사람이 actor 이고, 남긴 질문에는 누른 alice 가 답한다.
    call(put(path()).content(req(teamAi)), bob).andExpect(status().isOk());
    call(post(path() + "/test-runs"), alice).andExpect(status().isAccepted());
    var sent = events.stream(IssueRecurringRunEvent.class).toList();
    assertThat(sent).hasSize(1);
    assertThat(sent.get(0).test()).isTrue();
    assertThat(sent.get(0).actor().id()).isEqualTo(alice);
    assertThat(sent.get(0).ownerUserId()).isEqualTo(teamAi);

    recurrenceService.reportRun(
        teamAi,
        issueId,
        new com.workplace.issue.dto.IssueRecurrenceRunReport(
            testRunId(), true, "메일을 보낼까요?", true, null));

    assertThat(followUpService.answer(issueId, Long.MAX_VALUE, bob, "보내 줘")).isEmpty();
    assertThat(followUpService.answer(issueId, Long.MAX_VALUE, alice, "보내 줘")).hasValue(teamAi);
    var e = followUps().get(0);
    assertThat(e.test()).isTrue();
    assertThat(e.actor().id()).isEqualTo(alice);
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  private String testRunId() {
    return dsl.select(ISSUE_RECURRENCE.TEST_RUN_ID)
        .from(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .fetchOne(ISSUE_RECURRENCE.TEST_RUN_ID);
  }

  /** 회차가 이슈 챗에 질문을 남긴 상태로 만든다 — 질문 글 id 는 1(그 뒤의 어떤 글이든 답이 될 수 있게). */
  private void leaveQuestion(String question) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID, 1L)
        .set(ISSUE_RECURRENCE.PENDING_QUESTION_TEXT, question)
        .set(ISSUE_RECURRENCE.PENDING_QUESTION_ASKED_AT, Instant.now().atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /** 지금까지 발행된 이어 처리 이벤트. */
  private List<IssueRecurringRunEvent> followUps() {
    return events.stream(IssueRecurringRunEvent.class).filter(e -> e.followUp() != null).toList();
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  /** 회차 시각을 지난 시각으로 당겨 한 회차를 보내고 그 이벤트를 돌려준다. */
  private IssueRecurringRunEvent runOnce() {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, Instant.now().minusSeconds(60).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    var sent = events.stream(IssueRecurringRunEvent.class).toList();
    assertThat(sent).hasSize(1);
    return sent.get(0);
  }

  private List<Long> agentIds(long caller) throws Exception {
    JsonNode list = json(call(get(path() + "/agents"), caller).andExpect(status().isOk()));
    List<Long> ids = new ArrayList<>();
    list.forEach(n -> ids.add(n.get("id").asLong()));
    return ids;
  }

  private String path() {
    return "/api/v1/projects/" + key + "/issues/" + number + "/recurrence";
  }

  private String req(Long agentUserId) throws Exception {
    var m = new HashMap<String, Object>();
    m.put("rrule", "FREQ=DAILY");
    m.put("time", "08:00");
    if (agentUserId != null) m.put("agentUserId", agentUserId);
    return om.writeValueAsString(m);
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

package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.HashMap;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.Record;
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
 * 서버 AI 실행 보고(WP-1219) 통합 테스트 — 시작은 「작업 중」, 정상 끝은 「검토 대기」, 실패는 「막힘」으로 작업 기록을 남기고 AI 위임 작업 목록에 나온다.
 * 끝난 이슈·담당이 아닌 AI·반복이 맡은 이슈는 기록을 바꾸지 않고, 내부 호출이 아니거나 AI 가 아니면 거절한다.
 *
 * <p>시드: 팀 프로젝트(owner) + 이슈 1건, 서버 실행 AI(agent)를 프로젝트 멤버·담당자로 둔다. @Transactional 이라 끝나면 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class ServerAgentRunTest extends IntegrationTestBase {

  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired IssueService issueService;
  @Autowired IssueAssigneeRepository assigneeRepository;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired ApplicationEvents events;

  private long owner;
  private long agent;
  private String key;
  private long issueId;
  private int number;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, owner, "USER");
    agent = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    var project =
        projectService.create(
            owner, new CreateProjectRequest("SAR" + (System.nanoTime() % 100000), "팀", null, null));
    key = project.key();
    projectMemberRepository.insert(project.id(), agent, "MEMBER");
    var issue =
        issueService.create(
            owner,
            key,
            new CreateIssueRequest("체크리스트 작성", "회귀 테스트 체크리스트", null, null, null, null, null, null));
    issueId = issue.id();
    number = issue.number();
    assigneeRepository.add(issueId, agent, owner);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 시작하면_작업중_정상으로_끝나면_검토대기로_남고_AI위임작업에_나온다() throws Exception {
    report(agent, "STARTED", false, null).andExpect(status().isNoContent());
    Record work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("WORKING");
    assertThat(work.get(AGENT_WORK.NOTE)).isEqualTo(ServerAgentRunService.NOTE_WORKING);
    assertThat(work.get(AGENT_WORK.TOOL)).isEqualTo("workplace");

    report(agent, "FINISHED", true, null).andExpect(status().isNoContent());
    work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("REVIEW");
    assertThat(work.get(AGENT_WORK.NOTE)).isEqualTo(ServerAgentRunService.NOTE_DONE);
    // 검토 대기로 들어선 순간 한 번 알린다(시작은 알리지 않는다) — 수신 후보는 담당 지정자·보고자.
    var notices = events.stream(AgentWorkNoticeEvent.class).toList();
    assertThat(notices).hasSize(1);
    assertThat(notices.get(0).state()).isEqualTo("REVIEW");
    assertThat(notices.get(0).delegateCandidates()).contains(owner);
    // 상태가 바뀌지 않은 보고(검토 대기 → 검토 대기)는 다시 알리지 않는다.
    report(agent, "FINISHED", true, null).andExpect(status().isNoContent());
    assertThat(events.stream(AgentWorkNoticeEvent.class).count()).isEqualTo(1);
    // 같은 행을 이어 쓴다 — 이슈·AI 당 진행 중 기록은 하나.
    assertThat(dsl.fetchCount(AGENT_WORK, AGENT_WORK.ISSUE_ID.eq(issueId))).isEqualTo(1);

    // 담당을 맡긴 사람의 AI 위임 작업(전체 범위)에 이 이슈가 나온다.
    call(get("/api/v1/me/ai-tasks").param("scope", "ALL"), owner)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[?(@.title == '체크리스트 작성')]").exists());
  }

  @Test
  void 실패로_끝나면_막힘과_사유를_남긴다() throws Exception {
    report(agent, "STARTED", false, null).andExpect(status().isNoContent());
    report(agent, "FINISHED", false, "가".repeat(200)).andExpect(status().isNoContent());
    Record work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("BLOCKED");
    assertThat(work.get(AGENT_WORK.NOTE)).hasSize(ServerAgentRunService.NOTE_MAX);
    assertThat(events.stream(AgentWorkNoticeEvent.class).map(AgentWorkNoticeEvent::state))
        .containsExactly("BLOCKED");

    // 사유가 없으면 기본 문구 — 시작 보고 없이 바로 실패해도(연결 정보 실패 등) 기록이 생긴다.
    dsl.deleteFrom(AGENT_WORK).where(AGENT_WORK.ISSUE_ID.eq(issueId)).execute();
    report(agent, "FINISHED", false, " ").andExpect(status().isNoContent());
    assertThat(activeWork().get(AGENT_WORK.NOTE))
        .isEqualTo(ServerAgentRunService.NOTE_FAILED_DEFAULT);
  }

  @Test
  void 이슈가_끝났거나_담당이_아니면_기록을_되살리지_않는다() throws Exception {
    report(agent, "STARTED", false, null).andExpect(status().isNoContent());
    // AI 가 실행 안에서 완료 처리 → 기록이 완료로 닫힌다. 그 뒤 온 끝 보고는 되살리지 않는다.
    call(
            patch("/api/v1/projects/" + key + "/issues/" + number + "/status")
                .content(om.writeValueAsString(Map.of("status", "DONE"))),
            owner)
        .andExpect(status().is2xxSuccessful());
    report(agent, "FINISHED", true, null).andExpect(status().isNoContent());
    assertThat(activeWorkOrNull()).isNull();
    assertThat(lastWorkState()).isEqualTo("COMPLETED");

    // 담당이 아닌 AI 의 보고는 204 로 넘기고 기록을 만들지 않는다.
    long other = withMembership(TestFixtures.createAgentNoToken(dsl));
    report(other, "STARTED", false, null).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(AGENT_WORK, AGENT_WORK.WORKER_ID.eq(other))).isZero();
  }

  @Test
  void 그_AI의_반복이_있으면_반복의_기록을_덮지_않는다() throws Exception {
    // 반복이 「다음 회차 대기」를 쥔 이슈 — 코멘트로 깨어난 실행 보고가 그 상태를 바꾸면 안 된다.
    dsl.insertInto(com.workplace.jooq.Tables.ISSUE_RECURRENCE)
        .set(com.workplace.jooq.Tables.ISSUE_RECURRENCE.ISSUE_ID, issueId)
        .set(com.workplace.jooq.Tables.ISSUE_RECURRENCE.RRULE, "FREQ=DAILY")
        .set(com.workplace.jooq.Tables.ISSUE_RECURRENCE.RUN_TIME, java.time.LocalTime.of(8, 0))
        .set(com.workplace.jooq.Tables.ISSUE_RECURRENCE.AGENT_USER_ID, agent)
        .set(com.workplace.jooq.Tables.ISSUE_RECURRENCE.CREATED_BY, owner)
        .execute();
    report(agent, "STARTED", false, null).andExpect(status().isNoContent());
    report(agent, "FINISHED", true, null).andExpect(status().isNoContent());
    assertThat(activeWorkOrNull()).isNull();

    // 지운 반복(실행 중 삭제로 남은 묘비)은 기록을 맡지 않는다 — 그 뒤 실행은 다시 기록된다.
    dsl.update(com.workplace.jooq.Tables.ISSUE_RECURRENCE)
        .set(com.workplace.jooq.Tables.ISSUE_RECURRENCE.DELETED, true)
        .where(com.workplace.jooq.Tables.ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    report(agent, "STARTED", false, null).andExpect(status().isNoContent());
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("WORKING");
  }

  @Test
  void 내부_호출이_아니거나_AI가_아니거나_phase가_틀리면_거절한다() throws Exception {
    // 사람 JWT 로는 내부 엔드포인트를 쓸 수 없다.
    call(post(path()).content(om.writeValueAsString(Map.of("phase", "STARTED"))), owner)
        .andExpect(status().isForbidden());
    // 내부 토큰이어도 대신하는 사용자가 사람이면 거절한다.
    report(owner, "STARTED", false, null).andExpect(status().isForbidden());
    report(agent, "PAUSED", false, null).andExpect(status().isBadRequest());
    assertThat(activeWorkOrNull()).isNull();
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  private String path() {
    return "/api/v1/internal/issues/" + issueId + "/agent-runs";
  }

  private ResultActions report(long as, String phase, boolean ok, String note) throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("phase", phase);
    body.put("ok", ok);
    body.put("note", note);
    ResultActions r =
        mvc.perform(
            post(path())
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(as))
                .header("X-On-Behalf-Of-Tenant", "1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)));
    TenantContext.set(1L);
    return r;
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private Record activeWork() {
    Record r = activeWorkOrNull();
    assertThat(r).as("진행 중 AI 작업").isNotNull();
    return r;
  }

  /** 그 AI 의 진행 중(끝나지 않은) 작업 기록 — 없으면 null. */
  private Record activeWorkOrNull() {
    return dsl.selectFrom(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.eq(agent))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .fetchOne();
  }

  private String lastWorkState() {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.eq(agent))
        .orderBy(AGENT_WORK.ID.desc())
        .limit(1)
        .fetchOne(AGENT_WORK.STATE);
  }
}

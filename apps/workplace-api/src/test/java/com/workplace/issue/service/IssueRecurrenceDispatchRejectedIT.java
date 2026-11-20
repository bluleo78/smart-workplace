package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.Executor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1812 — 이벤트 발사 실행기가 반복 회차 발사를 거절하면(큐 가득) 그 회차를 40분 대기 뒤가 아니라 바로 실패 사유와 함께 남기는지 본다.
 *
 * <p>회차 이벤트는 AFTER_COMMIT 에서만 발사되므로 롤백되는 {@code @Transactional} 테스트로는 볼 수 없다 — 시드를 커밋하는 비-트랜잭션
 * 테스트이고, 끝에서 시드를 지운다.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class IssueRecurrenceDispatchRejectedIT extends IntegrationTestBase {

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

  /** 기본은 받기만 하고 아무것도 돌리지 않는 목 — 거절 시험만 execute 가 던지게 바꾼다. */
  @MockitoBean(name = "aiAgentEventExecutor")
  Executor eventExecutor;

  private long owner;
  private long agent;
  private String key;
  private long issueId;
  private int number;
  private long projectId;

  @BeforeEach
  void seed() throws Exception {
    // 시드를 커밋한다 — 비-트랜잭션 테스트라 서비스 호출마다 자체 트랜잭션이 커밋된다.
    TenantContext.set(1L);
    owner = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, owner, "USER");
    agent = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    personalAssistantRepository.setAgentId(owner, agent);
    var project =
        projectService.create(owner, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    key = project.key();
    projectId = project.id();
    projectMemberRepository.insert(projectId, agent, "MEMBER");
    var issue =
        issueService.create(
            owner,
            key,
            new CreateIssueRequest(
                "주간 보고 메일", "매주 보고 메일을 팀장님께 바로 보내 줘", null, null, null, null, null, null));
    issueId = issue.id();
    number = issue.number();
    assigneeRepository.add(issueId, agent, owner);
    var body = new HashMap<String, Object>();
    body.put("rrule", "FREQ=DAILY");
    body.put("time", "08:00");
    call(put("/api/v1/projects/" + key + "/issues/" + number + "/recurrence")
            .content(om.writeValueAsString(body)))
        .andExpect(status().isOk());
    // 회차 시각을 지난 시각으로 당겨 이번 폴에서 보내지게 한다.
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, Instant.now().minusSeconds(60).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          // AI 키는 만든 사람(owner) FK 가 CASCADE 가 아니라 먼저 지운다.
          dsl.deleteFrom(AI_AGENT_CREDENTIAL)
              .where(AI_AGENT_CREDENTIAL.CREATED_BY.in(owner, agent))
              .execute();
          dsl.deleteFrom(USER).where(USER.ID.in(owner, agent)).execute();
        });
    TenantContext.clear();
  }

  @Test
  void rejectedRegularRunFailsImmediately() {
    // 실행기가 회차 발사를 거절한다(큐 가득).
    doThrow(new TaskRejectedException("큐 가득")).when(eventExecutor).execute(any());

    TenantContext.set(1L);
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);

    // 40분 대기 없이 바로: 사유가 이슈 챗에 남고 대기 runId 가 비며 연속 실패는 1.
    assertThat(agentMessages())
        .containsExactly(
            IssueRecurrenceService.FAILED_PREFIX + IssueRecurrenceService.DISPATCH_REJECTED);
    assertThat(IssueRecurrenceService.FAILED_PREFIX + IssueRecurrenceService.DISPATCH_REJECTED)
        .isEqualTo("이번 회차를 실행하지 못했습니다: 서버가 바빠 회차를 보내지 못했습니다");
    Record row = row();
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(1);
  }

  @Test
  void staleRunIdIsIgnored() {
    TenantContext.set(1L);
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    Record before = row();
    String pending = before.get(ISSUE_RECURRENCE.PENDING_RUN_ID);
    assertThat(pending).isNotNull();

    // 지금 대기 중인 회차가 아닌 runId 의 거절 통보는 무시한다(지난 회차의 늦은 통보).
    recurrenceService.failDispatch(issueId, "다른-runId", IssueRecurrenceService.DISPATCH_REJECTED);

    assertThat(agentMessages()).isEmpty();
    Record after = row();
    assertThat(after.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isEqualTo(pending);
    assertThat(after.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES))
        .isEqualTo(before.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES));
  }

  @Test
  void failDispatchOnFollowUpRunFailsFollowUp() {
    // 이어 처리(FOLLOW_UP) 회차가 대기 중인 상태 — 정기 회차는 대기 중이 아니다.
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID, "fu-run-1")
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();

    TenantContext.set(1L);
    recurrenceService.failDispatch(issueId, "fu-run-1", IssueRecurrenceService.DISPATCH_REJECTED);

    // 이어 처리 실패 문구가 남고 이어 처리 대기가 비며, 정기 회차 연속 실패 수는 건드리지 않는다.
    assertThat(agentMessages())
        .containsExactly(
            IssueRecurrenceService.FOLLOW_UP_FAILED_PREFIX
                + IssueRecurrenceService.DISPATCH_REJECTED);
    Record row = row();
    assertThat(row.get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
  }

  @Test
  void failDispatchOnTestRunFailsTestRunOnly() {
    // 테스트 실행 회차가 대기 중인 상태.
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.TEST_RUN_ID, "test-run-1")
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();

    TenantContext.set(1L);
    recurrenceService.failDispatch(issueId, "test-run-1", IssueRecurrenceService.DISPATCH_REJECTED);

    // 테스트 표시가 붙은 실패 글만 남고 테스트 대기가 비며, 연속 실패 수·켜짐은 그대로다.
    assertThat(agentMessages())
        .containsExactly(
            IssueRecurrenceService.TEST_LABEL
                + IssueRecurrenceService.TEST_FAILED_PREFIX
                + IssueRecurrenceService.DISPATCH_REJECTED);
    Record row = row();
    assertThat(row.get(ISSUE_RECURRENCE.TEST_RUN_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
    assertThat(row.get(ISSUE_RECURRENCE.ENABLED)).isTrue();
  }

  private Record row() {
    return dsl.selectFrom(ISSUE_RECURRENCE).where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)).fetchOne();
  }

  /** 이 이슈 챗에 AI 가 남긴 글(작성 순). */
  private List<String> agentMessages() {
    return dsl.select(CHAT_MESSAGE.BODY)
        .from(CHAT_MESSAGE)
        .join(CHAT_THREAD)
        .on(CHAT_THREAD.ID.eq(CHAT_MESSAGE.THREAD_ID))
        .where(CHAT_THREAD.ISSUE_ID.eq(issueId))
        .and(CHAT_MESSAGE.AUTHOR_ID.eq(agent))
        .orderBy(CHAT_MESSAGE.ID)
        .fetch(CHAT_MESSAGE.BODY);
  }

  private org.springframework.test.web.servlet.ResultActions call(MockHttpServletRequestBuilder req)
      throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(owner, "u-" + owner, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    var r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}

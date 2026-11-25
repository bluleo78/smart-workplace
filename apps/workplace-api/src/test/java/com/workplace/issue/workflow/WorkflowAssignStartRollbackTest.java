package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.issue.workflow.dto.CreateWorkflowRequest;
import com.workplace.issue.workflow.dto.UpdateWorkflowRequest;
import com.workplace.issue.workflow.service.WorkflowDefinitionService;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1986 「지정하고 바로 시작」의 원자성 — 시작이 실패하면 같은 요청의 담당 교체까지 되돌아가는지 커밋된 상태로 본다.
 *
 * <p>왜 비트랜잭션 시험인가: 시험 트랜잭션에 합류하면 시작 실패가 그 트랜잭션을 rollback-only 로 표시할 뿐 담당 교체의 INSERT 는 같은 트랜잭션에서 그대로
 * 보인다 — 교체와 시작이 정말 한 트랜잭션인지(따로 커밋하지 않는지) 가릴 수 없다. 그래서 요청이 스스로 커밋·롤백하게 두고 커밋된 행을 읽는다({@link
 * WorkflowRunConcurrencyTest} 방식, 시드·정리는 테넌트 트랜잭션 안).
 */
class WorkflowAssignStartRollbackTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwt;
  @Autowired WorkflowDefinitionService definitionService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;

  private OpenScenario.Result s;
  private long workflowId;

  /** 커밋된 프로젝트(owner·member)·시작 역할이 member 뿐인 켠 정의·담당 없는 이슈. */
  @BeforeEach
  void seed() {
    s =
        callInTenant(
            1L,
            () ->
                OpenScenario.createTeam(
                    baseDsl, issueTypeService, issueRepository, sequenceRepository, 1L));
    callInTenant(
        1L,
        () -> {
          for (long id : List.of(s.ownerId(), s.memberId())) {
            withMembership(id);
            grantUserRole(id);
          }
          return null;
        });
    String yaml =
        """
        schema: genia/workflow@1
        name: 지정하고 시작
        roles:
          worker: { members: ["%s"] }
        nodes:
          start: { type: start }
          work: { type: human_task, role: worker, outcomes: { done: { to: end } } }
          end: { type: end }
        start:
          - { when: { assigneeRole: worker }, to: work }
        """
            .formatted(username(s.memberId()));
    workflowId =
        callInTenant(
            1L,
            () -> {
              long id =
                  definitionService
                      .create(s.project().id(), new CreateWorkflowRequest("지정", yaml), s.ownerId())
                      .id();
              definitionService.publish(id, null, false, s.ownerId());
              definitionService.update(id, new UpdateWorkflowRequest(true, null), s.ownerId());
              return id;
            });
  }

  /** 이 시험이 만든 행만 치운다. */
  @AfterEach
  void cleanup() {
    if (s == null) {
      return;
    }
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(WORKFLOW_RUN).where(WORKFLOW_RUN.ISSUE_ID.eq(s.issueId())).execute();
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(s.project().id())).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(s.project().id())).execute();
          List<Long> users = List.of(s.ownerId(), s.memberId(), s.reporterId(), s.strangerId());
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
  }

  @Test
  @DisplayName("시작 역할이 없는 담당으로 지정하고 바로 시작하면 422 이고 담당 교체도 커밋되지 않는다")
  void assignWithStartWorkflowId_startFails_rollsBackAssignees() throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("userIds", List.of(s.ownerId()));
    body.put("startWorkflowId", workflowId);
    var req =
        put("/api/v1/projects/" + s.projectKey() + "/issues/" + s.issueNumber() + "/assignees")
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body))
            .header(
                "Authorization",
                "Bearer " + jwt.generateAccessToken(s.ownerId(), "u-" + s.ownerId(), 1L));

    var response = mvc.perform(req).andReturn().getResponse();
    TenantContext.clear();

    String text = response.getContentAsString(StandardCharsets.UTF_8);
    assertThat(response.getStatus()).as("%s", text).isEqualTo(422);
    assertThat(om.readTree(text).get("errors").get("code").asString())
        .isEqualTo("WORKFLOW_NO_START_MATCH");
    int assignees =
        callInTenant(
            1L, () -> baseDsl.fetchCount(ISSUE_ASSIGNEE, ISSUE_ASSIGNEE.ISSUE_ID.eq(s.issueId())));
    int runs =
        callInTenant(
            1L, () -> baseDsl.fetchCount(WORKFLOW_RUN, WORKFLOW_RUN.ISSUE_ID.eq(s.issueId())));
    assertThat(assignees).isZero();
    assertThat(runs).isZero();
  }

  private String username(long id) {
    return callInTenant(
        1L,
        () ->
            baseDsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(id)).fetchSingle().value1());
  }
}

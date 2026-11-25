package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.issue.workflow.dto.CreateWorkflowRequest;
import com.workplace.issue.workflow.dto.UpdateWorkflowRequest;
import com.workplace.issue.workflow.service.WorkflowDefinitionService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.service.ProjectService;
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
 * WP-2120 자동 시작이 실패하면(배정 규칙 위반) 같은 요청의 담당 교체까지 되돌아가는지 커밋된 상태로 본다. 방식은 {@link
 * WorkflowAssignStartRollbackTest} 와 같다(비트랜잭션 — 요청이 스스로 커밋·롤백).
 */
class WorkflowAutoStartRollbackTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwt;
  @Autowired WorkflowDefinitionService definitionService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired ProjectService projectService;

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
          for (long id : List.of(s.ownerId(), s.memberId(), s.reporterId())) {
            withMembership(id);
            grantUserRole(id);
          }
          // worker 역할의 둘째 구성원 — 프로젝트 구성원이어야 정의 게시 검증을 지난다.
          projectService.addMember(
              s.ownerId(), s.projectKey(), new AddMemberRequest(s.reporterId(), "MEMBER"));
          return null;
        });
    String yaml =
        """
        schema: genia/workflow@1
        name: 자동 시작 실패
        roles:
          lead: { members: ["%s"] }
          worker: { members: ["%s", "%s"] }
        nodes:
          start: { type: start }
          route: { type: decision, default: work }
          work: { type: human_task, role: worker, outcomes: { done: { to: end } } }
          end: { type: end }
        start:
          - { when: { assigneeRole: lead }, to: route }
        """
            .formatted(username(s.ownerId()), username(s.memberId()), username(s.reporterId()));
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
  @DisplayName("시작 조건에는 맞지만 시작 노드 담당을 정할 수 없어 시작이 실패하면 422 이고 담당 교체도 커밋되지 않는다")
  void putAssignees_startFails_rollsBackAssignees() throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    // owner 는 lead 라 시작 조건에 맞지만 work 노드(worker 둘)에 든 담당이 없어 ASSIGNEE_REQUIRED 로 시작이 실패한다.
    body.put("userIds", List.of(s.ownerId()));
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
    assertThat(response.getStatus()).as("%s", text).isBetween(400, 499);
    int assignees =
        callInTenant(
            1L, () -> baseDsl.fetchCount(ISSUE_ASSIGNEE, ISSUE_ASSIGNEE.ISSUE_ID.eq(s.issueId())));
    int runs =
        callInTenant(
            1L, () -> baseDsl.fetchCount(WORKFLOW_RUN, WORKFLOW_RUN.ISSUE_ID.eq(s.issueId())));
    assertThat(assignees).isZero();
    assertThat(runs).isZero();
  }

  @Test
  @DisplayName("미리보기 — 시작은 되지만 배정 위반으로 실패할 담당이면 start 와 함께 blocked.message 를 돌려준다")
  void assignPreview_assigneeRequired_reportsBlocked() throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("userIds", List.of(s.ownerId()));
    var req =
        post("/api/v1/issues/" + s.issueId() + "/workflow/assign-preview")
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body))
            .header(
                "Authorization",
                "Bearer " + jwt.generateAccessToken(s.ownerId(), "u-" + s.ownerId(), 1L));

    var response = mvc.perform(req).andReturn().getResponse();
    TenantContext.clear();

    String text = response.getContentAsString(StandardCharsets.UTF_8);
    assertThat(response.getStatus()).as("%s", text).isEqualTo(200);
    var json = om.readTree(text);
    assertThat(json.get("start").isNull()).as("%s", text).isFalse();
    assertThat(json.get("blocked").isNull()).as("%s", text).isFalse();
    assertThat(json.get("blocked").get("message").asString()).isNotBlank();
  }

  private String username(long id) {
    return callInTenant(
        1L,
        () ->
            baseDsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(id)).fetchSingle().value1());
  }
}

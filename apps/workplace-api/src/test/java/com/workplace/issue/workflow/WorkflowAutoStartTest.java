package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-2120 담당 지정 = 워크플로우 시작 — 담당 교체·이슈 생성이 시작 조건에 맞으면 같은 요청에서 실행이 시작되는지, 맞지 않거나(무관한 사람·닫힌 이슈·활성 실행
 * 중·깨우지 않는 교체) 시작하지 않는지 본다. 시작 실패 시 담당 교체까지 되돌아가는 것은 커밋을 봐야 해서 {@link
 * WorkflowAutoStartRollbackTest} 가 본다.
 */
@Transactional
@RecordApplicationEvents
class WorkflowAutoStartTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueAssigneeService assigneeService;
  @Autowired ApplicationEvents events;

  private long pm;
  private long dev;
  private long dev2;
  private long other;
  private String key;
  private long projectId;
  private long workflowId;

  /** 시작 조건이 developer 역할(dev·dev2) → dev 노드인 켠 정의와, 역할 밖 구성원 other 가 있는 프로젝트. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    dev = human();
    dev2 = human();
    other = human();
    key = uniqueProjectKey("AS");
    projectId = projectService.create(pm, new CreateProjectRequest(key, "자동 시작", "x", "TEAM")).id();
    TenantContext.set(1L);
    for (long id : List.of(dev, dev2, other)) {
      projectService.addMember(pm, key, new AddMemberRequest(id, "MEMBER"));
    }
    String yaml =
        """
        schema: genia/workflow@1
        name: 자동 시작
        roles:
          developer: { members: ["%s", "%s"] }
        nodes:
          start: { type: start }
          dev: { type: human_task, role: developer, outcomes: { done: { to: end } } }
          end: { type: end }
        start:
          - { when: { assigneeRole: developer }, to: dev }
        """
            .formatted(username(dev), username(dev2));
    JsonNode created =
        expect(
            post(API + "/projects/" + projectId + "/workflows")
                .content(json("name", "흐름 " + UUID.randomUUID(), "yaml", yaml)),
            pm,
            201);
    workflowId = created.get("id").asLong();
    expect(post(API + "/workflows/" + workflowId + "/publish"), pm, 200);
    expect(patch(API + "/workflows/" + workflowId).content(json("enabled", true)), pm, 200);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("시작 역할 구성원을 담당으로 지정하면 같은 요청에서 실행이 시작되고 시작이 머무는 노드에 있다")
  void putAssignees_startRoleMember_startsRunInSameRequest() {
    long issue = issue();

    expect(assignReq(issue, List.of(dev)), pm, 200);

    JsonNode v = expect(get(API + "/issues/" + issue + "/workflow"), pm, 200);
    assertThat(v.get("runId").isNull()).as("%s", v).isFalse();
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("dev");
  }

  @Test
  @DisplayName("시작 조건 밖의 사람을 지정하면 담당만 들어가고 실행은 없다")
  void putAssignees_nonMatchingPerson_noRun() {
    long issue = issue();

    expect(assignReq(issue, List.of(other)), pm, 200);

    assertThat(assignees(issue)).containsExactly(other);
    assertThat(runCount(issue)).isZero();
    JsonNode v = expect(get(API + "/issues/" + issue + "/workflow"), pm, 200);
    assertThat(v.get("runId").isNull()).isTrue();
  }

  @Test
  @DisplayName("맞는 담당이 이미 있어도 무관한 사람만 더하면 새 실행이 생기지 않는다")
  void putAssignees_unrelatedAddedWhileMatchAlreadyAssigned_noNewRun() {
    long issue = issue();
    expect(assignReq(issue, List.of(dev)), pm, 200);
    // 실행을 끝낸(취소) 뒤 — 이제 활성 실행은 없고 developer 는 이미 담당이다.
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "CANCELED")
        .set(WORKFLOW_RUN.ENDED_AT, java.time.OffsetDateTime.now())
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .execute();

    expect(assignReq(issue, List.of(dev, other)), pm, 200);

    assertThat(runCount(issue)).isEqualTo(1);
    JsonNode v = expect(get(API + "/issues/" + issue + "/workflow"), pm, 200);
    assertThat(v.get("status").asString()).isEqualTo("CANCELED");
  }

  @Test
  @DisplayName("닫힌 이슈는 담당만 지정되고 실행은 시작하지 않는다")
  void putAssignees_closedIssue_assignsWithoutRun() {
    long issue = issue();
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(projectId, "DONE"))
        .where(ISSUE.ID.eq(issue))
        .execute();

    expect(assignReq(issue, List.of(dev)), pm, 200);

    assertThat(assignees(issue)).containsExactly(dev);
    assertThat(runCount(issue)).isZero();
  }

  @Test
  @DisplayName("활성 실행 중 담당을 다시 지정해도 두 번째 실행은 생기지 않는다")
  void putAssignees_activeRun_reassign_noSecondRun() {
    long issue = issue();
    expect(assignReq(issue, List.of(dev)), pm, 200);

    expect(assignReq(issue, List.of(dev, dev2)), pm, 200);

    assertThat(runCount(issue)).isEqualTo(1);
  }

  @Test
  @DisplayName("시작 역할 구성원을 담당으로 넣어 이슈를 만들면 실행이 시작된다")
  void createIssue_withStartRoleAssignee_startsRun() {
    long issue = issue(dev);

    assertThat(runCount(issue)).isEqualTo(1);
    JsonNode v = expect(get(API + "/issues/" + issue + "/workflow"), pm, 200);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("dev");
  }

  @Test
  @DisplayName("담당을 넣어 만든 이슈가 시작으로 담당이 바뀌면 생성 응답의 담당도 시작 뒤 값이다")
  void createIssue_startChangesAssignees_responseHasAssigneesAfterStart() {
    // 리뷰 후속(PR #1861): developer 담당으로 시작하면 decision 을 지나 reviewer 역할(other 한 명)의 review 노드에 머물러 시작이
    // other 를 담당으로 더한다 —
    // 응답이 시작 전 값(dev 만)이면 호출자(MCP create_issue 등)가 담당을 잘못 본다. 시드의 정의는 끄고 이 정의만 켠다.
    expect(patch(API + "/workflows/" + workflowId).content(json("enabled", false)), pm, 200);
    String yaml =
        """
        schema: genia/workflow@1
        name: 검토로 시작
        roles:
          developer: { members: ["%s"] }
          reviewer: { members: ["%s"] }
        nodes:
          start: { type: start }
          route: { type: decision, default: review }
          review: { type: human_task, role: reviewer, outcomes: { done: { to: end } } }
          end: { type: end }
        start:
          - { when: { assigneeRole: developer }, to: route }
        """
            .formatted(username(dev), username(other));
    long wf =
        expect(
                post(API + "/projects/" + projectId + "/workflows")
                    .content(json("name", "검토 " + UUID.randomUUID(), "yaml", yaml)),
                pm,
                201)
            .get("id")
            .asLong();
    expect(post(API + "/workflows/" + wf + "/publish"), pm, 200);
    expect(patch(API + "/workflows/" + wf).content(json("enabled", true)), pm, 200);
    JsonNode body =
        expect(
            post(API + "/projects/" + key + "/issues")
                .content(json("title", "이슈", "assigneeIds", List.of(dev))),
            pm,
            0);
    long issue = body.get("id").asLong();

    List<Long> inResponse = new java.util.ArrayList<>();
    body.get("assignees").forEach(a -> inResponse.add(a.get("id").asLong()));
    assertThat(assignees(issue)).as("시작이 담당을 바꿔야 이 테스트가 뜻이 있다").hasSizeGreaterThan(1);
    assertThat(inResponse).containsExactlyInAnyOrderElementsOf(assignees(issue));
    // 시작이 더한 사람(other)은 배정 이벤트의 added 에 한 번만 — 두 번이면 배정 알림이 두 번 간다.
    long addedOther =
        events.stream(IssueAssignedEvent.class)
            .filter(e -> e.issueId() == issue)
            .flatMap(e -> e.added().stream())
            .filter(u -> u.id() == other)
            .count();
    assertThat(addedOther).isEqualTo(1);
  }

  @Test
  @DisplayName("옛 웹이 startWorkflowId 를 같이 보내도 실행은 하나만 생긴다")
  void putAssignees_legacyStartWorkflowId_noDoubleStart() {
    long issue = issue();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("userIds", List.of(dev));
    body.put("startWorkflowId", workflowId);

    expect(
        put(API + "/projects/" + key + "/issues/" + number(issue) + "/assignees")
            .content(om.writeValueAsString(body)),
        pm,
        200);

    assertThat(runCount(issue)).isEqualTo(1);
  }

  @Test
  @DisplayName("깨우지 않는 교체(반복 AI 작업 저장, wakeAgent=false)는 시작 조건이 맞아도 실행을 시작하지 않는다")
  void recurrenceAssign_wakeAgentFalse_noRun() {
    long issue = issue();

    assigneeService.replace(pm, key, number(issue), List.of(dev), false);

    assertThat(assignees(issue)).containsExactly(dev);
    assertThat(runCount(issue)).isZero();
  }

  @Test
  @DisplayName("미리보기 — 시작 역할 구성원이면 시작할 워크플로우 이름·머무는 단계 이름과 시작 역할을 돌려준다")
  void assignPreview_startRoleMember_returnsStartAndStage() {
    long issue = issue();

    JsonNode v = expect(previewReq(issue, List.of(dev)), pm, 200);

    assertThat(v.get("start").isNull()).as("%s", v).isFalse();
    assertThat(v.get("start").get("workflowId").asLong()).isEqualTo(workflowId);
    assertThat(v.get("start").get("workflowName").asString()).startsWith("흐름 ");
    assertThat(v.get("start").get("stageName").asString()).isEqualTo("dev");
    assertThat(v.get("startRoles")).hasSize(1);
    assertThat(v.get("startRoles").get(0).asString()).isEqualTo("developer");
  }

  @Test
  @DisplayName(
      "미리보기 current — 지금 담당이 이미 시작 조건에 맞으면(실행 없음) start 를 돌려준다, current 없이는 새로 더한 사람이 없어 null")
  void assignPreview_currentMode_matchingAssignee_returnsStart() {
    long issue = issue();
    // 워크플로우를 켜기 전에 지정된 담당처럼 — 자동 시작 없이 담당만 넣는다(WP-2120 코드 리뷰: 카드가 「지금 담당으로 시작될 수 있나」를 묻는 경우).
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issue)
        .set(ISSUE_ASSIGNEE.USER_ID, dev)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, pm)
        .execute();

    JsonNode current =
        expect(
            post(API + "/issues/" + issue + "/workflow/assign-preview")
                .content(json("userIds", List.of(dev), "current", true)),
            pm,
            200);
    JsonNode popover = expect(previewReq(issue, List.of(dev)), pm, 200);

    assertThat(current.get("start").isNull()).as("%s", current).isFalse();
    assertThat(current.get("start").get("stageName").asString()).isEqualTo("dev");
    assertThat(popover.get("start").isNull()).as("%s", popover).isTrue();
  }

  @Test
  @DisplayName("미리보기 — 시작 조건 밖의 사람이면 start 는 null 이고 시작 역할은 나열한다")
  void assignPreview_nonMatching_nullStart_rolesListed() {
    long issue = issue();

    JsonNode v = expect(previewReq(issue, List.of(other)), pm, 200);

    assertThat(v.get("start").isNull()).as("%s", v).isTrue();
    assertThat(v.get("startRoles").get(0).asString()).isEqualTo("developer");
  }

  @Test
  @DisplayName("미리보기는 담당·실행을 바꾸지 않는다")
  void assignPreview_doesNotChangeAssignees() {
    long issue = issue();

    expect(previewReq(issue, List.of(dev)), pm, 200);

    assertThat(assignees(issue)).isEmpty();
    assertThat(runCount(issue)).isZero();
  }

  @Test
  @DisplayName("미리보기 — TEAM 프로젝트의 비구성원(못 읽음)은 기존 view 와 같게 404")
  void assignPreview_outsiderCaller_notFound() {
    long issue = issue();
    // TEAM 프로젝트는 구성원·ADMIN 만 읽는다 — 이 호출자는 구성원이 아니다.
    long outsider = human();

    assertThat(status(get(API + "/issues/" + issue + "/workflow"), outsider)).isEqualTo(404);
    assertThat(status(previewReq(issue, List.of(dev)), outsider)).isEqualTo(404);
  }

  @Test
  @DisplayName("미리보기 — 담당 목록에 null 원소가 있으면 400")
  void assignPreview_nullElement_badRequest() {
    long issue = issue();
    java.util.List<Long> ids = new java.util.ArrayList<>();
    ids.add(dev);
    ids.add(null);

    assertThat(status(previewReq(issue, ids), pm)).isEqualTo(400);
  }

  @Test
  @DisplayName("미리보기 — 활성 실행이 있으면 active=true, 없으면 false")
  void assignPreview_active_flag() {
    long issue = issue();
    assertThat(expect(previewReq(issue, List.of(dev)), pm, 200).get("active").asBoolean())
        .isFalse();
    expect(assignReq(issue, List.of(dev)), pm, 200);

    JsonNode v = expect(previewReq(issue, List.of(dev, dev2)), pm, 200);

    assertThat(v.get("active").asBoolean()).isTrue();
    assertThat(v.get("start").isNull()).isTrue();
    assertThat(v.get("blocked").isNull()).isTrue();
  }

  @Test
  @DisplayName("미리보기 — 시작이 배정 위반 없이 가능하면 blocked 는 null")
  void assignPreview_startable_blockedNull() {
    long issue = issue();

    JsonNode v = expect(previewReq(issue, List.of(dev)), pm, 200);

    assertThat(v.get("blocked").isNull()).as("%s", v).isTrue();
  }

  @Test
  @DisplayName("옛 웹이 보낸 startWorkflowId — 교체 전부터 활성 실행이 있으면 409 이고 담당 교체도 되돌아간다")
  void putAssignees_legacyStartWorkflowId_activeBefore_conflict() {
    long issue = issue();
    expect(assignReq(issue, List.of(dev)), pm, 200);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("userIds", List.of(dev, dev2));
    body.put("startWorkflowId", workflowId);

    expect(
        put(API + "/projects/" + key + "/issues/" + number(issue) + "/assignees")
            .content(om.writeValueAsString(body)),
        pm,
        409);
  }

  // ───────────────────────── 도우미 ─────────────────────────

  private MockHttpServletRequestBuilder previewReq(long issue, List<Long> userIds) {
    return post(API + "/issues/" + issue + "/workflow/assign-preview")
        .content(json("userIds", userIds));
  }

  /** 응답 상태만 본다. */
  private int status(MockHttpServletRequestBuilder req, long caller) {
    req.contentType(MediaType.APPLICATION_JSON);
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L));
    try {
      return mvc.perform(req).andReturn().getResponse().getStatus();
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  /** 관리자가 담당을 넣어 만든 이슈 id. */
  private long issue(long... assigneeIds) {
    List<Long> ids = new java.util.ArrayList<>();
    for (long a : assigneeIds) {
      ids.add(a);
    }
    JsonNode body =
        expect(
            post(API + "/projects/" + key + "/issues")
                .content(json("title", "이슈", "assigneeIds", ids)),
            pm,
            0);
    return body.get("id").asLong();
  }

  private int number(long issue) {
    return dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issue)).fetchSingle().value1();
  }

  private MockHttpServletRequestBuilder assignReq(long issue, List<Long> userIds) {
    return put(API + "/projects/" + key + "/issues/" + number(issue) + "/assignees")
        .content(json("userIds", userIds));
  }

  private List<Long> assignees(long issue) {
    return dsl.select(ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issue))
        .fetch(ISSUE_ASSIGNEE.USER_ID);
  }

  private int runCount(long issue) {
    return dsl.fetchCount(WORKFLOW_RUN, WORKFLOW_RUN.ISSUE_ID.eq(issue));
  }

  private String json(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      map.put((String) pairs[i], pairs[i + 1]);
    }
    return om.writeValueAsString(map);
  }

  private JsonNode expect(MockHttpServletRequestBuilder req, long caller, int status) {
    req.contentType(MediaType.APPLICATION_JSON);
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L));
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      if (status == 0) {
        assertThat(response.getStatus()).as("%s", text).isBetween(200, 201);
      } else {
        assertThat(response.getStatus()).as("%s", text).isEqualTo(status);
      }
      return text.isBlank() ? null : om.readTree(text);
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }
}

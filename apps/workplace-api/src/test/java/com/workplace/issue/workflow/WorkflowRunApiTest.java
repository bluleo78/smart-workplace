package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW;
import static com.workplace.jooq.Tables.WORKFLOW_MOVE_IDEMPOTENCY;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_RUN_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeEntered;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowRunEnded;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowVisitLimitReached;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.notify.outbound.NotificationDispatcher;
import com.workplace.notify.service.NotificationService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
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
 * WP-1985 워크플로우 실행 REST(조회·시작·이동)의 계약과 순서·쓰기. 요청은 시험 트랜잭션에 합류하고 끝나면 롤백된다 — 실제 경합은 {@code
 * WorkflowRunConcurrencyTest} 가 커밋되는 트랜잭션으로 본다.
 *
 * <p>정의는 {@code spec-example.yaml} 의 구성원을 실제 사용자로 바꿔 게시한다. 이 트랜잭션 안에서는 커밋 뒤 리스너가 돌지 않으므로 도메인 이벤트는
 * {@link RecordApplicationEvents} 로 본다.
 */
@RecordApplicationEvents
@Transactional
class WorkflowRunApiTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ApplicationEvents events;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired NotificationService notificationService;

  /** 프로젝트 OWNER(관리자) — 역할에는 들지 않는다. */
  private long pm;

  private long lead;
  private long planner;
  private long dev1;
  private long dev2;
  private long owner;
  private String key;
  private long projectId;

  /** 예시 정의의 다섯 구성원과 관리자가 있는 TEAM 프로젝트. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    lead = human();
    planner = human();
    dev1 = human();
    dev2 = human();
    owner = human();
    key = newKey();
    projectId = newProject(key, pm);
    for (long id : List.of(lead, planner, dev1, dev2, owner)) {
      projectService.addMember(pm, key, new AddMemberRequest(id, "MEMBER"));
    }
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────── 시작 ─────────────────────────

  @Test
  @DisplayName("담당이 lead 면 triage 에서 RUNNING·revision 0 으로 시작한다")
  void start_leadAssignee_goesToTriage() {
    long wf = publish(spec());
    long issue = issue(lead);

    JsonNode v = ok(startReq(issue, wf, false), lead);

    assertThat(v.get("runId").isNull()).isFalse();
    assertThat(v.get("status").asString()).isEqualTo("RUNNING");
    assertThat(v.get("revision").asInt()).isZero();
    assertThat(v.get("workflowId").asLong()).isEqualTo(wf);
    assertThat(v.get("versionNo").asInt()).isEqualTo(1);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("triage");
    assertThat(v.get("currentNode").get("nodeRunStatus").asString()).isEqualTo("ACTIVE");
    assertThat(ids(v.get("currentNode").get("assignees"))).containsExactly(lead);
    assertThat(v.get("currentNode").get("instructions").asString()).contains("이슈를 읽고");
    assertThat(keys(v.get("outcomes"))).containsExactly("need_plan", "ready");
    assertThat(v.get("path").get(0).get("key").asString()).isEqualTo("start");
    // 이동 하나·시작 하나에 이슈 갱신 알림(SSE)은 한 번.
    assertThat(issueChanges()).isEqualTo(1);
    assertThat(events.stream(WorkflowNodeEntered.class)).hasSize(1);
  }

  @Test
  @DisplayName("담당이 developer 면 dev 로 시작한다")
  void start_developerAssignee_goesToDev() {
    long wf = publish(spec());
    JsonNode v = ok(startReq(issue(dev1), wf, false), dev1);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("dev");
    assertThat(ids(v.get("currentNode").get("assignees"))).containsExactly(dev1);
  }

  @Test
  @DisplayName("여러 역할의 담당이면 위의 start 조건이 이기고, 그 조건에 맞은 사람만 노드 담당이다")
  void start_multiRole_firstConditionWins() {
    long wf = publish(spec());
    JsonNode v = ok(startReq(issue(dev1, lead), wf, false), dev1);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("triage");
    assertThat(ids(v.get("currentNode").get("assignees"))).containsExactly(lead);
  }

  @Test
  @DisplayName("어느 start 조건에도 맞는 담당이 없으면 422 WORKFLOW_NO_START_MATCH")
  void start_noMatch_422() {
    long wf = publish(spec());
    assertCode(expect(startReq(issue(pm), wf, false), pm, 422), "WORKFLOW_NO_START_MATCH");
    assertCode(expect(startReq(issue(), wf, false), pm, 422), "WORKFLOW_NO_START_MATCH");
  }

  @Test
  @DisplayName("dryRun 은 runId null 인 view 만 돌려주고 네 표·담당·이벤트를 바꾸지 않는다")
  void start_dryRun_savesNothing() {
    // lead 로 시작해 한 명뿐인 planner 노드에 머무는 정의 — 실제 시작이면 planner 가 담당에 들어간다(설계 §6).
    long wf = publish(soleMemberYaml());
    long issue = issue(lead);

    JsonNode v = ok(startReq(issue, wf, true), lead);

    assertThat(v.get("runId").isNull()).isTrue();
    assertThat(v.get("revision").asInt()).isZero();
    assertThat(v.get("status").asString()).isEqualTo("RUNNING");
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("plan");
    assertThat(ids(v.get("currentNode").get("assignees"))).containsExactly(planner);
    assertThat(rowCount(issue)).isZero();
    assertThat(issueAssignees(issue)).containsExactly(lead);
    assertThat(issueChanges()).isZero();
    assertThat(events.stream(WorkflowNodeEntered.class)).isEmpty();

    // 같은 이슈의 실제 시작은 planner 를 넣고 워크플로우가 넣은 사람으로 적는다.
    JsonNode real = ok(startReq(issue, wf, false), lead);
    assertThat(real.get("currentNode").get("key").asString()).isEqualTo("plan");
    assertThat(issueAssignees(issue)).containsExactlyInAnyOrder(lead, planner);
    assertThat(latestNodeRun(issue, "plan").get(NODE_RUN.WORKFLOW_ASSIGNED_IDS))
        .containsExactly(planner);
  }

  @Test
  @DisplayName("활성 실행이 있으면 두 번째 시작은 409 WORKFLOW_ALREADY_ACTIVE")
  void start_secondActiveRun_409() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    assertCode(expect(startReq(issue, wf, false), lead, 409), "WORKFLOW_ALREADY_ACTIVE");
  }

  @Test
  @DisplayName("다른 프로젝트의 workflowId 는 404 WORKFLOW_NOT_FOUND 이고 내용을 드러내지 않는다")
  void start_otherProjectWorkflow_404() {
    String otherKey = newKey();
    long otherProject = newProject(otherKey, pm);
    for (long id : List.of(lead, planner, dev1, dev2, owner)) {
      projectService.addMember(pm, otherKey, new AddMemberRequest(id, "MEMBER"));
    }
    long otherWf = publishIn(otherProject, spec());
    JsonNode body = expect(startReq(issue(lead), otherWf, false), lead, 404);
    assertCode(body, "WORKFLOW_NOT_FOUND");
    assertThat(body.toString()).doesNotContain("triage");
  }

  @Test
  @DisplayName("꺼진 워크플로우는 409 WORKFLOW_DISABLED")
  void start_disabled_409() {
    long wf = publish(spec());
    ok(patchReq(wf, false), pm);
    assertCode(expect(startReq(issue(lead), wf, false), lead, 409), "WORKFLOW_DISABLED");
  }

  @Test
  @DisplayName("닫힌 이슈는 409 WORKFLOW_ISSUE_CLOSED")
  void start_closedIssue_409() {
    long wf = publish(spec());
    long issue = issue(lead);
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(projectId, "DONE"))
        .where(ISSUE.ID.eq(issue))
        .execute();
    assertCode(expect(startReq(issue, wf, false), lead, 409), "WORKFLOW_ISSUE_CLOSED");
  }

  @Test
  @DisplayName("게시된 버전이 없는 워크플로우의 시작은 409 WORKFLOW_NOT_PUBLISHED 와 시작용 문구")
  void start_notPublished_409_startMessage() {
    long wf = publish(spec());
    // 켜진 채 게시 버전이 지워진 상태(FK ON DELETE SET NULL) — 켜기와 달리 시작 문구로 알린다.
    dsl.update(WORKFLOW).setNull(WORKFLOW.ACTIVE_VERSION_ID).where(WORKFLOW.ID.eq(wf)).execute();

    JsonNode body = expect(startReq(issue(lead), wf, false), lead, 409);

    assertCode(body, "WORKFLOW_NOT_PUBLISHED");
    assertThat(body.get("message").asString()).isEqualTo("게시된 버전이 없는 워크플로우로는 실행을 시작할 수 없습니다.");
  }

  @Test
  @DisplayName("시작하자마자 end 에 닿으면 COMPLETED·ended_at·RunEnded 1 건이고 revision 은 1(끝난 시각을 남기는 갱신 한 번)")
  void start_immediateEnd_completed() {
    long wf = publish(immediateEndYaml(username(owner)));
    long issue = issue(owner);

    JsonNode v = ok(startReq(issue, wf, false), owner);

    assertThat(v.get("status").asString()).isEqualTo("COMPLETED");
    assertThat(v.get("revision").asInt()).isEqualTo(1);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("end");
    assertThat(v.get("outcomes")).isEmpty();
    assertThat(
            dsl.select(WORKFLOW_RUN.ENDED_AT, WORKFLOW_RUN.REVISION)
                .from(WORKFLOW_RUN)
                .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
                .fetchSingle())
        .satisfies(
            r -> {
              assertThat(r.value1()).isNotNull();
              assertThat(r.value2()).isEqualTo(1);
            });
    assertThat(events.stream(WorkflowRunEnded.class)).hasSize(1);
    assertThat(events.stream(WorkflowNodeEntered.class)).isEmpty();
    assertThat(eventTypes(issue)).containsExactly("RUN_STARTED", "AUTO_MOVED", "RUN_COMPLETED");
    assertThat(payloads(issue, "RUN_COMPLETED").getFirst().get("node").asString()).isEqualTo("end");
    assertThat(issueAssignees(issue)).containsExactly(owner);
  }

  // ───────────────────────── 이동 ─────────────────────────

  @Test
  @DisplayName("triage ready → dev: 고른 developer 가 담당이 되고 revision 1, 사람이 넣은 lead 는 남는다")
  void move_triageReady_assignsDeveloper_andRevisionIncrements() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    events.clear();

    JsonNode v = ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), lead);

    assertThat(v.get("revision").asInt()).isEqualTo(1);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("dev");
    assertThat(ids(v.get("currentNode").get("assignees"))).containsExactly(dev1);
    assertThat(issueAssignees(issue)).containsExactlyInAnyOrder(lead, dev1);
    assertThat(issueChanges()).isEqualTo(1);
    // dev 의 requiredOutputs·결과
    JsonNode submitted = v.get("outcomes").get(0);
    assertThat(submitted.get("key").asString()).isEqualTo("submitted");
    assertThat(submitted.get("requiredOutputs").get(0).get("key").asString()).isEqualTo("prUrl");
    JsonNode ask = v.get("outcomes").get(1);
    assertThat(ask.get("requiredOutputs")).isEmpty();
  }

  @Test
  @DisplayName("이동은 워크플로우가 넣은 담당만 빼고 사람이 넣은 담당은 남긴다")
  void move_removesOnlyWorkflowAssigned() {
    long wf = publish(spec());
    long issue = issue(lead, dev2);
    ok(startReq(issue, wf, false), lead);
    ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), lead);
    assertThat(issueAssignees(issue)).containsExactlyInAnyOrder(lead, dev2, dev1);

    JsonNode v =
        ok(
            moveReq(
                issue,
                "dev",
                "submitted",
                Map.of("prUrl", "https://x.test/pr/1"),
                null,
                null,
                1,
                "k2"),
            dev1);

    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("review");
    assertThat(issueAssignees(issue)).containsExactlyInAnyOrder(lead, dev2);
  }

  @Test
  @DisplayName("같은 사람이 떠나는 노드(워크플로우가 넣음)와 다음 노드의 담당이면 넣고 빼기가 겹치지 않고 담당으로 남는다")
  void move_sameUserLeavingAndNext_noOverlap() {
    // dev1 이 developer 이자 lead 인 정의.
    String yaml =
        spec()
            .replace(
                "members: [" + username(lead) + "]",
                "members: [" + username(lead) + ", " + username(dev1) + "]");
    long wf = publish(yaml);
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), lead);

    // dev → review(lead 역할): pool = lead ∩ lead = [lead, dev1] → dev1 을 고른다(W 에 있던 사람이 N 에도).
    JsonNode v =
        ok(
            moveReq(
                issue,
                "dev",
                "submitted",
                Map.of("prUrl", "https://x.test/pr/1"),
                List.of(dev1),
                null,
                1,
                "k2"),
            dev1);

    assertThat(ids(v.get("currentNode").get("assignees"))).containsExactly(dev1);
    assertThat(issueAssignees(issue)).containsExactlyInAnyOrder(lead, dev1);
    assertThat(latestNodeRun(issue, "review").get(NODE_RUN.WORKFLOW_ASSIGNED_IDS))
        .containsExactly(dev1);
  }

  @Test
  @DisplayName("decision 은 같은 요청에서 자동으로 지나 머무는 노드까지 가고 revision 은 1 만 는다")
  void decision_autoMovesInSameRequest() {
    long wf = publish(decisionYaml());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);

    JsonNode v =
        ok(moveReq(issue, "triage", "go", Map.of("size", "big"), null, null, 0, "k1"), lead);

    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("plan");
    assertThat(v.get("revision").asInt()).isEqualTo(1);
    assertThat(ids(v.get("currentNode").get("assignees"))).containsExactly(planner);
    assertThat(keys(v.get("path"))).containsExactly("start", "triage", "route");
    assertThat(v.get("context").get("triage").get("size").asString()).isEqualTo("big");
    assertThat(eventTypes(issue)).containsExactly("RUN_STARTED", "MOVED", "AUTO_MOVED");
    JsonNode auto = payloads(issue, "AUTO_MOVED").getFirst();
    assertThat(auto.get("from").asString()).isEqualTo("route");
    assertThat(auto.get("to").asString()).isEqualTo("plan");
  }

  @Test
  @DisplayName("질문 → 답: WAITING 이었다가 같은 개발자에게 돌아가 RUNNING, context._qa 에 질문·답, 확인자는 담당에서 빠진다")
  void ask_thenAnswered_returnsToDevWithSameAgent_andContextHasQA() {
    long wf = publish(spec());
    long issue = issue(dev1);
    ok(startReq(issue, wf, false), dev1);

    JsonNode asked = ok(moveReq(issue, "dev", "ask", null, null, "어느 API 를 쓰나요?", 0, "q1"), dev1);
    assertThat(asked.get("status").asString()).isEqualTo("WAITING");
    assertThat(asked.get("currentNode").get("key").asString()).isEqualTo("dev_ask");
    assertThat(ids(asked.get("currentNode").get("assignees"))).containsExactly(owner);
    assertThat(issueAssignees(issue)).containsExactlyInAnyOrder(dev1, owner);
    // 답 결과는 keep — 질문한 개발자가 기준이라 고를 필요가 없다.
    JsonNode answered = asked.get("outcomes").get(0);
    assertThat(ids(answered.get("candidateAssignees"))).containsExactly(dev1);
    assertThat(answered.get("assigneeRequired").asBoolean()).isFalse();

    JsonNode back =
        ok(moveReq(issue, "dev_ask", "answered", null, null, "v2 를 쓰세요", 1, "a1"), owner);

    assertThat(back.get("status").asString()).isEqualTo("RUNNING");
    assertThat(back.get("currentNode").get("key").asString()).isEqualTo("dev");
    assertThat(ids(back.get("currentNode").get("assignees"))).containsExactly(dev1);
    JsonNode qa = back.get("context").get("_qa").get(0);
    assertThat(qa.get("askNode").asString()).isEqualTo("dev");
    assertThat(qa.get("answerNode").asString()).isEqualTo("dev_ask");
    assertThat(qa.get("question").asString()).isEqualTo("어느 API 를 쓰나요?");
    assertThat(qa.get("askedBy").asLong()).isEqualTo(dev1);
    assertThat(qa.get("answer").asString()).isEqualTo("v2 를 쓰세요");
    assertThat(qa.get("answeredBy").asLong()).isEqualTo(owner);
    assertThat(issueAssignees(issue)).containsExactly(dev1);
    assertThat(latestNodeRun(issue, "dev").get(NODE_RUN.VIA_RETURN)).isTrue();
    // 조회는 이동 응답(멱등 저장 본문)과 같다.
    assertThat(ok(get(viewPath(issue)), dev2)).isEqualTo(back);
  }

  @Test
  @DisplayName("maxVisits 3 인 review 에 세 번째로 들어가면 알림 이벤트 1 건을 내고 이동은 한다")
  void maxVisits_thirdEntry_notifiesOwner_butMoves() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "m0"), lead);
    int rev = 1;
    JsonNode v = null;
    for (int i = 1; i <= 3; i++) {
      v =
          ok(
              moveReq(
                  issue,
                  "dev",
                  "submitted",
                  Map.of("prUrl", "https://x.test/" + i),
                  null,
                  null,
                  rev++,
                  "s" + i),
              dev1);
      if (i < 3) {
        assertThat(events.stream(WorkflowVisitLimitReached.class)).isEmpty();
        ok(moveReq(issue, "review", "changes", null, null, null, rev++, "c" + i), lead);
      }
    }

    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("review");
    List<WorkflowVisitLimitReached> limits =
        events.stream(WorkflowVisitLimitReached.class).toList();
    assertThat(limits).hasSize(1);
    assertThat(limits.getFirst().nodeKey()).isEqualTo("review");
    assertThat(limits.getFirst().visits()).isEqualTo(3);
    assertThat(limits.getFirst().actorId()).isEqualTo(dev1);
    assertThat(eventTypes(issue)).filteredOn("VISIT_LIMIT"::equals).hasSize(1);
    JsonNode limit = payloads(issue, "VISIT_LIMIT").getFirst();
    assertThat(limit.get("node").asString()).isEqualTo("review");
    assertThat(limit.get("visits").asInt()).isEqualTo(3);
    assertThat(limit.get("maxVisits").asInt()).isEqualTo(3);

    // 알림(설계 §10): 이 시험 트랜잭션은 커밋되지 않아 커밋 뒤 리스너가 돌지 않는다 — dispatcher 를 직접 부른다. 스프링 빈은 @Async 프록시라
    // 다른 스레드(커밋 안 된 행을 못 봄)에서 돌므로, 같은 서비스로 새로 만든 dispatcher 를 이 스레드에서 부른다.
    directDispatcher().onWorkflowVisitLimitReached(limits.getFirst());
    // 받는 사람은 프로젝트의 사람 OWNER(pm)뿐 — 역할 구성원(MEMBER)·행위자 dev1 은 받지 않는다.
    assertThat(visitLimitRecipients(issue)).containsExactly(pm);
    assertThat(
            dsl.select(NOTIFICATION.ACTOR_ID)
                .from(NOTIFICATION)
                .where(NOTIFICATION.ISSUE_ID.eq(issue))
                .and(NOTIFICATION.TYPE.eq("WORKFLOW_VISIT_LIMIT"))
                .fetch(NOTIFICATION.ACTOR_ID))
        .containsExactly(dev1);
  }

  @Test
  @DisplayName("되돌림 한도 알림은 프로젝트의 활성 사람 OWNER 만 받는다 — AI OWNER·비활성 OWNER·MEMBER·행위자 제외")
  void visitLimit_notifiesActiveHumanOwners_exceptActor() {
    long issue = issue(lead);
    // 행위자도 활성 사람 OWNER 로 둔다 — 다른 걸러내기가 아니라 「행위자 제외」 규칙으로 빠지는지 보려고.
    long actor = human();
    projectService.addMember(pm, key, new AddMemberRequest(actor, "OWNER"));
    long aiOwner = withMembership(TestFixtures.createAgentNoToken(dsl));
    projectService.addMember(pm, key, new AddMemberRequest(aiOwner, "OWNER"));
    long suspendedOwner = human();
    projectService.addMember(pm, key, new AddMemberRequest(suspendedOwner, "OWNER"));
    // 멤버로 넣은 뒤 정지 — 이슈 열람 필터는 활성 여부를 보지 않으므로, 이 사람은 OWNER 조회의 활성 조건으로만 빠진다.
    TestFixtures.suspendMember(dsl, suspendedOwner, 1L);
    TenantContext.set(1L);

    directDispatcher()
        .onWorkflowVisitLimitReached(
            new WorkflowVisitLimitReached(1L, 1L, issue, "review", 3, actor));

    // pm 이 유일한 활성 사람 OWNER(행위자 제외). lead·dev1 등 MEMBER 는 받지 않는다.
    assertThat(visitLimitRecipients(issue)).containsExactly(pm);
  }

  @Test
  @DisplayName("되돌림(returnTo) 방문은 maxVisits 에 세지 않는다")
  void returnVisit_notCountedForMaxVisits() {
    String yaml =
        spec()
            .replace(
                "    outputs: { prUrl: { type: url, required: true } }\n",
                "    outputs: { prUrl: { type: url, required: true } }\n    maxVisits: 2\n");
    long wf = publish(yaml);
    long issue = issue(dev1);
    ok(startReq(issue, wf, false), dev1);
    int rev = 0;
    for (int i = 0; i < 2; i++) {
      ok(moveReq(issue, "dev", "ask", null, null, "질문 " + i, rev++, "q" + i), dev1);
      ok(moveReq(issue, "dev_ask", "answered", null, null, "답 " + i, rev++, "a" + i), owner);
    }
    assertThat(events.stream(WorkflowVisitLimitReached.class)).isEmpty();
    assertThat(eventTypes(issue)).doesNotContain("VISIT_LIMIT");
  }

  @Test
  @DisplayName("end 에 닿으면 실행 COMPLETED·ended_at·RunEnded 1 건, 이슈 상태는 그대로, outcomes 는 빈 목록")
  void endReached_runCompleted_issueStatusUnchanged() {
    long wf = publish(simpleYaml(username(owner)));
    long issue = issue(owner);
    var before =
        dsl.select(ISSUE.STATUS, ISSUE.STATUS_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(issue))
            .fetchSingle();
    JsonNode started = ok(startReq(issue, wf, false), owner);
    assertThat(started.get("status").asString()).isEqualTo("WAITING");

    JsonNode v = ok(moveReq(issue, "work", "done", null, null, null, 0, "d1"), owner);

    assertThat(v.get("status").asString()).isEqualTo("COMPLETED");
    assertThat(v.get("outcomes")).isEmpty();
    assertThat(v.get("remainingNodeKeys")).isEmpty();
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("end");
    assertThat(
            dsl.select(WORKFLOW_RUN.ENDED_AT)
                .from(WORKFLOW_RUN)
                .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
                .fetchSingle()
                .value1())
        .isNotNull();
    assertThat(events.stream(WorkflowRunEnded.class)).hasSize(1);
    var after =
        dsl.select(ISSUE.STATUS, ISSUE.STATUS_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(issue))
            .fetchSingle();
    assertThat(after).isEqualTo(before);
    assertThat(eventTypes(issue)).endsWith("RUN_COMPLETED");
    assertThat(payloads(issue, "RUN_COMPLETED").getFirst().get("node").asString()).isEqualTo("end");
    // 끝난 실행도 조회는 가장 최근 실행을 보인다.
    JsonNode seen = ok(get(viewPath(issue)), pm);
    assertThat(seen.get("status").asString()).isEqualTo("COMPLETED");
    assertThat(seen.get("currentNode").get("key").asString()).isEqualTo("end");
    assertThat(seen.get("outcomes")).isEmpty();
    assertThat(seen.get("remainingNodeKeys")).isEmpty();
    // 끝난 실행에는 더 이동할 수 없다.
    assertCode(
        expect(moveReq(issue, "end", "x", null, null, null, 1, "d2"), owner, 409),
        "WORKFLOW_NOT_ACTIVE");
  }

  @Test
  @DisplayName("새 버전을 게시해도 진행 중 실행은 옛 버전으로 간다(새 버전에 지금 노드가 없어도)")
  void publishNewVersion_runningRunKeepsOldVersion() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    ok(
        put(API + "/workflows/" + wf + "/draft")
            .content(json("yaml", spec().replace("triage", "sorting"))),
        pm);
    ok(post(API + "/workflows/" + wf + "/publish"), pm);

    JsonNode v = ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), lead);

    assertThat(v.get("versionNo").asInt()).isEqualTo(1);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("dev");
  }

  @Test
  @DisplayName("이동마다 실행 이벤트를 남긴다 — MOVED 의 from·to·outcome·override·added·removed")
  void eventsRecorded_forEveryMove() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), lead);
    ok(
        moveReq(
            issue, "dev", "submitted", Map.of("prUrl", "https://x.test/1"), null, null, 1, "k2"),
        dev1);

    assertThat(eventTypes(issue)).containsExactly("RUN_STARTED", "MOVED", "MOVED");
    List<JsonNode> moved = payloads(issue, "MOVED");
    JsonNode first = moved.get(0);
    assertThat(first.get("from").asString()).isEqualTo("triage");
    assertThat(first.get("to").asString()).isEqualTo("dev");
    assertThat(first.get("outcome").asString()).isEqualTo("ready");
    assertThat(first.get("override").asBoolean()).isFalse();
    assertThat(longs(first.get("added"))).containsExactly(dev1);
    assertThat(first.get("removed")).isEmpty();
    JsonNode second = moved.get(1);
    assertThat(longs(second.get("added"))).isEmpty();
    assertThat(longs(second.get("removed"))).containsExactly(dev1);
    JsonNode started = payloads(issue, "RUN_STARTED").getFirst();
    assertThat(started.get("workflowId").asLong()).isEqualTo(wf);
    assertThat(started.get("to").asString()).isEqualTo("triage");
  }

  @Test
  @DisplayName("NodeEntered 는 머무는 노드에만 — start·decision 에는 내지 않는다")
  void nodeEntered_onlyForStoppingNodes() {
    long wf = publish(decisionYaml());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    ok(moveReq(issue, "triage", "go", Map.of("size", "small"), null, null, 0, "k1"), lead);

    List<WorkflowNodeEntered> entered = events.stream(WorkflowNodeEntered.class).toList();
    assertThat(entered).extracting(WorkflowNodeEntered::nodeKey).containsExactly("triage", "dev");
    assertThat(entered.get(1).assigneeIds()).containsExactly(dev1);
    assertThat(entered.get(1).nodeType()).isEqualTo("agent_task");
  }

  @Test
  @DisplayName("사람이 이슈에서 뺀 담당은 node_run 에 남아 있어도 넘길 수 없고 담당도 되살아나지 않는다")
  void removedAssignee_cannotMove() {
    long wf = publish(spec());
    long issue = issue(lead, dev2);
    ok(startReq(issue, wf, false), lead);
    // 사람이 담당 교체 API 로 lead 를 뺀다(실행 중 이슈라도 담당 교체는 막지 않는다).
    ok(
        put(API + "/projects/" + key + "/issues/" + number(issue) + "/assignees")
            .content(json("userIds", List.of(dev2))),
        pm);

    assertCode(
        expect(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), lead, 403),
        "WORKFLOW_NOT_ASSIGNEE");
    assertThat(issueAssignees(issue)).containsExactly(dev2);
  }

  @Test
  @DisplayName("프로젝트 구성원이 아니면 시작·이동 모두 못 한다(못 보는 프로젝트라 404)")
  void nonMember_cannotStartOrMove() {
    long wf = publish(spec());
    long issue = issue(lead);
    long stranger = human();
    expect(startReq(issue, wf, false), stranger, 404);
    ok(startReq(issue, wf, false), lead);
    expect(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), stranger, 404);
    assertThat(rowCountOf(WORKFLOW_RUN_EVENT, issue)).isEqualTo(1);
  }

  @Test
  @DisplayName("못 보는 프로젝트 이슈의 시작·이동 404 본문은 없는 이슈의 404 본문과 같다")
  void hiddenIssue_sameBodyAsMissingIssue() {
    long wf = publish(spec());
    long issue = issue(lead);
    long stranger = human();
    long missing = 999_999_999L;
    JsonNode hiddenStart = expect(startReq(issue, wf, false), stranger, 404);
    JsonNode missingStart = expect(startReq(missing, wf, false), stranger, 404);
    assertThat(hiddenStart.path("message")).isEqualTo(missingStart.path("message"));
    assertThat(hiddenStart.path("code")).isEqualTo(missingStart.path("code"));
    assertThat(hiddenStart.path("message").toString()).isNotEqualTo("\"\"");
    ok(startReq(issue, wf, false), lead);
    JsonNode hiddenMove =
        expect(
            moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), stranger, 404);
    JsonNode missingMove =
        expect(
            moveReq(missing, "triage", "ready", null, List.of(dev1), null, 0, "k1"), stranger, 404);
    assertThat(hiddenMove.path("message")).isEqualTo(missingMove.path("message"));
    assertThat(hiddenMove.path("code")).isEqualTo(missingMove.path("code"));
  }

  @Test
  @DisplayName("못 보는 프로젝트의 이슈 실행 조회는 404")
  void privateProject_view404() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    long stranger = human();
    JsonNode body = expect(get(viewPath(issue)), stranger, 404);
    assertThat(body.toString()).doesNotContain("triage");
  }

  @Test
  @DisplayName("담당이 아닌 관리자의 이동은 override:true 로 남는다")
  void move_managerOverride_recorded() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    // 일반 구성원(담당 아님)은 403.
    assertCode(
        expect(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k0"), planner, 403),
        "WORKFLOW_NOT_ASSIGNEE");

    ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), pm);

    assertThat(payloads(issue, "MOVED").getFirst().get("override").asBoolean()).isTrue();
    assertThat(latestNodeRun(issue, "triage").get(NODE_RUN.ACTOR_ID)).isEqualTo(pm);
  }

  // ───────────────────────── 멱등 ─────────────────────────

  @Test
  @DisplayName("end 에 닿은 이동의 재시도는 NOT_ACTIVE 가 아니라 첫 결과")
  void retryAfterEnd_returnsFirstResult() {
    long wf = publish(simpleYaml(username(owner)));
    long issue = issue(owner);
    ok(startReq(issue, wf, false), owner);
    JsonNode first = ok(moveReq(issue, "work", "done", null, null, null, 0, "same"), owner);

    JsonNode retry = ok(moveReq(issue, "work", "done", null, null, null, 0, "same"), owner);

    assertThat(retry).isEqualTo(first);
    assertThat(eventTypes(issue)).filteredOn("MOVED"::equals).hasSize(1);
  }

  @Test
  @DisplayName(
      "실행 A 를 끝낸 이동의 응답을 잃은 사이 실행 B 가 시작돼도 A 의 runId 를 실은 같은 key 재시도는 A 의 첫 응답이고 B 는 움직이지 않는다")
  void retryAfterNewRun_returnsFirstResultOfEndedRun() {
    long wf = publish(simpleYaml(username(owner)));
    long issue = issue(owner);
    ok(startReq(issue, wf, false), owner);
    JsonNode first = ok(moveReq(issue, "work", "done", null, null, null, 0, "K"), owner);
    assertThat(first.get("status").asString()).isEqualTo("COMPLETED");
    long runA = first.get("runId").asLong();
    JsonNode runB = ok(startReq(issue, wf, false), owner);
    assertThat(runB.get("runId").asLong()).isNotEqualTo(runA);

    JsonNode retry = ok(moveReq(issue, "work", "done", null, null, null, 0, "K", runA), owner);

    assertThat(retry).isEqualTo(first);
    JsonNode seen = ok(get(viewPath(issue)), owner);
    assertThat(seen.get("runId").asLong()).isEqualTo(runB.get("runId").asLong());
    assertThat(seen.get("revision").asInt()).isZero();
    assertThat(seen.get("currentNode").get("key").asString()).isEqualTo("work");
    // 다른 요청자가 옛 실행 A 의 key 를 겨누면 지금 실행(B) 기준의 409 STALE.
    JsonNode stale =
        expect(moveReq(issue, "work", "done", null, null, null, 0, "K", runA), pm, 409);
    assertCode(stale, "WORKFLOW_STALE");
    assertThat(stale.get("errors").get("currentNode").asString()).isEqualTo("work");
    assertThat(stale.get("errors").get("revision").asString()).isEqualTo("0");
  }

  @Test
  @DisplayName("결정적 key 재사용 — 실행 A 에서 쓴 key 로 같은 요청자가 runId 없이 실행 B 를 이동하면 B 가 실제로 움직인다")
  void deterministicKey_reusedInNewRun_sameActor_movesNewRun() {
    long wf = publish(simpleYaml(username(owner)));
    long issue = issue(owner);
    ok(startReq(issue, wf, false), owner);
    JsonNode first = ok(moveReq(issue, "work", "done", null, null, null, 0, "K"), owner);
    long runB = ok(startReq(issue, wf, false), owner).get("runId").asLong();

    JsonNode moved = ok(moveReq(issue, "work", "done", null, null, null, 0, "K"), owner);

    assertThat(moved).isNotEqualTo(first);
    assertThat(moved.get("runId").asLong()).isEqualTo(runB);
    assertThat(moved.get("status").asString()).isEqualTo("COMPLETED");
    assertThat(moved.get("revision").asInt()).isEqualTo(1);
    assertThat(eventTypes(issue)).filteredOn("MOVED"::equals).hasSize(2);
  }

  @Test
  @DisplayName("결정적 key 재사용 — 실행 A 에서 쓴 key 로 다른 요청자가 B 의 runId 를 실어 B 를 이동하면 STALE 이 아니라 200")
  void deterministicKey_reusedInNewRun_otherActor_movesNewRun() {
    long wf = publish(simpleYaml(username(owner)));
    long issue = issue(owner);
    ok(startReq(issue, wf, false), owner);
    ok(moveReq(issue, "work", "done", null, null, null, 0, "K"), owner);
    long runB = ok(startReq(issue, wf, false), owner).get("runId").asLong();

    // pm 은 관리자라 담당이 아니어도 이동할 수 있다(override).
    JsonNode moved = ok(moveReq(issue, "work", "done", null, null, null, 0, "K", runB), pm);

    assertThat(moved.get("runId").asLong()).isEqualTo(runB);
    assertThat(moved.get("status").asString()).isEqualTo("COMPLETED");
  }

  @Test
  @DisplayName("옛 실행을 겨눈 새 key 는 새 이동으로 받지 않고 지금 실행 기준 409 WORKFLOW_STALE")
  void oldRunTarget_newKey_409Stale() {
    long wf = publish(simpleYaml(username(owner)));
    long issue = issue(owner);
    ok(startReq(issue, wf, false), owner);
    long runA =
        ok(moveReq(issue, "work", "done", null, null, null, 0, "K"), owner).get("runId").asLong();
    ok(startReq(issue, wf, false), owner);

    JsonNode stale =
        expect(moveReq(issue, "work", "done", null, null, null, 0, "fresh", runA), owner, 409);

    assertCode(stale, "WORKFLOW_STALE");
    assertThat(stale.get("errors").get("currentNode").asString()).isEqualTo("work");
    assertThat(stale.get("errors").get("revision").asString()).isEqualTo("0");
    assertThat(eventTypes(issue)).filteredOn("MOVED"::equals).hasSize(1);
  }

  @Test
  @DisplayName("다른 이슈의 runId·없는 runId 를 겨누면 404 가 아니라 409 WORKFLOW_STALE")
  void otherIssueRunTarget_409Stale() {
    long wf = publish(simpleYaml(username(owner)));
    long issue = issue(owner);
    long other = issue(owner);
    ok(startReq(issue, wf, false), owner);
    long otherRun = ok(startReq(other, wf, false), owner).get("runId").asLong();

    JsonNode stale =
        expect(moveReq(issue, "work", "done", null, null, null, 0, "k", otherRun), owner, 409);
    assertCode(stale, "WORKFLOW_STALE");
    JsonNode missing =
        expect(
            moveReq(issue, "work", "done", null, null, null, 0, "k", Long.MAX_VALUE), owner, 409);
    assertCode(missing, "WORKFLOW_STALE");

    assertThat(eventTypes(issue)).containsExactly("RUN_STARTED");
    assertThat(eventTypes(other)).containsExactly("RUN_STARTED");
  }

  @Test
  @DisplayName("다른 요청자가 같은 key 를 보내면 첫 응답이 아니라 409 WORKFLOW_STALE")
  void sameKey_otherActor_409Stale() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "shared-key"), lead);

    JsonNode body =
        expect(
            moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "shared-key"), pm, 409);

    assertCode(body, "WORKFLOW_STALE");
    assertThat(body.get("errors").get("currentNode").asString()).isEqualTo("dev");
    assertThat(body.get("errors").get("revision").asString()).isEqualTo("1");
  }

  @Test
  @DisplayName("assignTo 역할 밖 id 로 decision 을 end 로 몰면 422 NOT_IN_ROLE 이고 실행은 끝나지 않는다")
  void outsideRoleIds_cannotSteerDecisionToEnd() {
    long wf = publish(steerableYaml());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);

    // owner 는 developer 가 아니다 — 기준으로 쓰였다면 route 가 end 로 보내 실행이 끝났다.
    JsonNode body =
        expect(moveReq(issue, "triage", "go", null, List.of(owner), null, 0, "k"), lead, 422);

    assertCode(body, "WORKFLOW_ASSIGNEE_NOT_IN_ROLE");
    JsonNode seen = ok(get(viewPath(issue)), lead);
    assertThat(seen.get("status").asString()).isNotEqualTo("COMPLETED");
    assertThat(seen.get("currentNode").get("key").asString()).isEqualTo("triage");
    assertThat(seen.get("revision").asInt()).isZero();
  }

  @Test
  @DisplayName("실패한 이동은 멱등 저장하지 않아 같은 key 로 고쳐 다시 보낼 수 있다")
  void failedMove_notStoredForRetry() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);

    JsonNode failed =
        expect(moveReq(issue, "triage", "ready", null, null, null, 0, "k"), lead, 422);
    assertCode(failed, "WORKFLOW_ASSIGNEE_REQUIRED");
    assertThat(failed.get("errors").get("role").asString()).isEqualTo("developer");
    assertThat(failed.get("errors").get("candidates").asString())
        .isEqualTo(username(dev1) + "," + username(dev2));
    assertThat(rowCountOf(WORKFLOW_MOVE_IDEMPOTENCY, issue)).isZero();

    JsonNode v = ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k"), lead);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("dev");
    assertThat(rowCountOf(WORKFLOW_MOVE_IDEMPOTENCY, issue)).isEqualTo(1);
  }

  @Test
  @DisplayName("idempotencyKey·expectedRevision 이 빠지면 400")
  void missingKeyOrRevision_400() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    Map<String, Object> noKey = new LinkedHashMap<>();
    noKey.put("fromNode", "triage");
    noKey.put("outcome", "ready");
    noKey.put("assigneeIds", List.of(dev1));
    noKey.put("expectedRevision", 0);
    expect(post(movePath(issue)).content(om.writeValueAsString(noKey)), lead, 400);
    Map<String, Object> noRev = new LinkedHashMap<>(noKey);
    noRev.remove("expectedRevision");
    noRev.put("idempotencyKey", "k");
    expect(post(movePath(issue)).content(om.writeValueAsString(noRev)), lead, 400);
    // runId 는 선택이지만 있으면 양수여야 한다.
    Map<String, Object> badRun = new LinkedHashMap<>(noKey);
    badRun.put("idempotencyKey", "k");
    badRun.put("runId", 0);
    expect(post(movePath(issue)).content(om.writeValueAsString(badRun)), lead, 400);
    assertThat(eventTypes(issue)).containsExactly("RUN_STARTED");
  }

  @Test
  @DisplayName("의견은 이슈 댓글로 남고 떠나는 node_run 의 comment_id 에 이어진다 — 공백뿐인 의견은 댓글을 만들지 않는다")
  void commentStored_linkedToNodeRun() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    ok(moveReq(issue, "triage", "ready", null, List.of(dev1), "   ", 0, "k1"), lead);
    assertThat(latestNodeRun(issue, "triage").get(NODE_RUN.COMMENT_ID)).isNull();
    assertThat(commentCount(issue)).isZero();

    events.clear();
    // 질문 이동(WP-2093)은 의견을 댓글이 아니라 이슈 챗 질문으로 올리므로 node_run.comment_id 는 null 이고 댓글은 생기지 않는다.
    ok(moveReq(issue, "dev", "ask", null, null, "질문입니다", 1, "k2"), dev1);
    assertThat(issueChanges()).isEqualTo(1);
    assertThat(latestNodeRun(issue, "dev").get(NODE_RUN.COMMENT_ID)).isNull();
    assertThat(commentCount(issue)).isZero();

    // 질문이 아닌 이동(답)의 의견은 그대로 댓글이고 떠나는 node_run 에 이어진다.
    ok(moveReq(issue, "dev_ask", "answered", null, null, "답입니다", 2, "k3"), owner);
    Long commentId = latestNodeRun(issue, "dev_ask").get(NODE_RUN.COMMENT_ID);
    assertThat(commentId).isNotNull();
    assertThat(
            dsl.select(ISSUE_COMMENT.BODY, ISSUE_COMMENT.ISSUE_ID)
                .from(ISSUE_COMMENT)
                .where(ISSUE_COMMENT.ID.eq(commentId))
                .fetchSingle()
                .value1())
        .isEqualTo("답입니다");
    assertThat(commentCount(issue)).isEqualTo(1);
  }

  @Test
  @DisplayName("이동 의견 댓글은 담당 교체 뒤에 써 — 빠지는 옛 담당은 COMMENTED 받는 사람에 없고 새 담당은 있다")
  void moveComment_afterAssigneeChange_notifiesNewAssignees() {
    long wf = publish(spec());
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);
    // dev1 은 워크플로우가 넣은 담당 — dev → dev_ask 이동에서 빠지고 owner 가 들어온다.
    ok(moveReq(issue, "triage", "ready", null, List.of(dev1), null, 0, "k1"), lead);
    ok(moveReq(issue, "dev", "ask", null, null, "질문입니다", 1, "k2"), dev1);
    events.clear();

    // 답(질문 이동이 아니라 댓글로 남는 이동) — owner 가 빠지고 dev1 이 다시 담당이 된다.
    ok(moveReq(issue, "dev_ask", "answered", null, null, "답입니다", 2, "k3"), owner);

    List<IssueCommentedEvent> commented = events.stream(IssueCommentedEvent.class).toList();
    assertThat(commented).hasSize(1);
    // 알림 받는 담당은 댓글을 쓸 때 담긴다(IssueCommentedEvent.assignees) — 교체 뒤 담당이어야 한다.
    assertThat(commented.getFirst().assignees().stream().map(u -> u.id()).toList())
        .containsExactlyInAnyOrder(lead, dev1);
    assertThat(issueAssignees(issue)).containsExactlyInAnyOrder(lead, dev1);
    // node_run.comment_id 연결은 그대로.
    assertThat(latestNodeRun(issue, "dev_ask").get(NODE_RUN.COMMENT_ID))
        .isEqualTo(commented.getFirst().commentId());
  }

  @Test
  @DisplayName("질문 의견의 _qa.question 은 요청 의견 원문이고 챗 질문 글에 그대로 올라간다(WP-2093)")
  void qaQuestion_isRequestCommentAndChatBody() {
    long wf = publish(spec());
    long issue = issue(dev1);
    ok(startReq(issue, wf, false), dev1);

    JsonNode asked = ok(moveReq(issue, "dev", "ask", null, null, "어느 API 를 쓰나요?", 0, "q1"), dev1);

    JsonNode qa = asked.get("context").get("_qa").get(0);
    assertThat(qa.get("question").asString()).isEqualTo("어느 API 를 쓰나요?");
    assertThat(
            dsl.select(CHAT_MESSAGE.BODY)
                .from(CHAT_MESSAGE)
                .where(CHAT_MESSAGE.ID.eq(qa.get("questionMessageId").asLong()))
                .fetchSingle()
                .value1())
        .isEqualTo("어느 API 를 쓰나요?");
  }

  @Test
  @DisplayName("decision 연쇄가 20 단계를 넘으면 SUSPENDED·FAILED node_run, 이슈 담당은 그대로이고 더 넘길 수 없다")
  void autoLimit_suspended_keepsAssignees() {
    long wf = publish(chainYaml(21));
    long issue = issue(lead);
    ok(startReq(issue, wf, false), lead);

    JsonNode v = ok(moveReq(issue, "triage", "go", null, null, null, 0, "k1"), lead);

    assertThat(v.get("status").asString()).isEqualTo("SUSPENDED");
    assertThat(v.get("revision").asInt()).isEqualTo(1);
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("d21");
    assertThat(v.get("currentNode").get("nodeRunStatus").asString()).isEqualTo("FAILED");
    var failed = latestNodeRun(issue, "d21");
    assertThat(failed.get(NODE_RUN.STATUS)).isEqualTo("FAILED");
    assertThat(failed.get(NODE_RUN.ERROR)).isNotBlank();
    assertThat(failed.get(NODE_RUN.ASSIGNEE_IDS)).containsExactly(lead);
    assertThat(issueAssignees(issue)).containsExactly(lead);
    assertThat(eventTypes(issue)).filteredOn("AUTO_MOVED"::equals).hasSize(20);
    assertThat(eventTypes(issue)).endsWith("AUTO_LIMIT");
    JsonNode autoLimit = payloads(issue, "AUTO_LIMIT").getFirst();
    assertThat(autoLimit.get("node").asString()).isEqualTo("d21");
    assertThat(autoLimit.get("steps").asInt()).isEqualTo(20);
    assertCode(
        expect(moveReq(issue, "d21", "x", null, null, null, 1, "k2"), lead, 409),
        "WORKFLOW_NODE_SUSPENDED");
  }

  // ───────────────────────── 조회 ─────────────────────────

  @Test
  @DisplayName("실행이 없는 이슈의 조회는 200 과 null·빈 목록")
  void viewNoRun_200Null() {
    long issue = issue(lead);
    JsonNode v = ok(get(viewPath(issue)), dev2);
    assertThat(v.get("runId").isNull()).isTrue();
    assertThat(v.get("status").isNull()).isTrue();
    assertThat(v.get("currentNode").isNull()).isTrue();
    assertThat(v.get("outcomes")).isEmpty();
    assertThat(v.get("path")).isEmpty();
  }

  @Test
  @DisplayName("다른 테넌트의 이슈는 조회·시작·이동 모두 404")
  void otherTenant_404() {
    // OPEN 프로젝트라 같은 테넌트였다면 조회는 200 이다 — 구성원 검사가 아니라 RLS 만이 404 를 내게 한다.
    long tid2 = ensureFixtureTenant("wf-run-api-rls");
    useTenant(tid2);
    var other =
        OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, tid2);
    useTenant(1L);
    long wf = publish(spec());

    List<JsonNode> bodies =
        List.of(
            expect(get(viewPath(other.issueId())), pm, 404),
            expect(startReq(other.issueId(), wf, false), pm, 404),
            expect(moveReq(other.issueId(), "triage", "ready", null, null, null, 0, "k"), pm, 404));
    for (JsonNode body : bodies) {
      assertThat(body.toString()).doesNotContain("runId").doesNotContain("triage");
    }
  }

  // ───────────────────────── 시험 도우미 ─────────────────────────

  private record Res(int status, String text, JsonNode body) {}

  /** 이 스레드·이 시험 트랜잭션에서 도는 dispatcher(빈은 @Async 프록시라 직접 부르면 다른 스레드에서 돈다). */
  private NotificationDispatcher directDispatcher() {
    return new NotificationDispatcher(notificationService);
  }

  /** 그 이슈의 되돌림 한도 알림을 받은 사람(id 순). */
  private List<Long> visitLimitRecipients(long issueId) {
    return dsl.select(NOTIFICATION.RECIPIENT_ID)
        .from(NOTIFICATION)
        .where(NOTIFICATION.ISSUE_ID.eq(issueId))
        .and(NOTIFICATION.TYPE.eq("WORKFLOW_VISIT_LIMIT"))
        .orderBy(NOTIFICATION.RECIPIENT_ID)
        .fetch(NOTIFICATION.RECIPIENT_ID);
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private static String newKey() {
    return "WR" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
  }

  private long newProject(String projectKey, long ownerId) {
    long id =
        projectService
            .create(ownerId, new CreateProjectRequest(projectKey, "실행", "x", "TEAM"))
            .id();
    TenantContext.set(1L);
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  /** spec-example.yaml 의 구성원을 실제 사용자로 바꾼 글. */
  private String spec() {
    try {
      return Files.readString(
              Path.of("src/test/resources/workflow/spec-example.yaml"), StandardCharsets.UTF_8)
          .replace("teamleader@iacloud.kr", username(lead))
          .replace("planner@iacloud.kr", username(planner))
          .replace("dev1@example.com", username(dev1))
          .replace("dev2@example.com", username(dev2))
          .replace("owner@example.com", username(owner));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  /** 사람 작업 하나 → end. */
  private static String simpleYaml(String member) {
    return """
    schema: genia/workflow@1
    name: 단순
    roles:
      owner: { members: ["%s"] }
    nodes:
      start: { type: start }
      work: { type: human_task, role: owner, outcomes: { done: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: owner }, to: work }
    """
        .formatted(member);
  }

  /**
   * lead 가 담당이면 decision 을 지나 planner 한 명이 맡는 plan 에 머무는 정의 — 시작 조건이 task 를 바로 가리키면 검증기가 역할 겹침을 요구해
   * (ASSIGNEE_OUTSIDE_TARGET_ROLE) 「Y 가 한 명이면 그 사람」 경로에 닿을 수 없다.
   */
  private String soleMemberYaml() {
    return """
    schema: genia/workflow@1
    name: 한 명
    roles:
      lead: { members: ["%s"] }
      planner: { members: ["%s"] }
    nodes:
      start: { type: start }
      route: { type: decision, default: plan }
      plan: { type: agent_task, role: planner, instructions: 기획, outcomes: { done: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: route }
    """
        .formatted(username(lead), username(planner));
  }

  /** 시작 조건이 decision 을 거쳐 바로 end 로 가는 정의(work 는 다른 갈래). */
  private static String immediateEndYaml(String member) {
    return """
    schema: genia/workflow@1
    name: 바로 끝
    roles:
      owner: { members: ["%s"] }
    nodes:
      start: { type: start }
      route:
        type: decision
        conditions:
          - { when: { assigneeRole: owner }, to: end }
        default: work
      work: { type: human_task, role: owner, outcomes: { done: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: owner }, to: route }
    """
        .formatted(member);
  }

  /** triage(lead) → go(assignTo developer) → route(assigneeRole owner 면 end, 아니면 dev). */
  private String steerableYaml() {
    return """
    schema: genia/workflow@1
    name: 몰기
    roles:
      lead: { members: ["%s"] }
      developer: { members: ["%s", "%s"] }
      owner: { members: ["%s"] }
    nodes:
      start: { type: start }
      triage:
        type: human_task
        role: lead
        outcomes:
          go: { to: route, assignTo: developer }
      route:
        type: decision
        conditions:
          - { when: { assigneeRole: owner }, to: end }
        default: dev
      dev: { type: human_task, role: developer, outcomes: { done: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: triage }
    """
        .formatted(username(lead), username(dev1), username(dev2), username(owner));
  }

  /** triage → decision(route: context triage.size == big 면 plan, 아니면 dev). */
  private String decisionYaml() {
    return """
    schema: genia/workflow@1
    name: 갈림
    roles:
      lead: { members: ["%s"] }
      planner: { members: ["%s"] }
      developer: { members: ["%s"] }
    nodes:
      start: { type: start }
      triage:
        type: agent_task
        role: lead
        instructions: 분류
        outputs: { size: { type: string, required: true } }
        outcomes:
          go: { to: route, assignTo: developer }
      route:
        type: decision
        conditions:
          - { when: { context: triage.size, equals: big }, to: plan }
        default: dev
      plan:
        type: agent_task
        role: planner
        instructions: 기획
        outcomes: { done: { to: end } }
      dev:
        type: agent_task
        role: developer
        instructions: 개발
        outcomes: { done: { to: end } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: triage }
    """
        .formatted(username(lead), username(planner), username(dev1));
  }

  /** triage → d1 → … → d{n} → dev 인 decision 일렬 연쇄. */
  private String chainYaml(int n) {
    StringBuilder nodes = new StringBuilder();
    for (int i = 1; i <= n; i++) {
      nodes.append("  d").append(i).append(": { type: decision, default: ");
      nodes.append(i == n ? "dev" : "d" + (i + 1)).append(" }\n");
    }
    return """
    schema: genia/workflow@1
    name: 긴 연쇄
    roles:
      lead: { members: ["%s"] }
      developer: { members: ["%s"] }
    nodes:
      start: { type: start }
      triage: { type: agent_task, role: lead, instructions: 분류, outcomes: { go: { to: d1, assignTo: developer } } }
    %s  dev: { type: agent_task, role: developer, instructions: 개발, outcomes: { done: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: triage }
    """
        .formatted(username(lead), username(dev1), nodes);
  }

  /** 이 프로젝트에 게시하고 켠 정의 id. */
  private long publish(String yaml) {
    return publishIn(projectId, yaml);
  }

  private long publishIn(long pid, String yaml) {
    JsonNode created =
        expect(
            post(API + "/projects/" + pid + "/workflows")
                .content(json("name", "흐름 " + UUID.randomUUID(), "yaml", yaml)),
            pm,
            201);
    long id = created.get("id").asLong();
    JsonNode published = expect(post(API + "/workflows/" + id + "/publish"), pm, 200);
    assertThat(published.get("versionNo").asInt()).as("%s", published).isEqualTo(1);
    ok(patchReq(id, true), pm);
    return id;
  }

  private MockHttpServletRequestBuilder patchReq(long wf, boolean enabled) {
    return patch(API + "/workflows/" + wf).content(json("enabled", enabled));
  }

  /** 관리자가 담당을 넣어 만든 이슈 id. */
  private long issue(long... assignees) {
    List<Long> ids = new ArrayList<>();
    for (long a : assignees) {
      ids.add(a);
    }
    Res res =
        send(
            post(API + "/projects/" + key + "/issues")
                .content(json("title", "이슈", "assigneeIds", List.of())),
            pm);
    assertThat(res.status()).as("%s", res.text()).isBetween(200, 201);
    long id = res.body().get("id").asLong();
    seedAssignees(id, assignees);
    return id;
  }

  /**
   * 시험 준비 — 담당을 이슈 생성·담당 교체 API 가 아니라 행으로 바로 넣는다. WP-2120 이후 API 로 시작 조건에 맞는 담당을 넣으면 실행이 자동으로 시작돼,
   * 「담당만 있고 아직 시작 전」 이슈를 시험이 직접 시작(start)하는 이 시험의 흐름과 부딪히기 때문이다.
   */
  private void seedAssignees(long issue, long... users) {
    com.workplace.support.TestFixtures.seedAssignees(dsl, pm, issue, users);
  }

  private MockHttpServletRequestBuilder startReq(long issue, long wf, boolean dryRun) {
    return post(viewPath(issue) + "/start").content(json("workflowId", wf, "dryRun", dryRun));
  }

  private MockHttpServletRequestBuilder moveReq(
      long issue,
      String from,
      String outcome,
      Map<String, Object> outputs,
      List<Long> assigneeIds,
      String comment,
      int revision,
      String idempotencyKey) {
    return moveReq(
        issue, from, outcome, outputs, assigneeIds, comment, revision, idempotencyKey, null);
  }

  /** 겨눈 실행(runId)을 함께 싣는 이동 요청 — null 이면 싣지 않는다(지금 실행을 겨눈 것으로 본다). */
  private MockHttpServletRequestBuilder moveReq(
      long issue,
      String from,
      String outcome,
      Map<String, Object> outputs,
      List<Long> assigneeIds,
      String comment,
      int revision,
      String idempotencyKey,
      Long runId) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("fromNode", from);
    body.put("outcome", outcome);
    if (outputs != null) body.put("outputs", outputs);
    if (assigneeIds != null) body.put("assigneeIds", assigneeIds);
    if (comment != null) body.put("comment", comment);
    body.put("expectedRevision", revision);
    body.put("idempotencyKey", idempotencyKey);
    if (runId != null) body.put("runId", runId);
    return post(movePath(issue)).content(om.writeValueAsString(body));
  }

  private static String viewPath(long issue) {
    return API + "/issues/" + issue + "/workflow";
  }

  private static String movePath(long issue) {
    return viewPath(issue) + "/move";
  }

  private String json(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      map.put((String) pairs[i], pairs[i + 1]);
    }
    return om.writeValueAsString(map);
  }

  /** 이슈 번호(프로젝트 안). */
  private int number(long issue) {
    return dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issue)).fetchSingle().value1();
  }

  private List<Long> issueAssignees(long issue) {
    return dsl.select(ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issue))
        .fetch(ISSUE_ASSIGNEE.USER_ID);
  }

  private int assigneeCount(long issue) {
    return issueAssignees(issue).size();
  }

  private int commentCount(long issue) {
    return dsl.fetchCount(ISSUE_COMMENT, ISSUE_COMMENT.ISSUE_ID.eq(issue));
  }

  /** 이슈의 실행·방문·이벤트·멱등 행 수 합. */
  private int rowCount(long issue) {
    return dsl.fetchCount(WORKFLOW_RUN, WORKFLOW_RUN.ISSUE_ID.eq(issue))
        + rowCountOf(NODE_RUN, issue)
        + rowCountOf(WORKFLOW_RUN_EVENT, issue)
        + rowCountOf(WORKFLOW_MOVE_IDEMPOTENCY, issue);
  }

  /** 이슈의 실행에 딸린 표의 행 수. */
  private int rowCountOf(org.jooq.Table<?> table, long issue) {
    var runId = table.field("run_id", Long.class);
    return dsl.fetchCount(
        table,
        runId.in(
            dsl.select(WORKFLOW_RUN.ID).from(WORKFLOW_RUN).where(WORKFLOW_RUN.ISSUE_ID.eq(issue))));
  }

  /** 이슈 실행의 이벤트 type(일어난 순서). */
  private List<String> eventTypes(long issue) {
    return dsl.select(WORKFLOW_RUN_EVENT.TYPE)
        .from(WORKFLOW_RUN_EVENT)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .orderBy(WORKFLOW_RUN_EVENT.ID)
        .fetch(WORKFLOW_RUN_EVENT.TYPE);
  }

  /** 그 type 이벤트들의 payload. */
  private List<JsonNode> payloads(long issue, String type) {
    return dsl.select(WORKFLOW_RUN_EVENT.PAYLOAD)
        .from(WORKFLOW_RUN_EVENT)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue).and(WORKFLOW_RUN_EVENT.TYPE.eq(type)))
        .orderBy(WORKFLOW_RUN_EVENT.ID)
        .fetch(r -> om.readTree(r.value1().data()));
  }

  /** 노드의 가장 최근 방문 행. */
  private com.workplace.jooq.tables.records.NodeRunRecord latestNodeRun(long issue, String node) {
    return dsl.selectFrom(NODE_RUN)
        .where(
            NODE_RUN
                .RUN_ID
                .in(
                    dsl.select(WORKFLOW_RUN.ID)
                        .from(WORKFLOW_RUN)
                        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue)))
                .and(NODE_RUN.NODE_KEY.eq(node)))
        .orderBy(NODE_RUN.ID.desc())
        .limit(1)
        .fetchSingle();
  }

  /** 이슈 갱신 알림(SSE) 수. */
  private long issueChanges() {
    return events.stream(ResourceChangedEvent.class)
        .filter(e -> "issue".equals(e.resource()) && ResourceChangedEvent.OP_UPDATED.equals(e.op()))
        .count();
  }

  private static List<Long> ids(JsonNode users) {
    List<Long> out = new ArrayList<>();
    users.forEach(u -> out.add(u.get("id").asLong()));
    return out;
  }

  private static List<Long> longs(JsonNode arr) {
    List<Long> out = new ArrayList<>();
    arr.forEach(u -> out.add(u.asLong()));
    return out;
  }

  private static List<String> keys(JsonNode arr) {
    List<String> out = new ArrayList<>();
    arr.forEach(u -> out.add(u.get("key").asString()));
    return out;
  }

  private static void assertCode(JsonNode body, String code) {
    assertThat(body.get("errors").get("code").asString()).as("%s", body).isEqualTo(code);
  }

  private JsonNode ok(MockHttpServletRequestBuilder req, long caller) {
    return expect(req, caller, 200);
  }

  private JsonNode expect(MockHttpServletRequestBuilder req, long caller, int status) {
    Res res = send(req, caller);
    assertThat(res.status()).as("%s", res.text()).isEqualTo(status);
    return res.body();
  }

  private Res send(MockHttpServletRequestBuilder req, long caller) {
    req.contentType(MediaType.APPLICATION_JSON);
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L));
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      return new Res(response.getStatus(), text, text.isBlank() ? null : om.readTree(text));
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }
}

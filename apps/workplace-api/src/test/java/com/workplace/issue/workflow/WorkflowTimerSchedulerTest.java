package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_RUN_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueClock;
import com.workplace.issue.workflow.service.WorkflowTimerScheduler;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1987 기다림 타이머 스케줄러({@link WorkflowTimerScheduler#poll()})의 테넌트 경로 검증. poll() 은 테넌트 러너가 별도
 * 트랜잭션(GUC 주입)을 여는 경로라 시험 트랜잭션 안에서는 데이터가 보이지 않는다 — 그래서 {@code @Transactional} 없이 시드를 커밋하고, 끝나면 만든
 * 프로젝트(이슈·정의·실행·알림은 FK CASCADE, 실행은 먼저 명시 삭제)를 회수한다. 판정 규칙 자체는 {@code WorkflowTimerTest} 가 본다.
 */
class WorkflowTimerSchedulerTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueClock issueClock;
  @Autowired WorkflowTimerScheduler scheduler;

  private String key;
  private long projectId;

  /** 커밋된 시드를 회수한다 — 실행(버전 FK 가 CASCADE 가 아님)을 먼저 지우고 프로젝트를 지운다. */
  @AfterEach
  void cleanup() {
    if (key != null) {
      dsl.execute("SELECT set_config('app.tenant_id', '1', false)");
      dsl.deleteFrom(WORKFLOW_RUN)
          .where(
              WORKFLOW_RUN.ISSUE_ID.in(
                  dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId))))
          .execute();
      dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
      dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
    }
    TenantContext.clear();
  }

  @Test
  @DisplayName("poll() 이 테넌트 트랜잭션에서 오래 머문 방문에 TIMER_REMIND 와 알림 1건을 남긴다")
  void poll_remindsDueVisitUnderTenant() {
    TenantContext.set(1L);
    long pm = human();
    long worker = human();
    key = "WS" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
    projectId = projectService.create(pm, new CreateProjectRequest(key, "타이머", "x", "TEAM")).id();
    TenantContext.set(1L);
    projectService.addMember(pm, key, new AddMemberRequest(worker, "MEMBER"));

    String yaml =
        """
        schema: genia/workflow@1
        name: 사람
        roles:
          owner: { members: ["%s"] }
        nodes:
          start: { type: start }
          work: { type: human_task, role: owner, outcomes: { done: { to: end } } }
          end: { type: end }
        start:
          - { when: { assigneeRole: owner }, to: work }
        """
            .formatted(username(worker));
    long wf =
        call(
                post(API + "/projects/" + projectId + "/workflows")
                    .content(json("name", "흐름 " + UUID.randomUUID(), "yaml", yaml)),
                pm,
                201)
            .get("id")
            .asLong();
    call(post(API + "/workflows/" + wf + "/publish"), pm, 200);
    call(patch(API + "/workflows/" + wf).content(json("enabled", true)), pm, 200);
    long issue =
        call(
                post(API + "/projects/" + key + "/issues")
                    .content(json("title", "이슈", "assigneeIds", List.of(worker))),
                pm,
                200)
            .get("id")
            .asLong();
    call(
        post(API + "/issues/" + issue + "/workflow/start")
            .content(json("workflowId", wf, "dryRun", false)),
        pm,
        200);

    dsl.execute("SELECT set_config('app.tenant_id', '1', false)");
    Instant entered =
        dsl.select(NODE_RUN.ENTERED_AT)
            .from(NODE_RUN)
            .join(WORKFLOW_RUN)
            .on(WORKFLOW_RUN.ID.eq(NODE_RUN.RUN_ID))
            .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
            .and(NODE_RUN.NODE_KEY.eq("work"))
            .fetchSingle()
            .value1()
            .toInstant();
    doReturn(entered.plus(Duration.ofDays(3))).when(issueClock).now();

    scheduler.poll();

    await()
        .atMost(Duration.ofSeconds(10))
        .untilAsserted(
            () -> {
              dsl.execute("SELECT set_config('app.tenant_id', '1', false)");
              assertThat(
                      dsl.select(WORKFLOW_RUN_EVENT.TYPE)
                          .from(WORKFLOW_RUN_EVENT)
                          .join(WORKFLOW_RUN)
                          .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
                          .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
                          .fetch(WORKFLOW_RUN_EVENT.TYPE))
                  .contains("TIMER_REMIND");
              assertThat(
                      dsl.select(NOTIFICATION.RECIPIENT_ID)
                          .from(NOTIFICATION)
                          .where(NOTIFICATION.ISSUE_ID.eq(issue))
                          .and(NOTIFICATION.TYPE.eq("WORKFLOW_TURN_REMIND"))
                          .fetch(NOTIFICATION.RECIPIENT_ID))
                  .containsExactly(worker);
            });
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  private String json(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
    return om.writeValueAsString(map);
  }

  private JsonNode call(MockHttpServletRequestBuilder req, long caller, int status) {
    req.contentType(MediaType.APPLICATION_JSON);
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L));
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      assertThat(response.getStatus()).as("%s", text).isEqualTo(status);
      return text.isBlank() ? null : om.readTree(text);
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }
}

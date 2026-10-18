package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.AgentWorkService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 상세·목록 응답의 agentWork(WP-377) — 진행 중 작업이 있으면 실리고 없으면 JSON 에서 아예 생략된다. */
@Transactional
class IssueAgentWorkResponseTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired AgentWorkService agentWorkService;

  /** USER 역할이 부여된 사용자 시드. */
  private long createUser() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "aw-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "aw")
            .set(USER.EMAIL, "aw-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    // WP-420: 역할 권한은 같은 테넌트의 ACTIVE 멤버일 때만 유효하다.
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    return id;
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void 상세_summary_와_내_이슈_목록에_agentWork_가_실리고_없으면_생략() throws Exception {
    long userId = createUser();
    String key =
        "AW" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    var proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var working = issueRepository.insert(proj.id(), 1, "작업중", null, "MID", null, userId);
    issueRepository.insert(proj.id(), 2, "조용함", null, "MID", null, userId);
    agentWorkService.startOrUpdate(working.id(), userId, "claude-code", AgentWorkPatch.empty());

    mvc.perform(
            get("/api/v1/projects/" + key + "/issues/1").header("Authorization", bearer(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.agentWork[0].tool").value("claude-code"))
        .andExpect(jsonPath("$.summary.agentWork[0].state").value("WORKING"))
        .andExpect(jsonPath("$.summary.agentWork[0].worker.kind").value("HUMAN"));
    mvc.perform(
            get("/api/v1/projects/" + key + "/issues/2").header("Authorization", bearer(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.agentWork").doesNotExist());

    mvc.perform(get("/api/v1/me/issues?reporter=me").header("Authorization", bearer(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[?(@.number == 1)].agentWork[0].tool").value("claude-code"))
        .andExpect(jsonPath("$.items[?(@.number == 2)].agentWork").isEmpty());
  }

  /** WP-450: 다음 회차 대기(SCHEDULED)의 nextRunAt 은 응답에 실리고, 다른 상태에서는 키가 생략된다. */
  @Test
  void SCHEDULED_작업의_nextRunAt_이_응답에_실리고_작업중이면_생략() throws Exception {
    long userId = createUser();
    String key =
        "AW" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    var proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var issue = issueRepository.insert(proj.id(), 1, "예약", null, "MID", null, userId);
    var next = Instant.parse("2026-10-19T00:00:00Z");
    agentWorkService.startOrUpdate(
        issue.id(),
        userId,
        "claude-code",
        AgentWorkPatch.empty().withTool("claude-code").withState("SCHEDULED").withNextRunAt(next));

    mvc.perform(
            get("/api/v1/projects/" + key + "/issues/1").header("Authorization", bearer(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.agentWork[0].state").value("SCHEDULED"))
        .andExpect(jsonPath("$.summary.agentWork[0].nextRunAt").value("2026-10-19T00:00:00Z"));

    agentWorkService.startOrUpdate(
        issue.id(), userId, "claude-code", AgentWorkPatch.empty().withState("WORKING"));
    mvc.perform(
            get("/api/v1/projects/" + key + "/issues/1").header("Authorization", bearer(userId)))
        .andExpect(jsonPath("$.summary.agentWork[0].state").value("WORKING"))
        .andExpect(jsonPath("$.summary.agentWork[0].nextRunAt").doesNotExist());
  }

  /**
   * 종료(DONE)된 이슈에 진행 중 행이 남아 있어도(롤링 배포 중 자동 종료를 못 거친 경우 등) 응답에는 싣지 않는다. 서비스 경로로 DONE 을 만들면 자동 종료가
   * 먼저 일어나 방어선을 검증하지 못하므로 상태를 DB 에 직접 쓴다.
   */
  @Test
  void 종료된_이슈의_남은_작업은_응답에서_빠진다() throws Exception {
    long userId = createUser();
    String key =
        "AW" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    var proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var done = issueRepository.insert(proj.id(), 1, "끝남", null, "MID", null, userId);
    agentWorkService.startOrUpdate(done.id(), userId, "claude-code", AgentWorkPatch.empty());
    dsl.update(ISSUE).set(ISSUE.STATUS, "DONE").where(ISSUE.ID.eq(done.id())).execute();

    mvc.perform(
            get("/api/v1/projects/" + key + "/issues/1").header("Authorization", bearer(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.status").value("DONE"))
        .andExpect(jsonPath("$.summary.agentWork").doesNotExist());
  }
}

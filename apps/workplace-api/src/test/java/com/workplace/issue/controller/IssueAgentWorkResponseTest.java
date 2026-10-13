package com.workplace.issue.controller;

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
}

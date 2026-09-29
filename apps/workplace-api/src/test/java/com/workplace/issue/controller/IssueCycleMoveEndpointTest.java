package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * POST /api/v1/projects/{key}/issues/{number}/cycles/move 통합 테스트(#881). 실 JWT + MockMvc 로 보안 체인·예외
 * 매핑(완료 사이클 400, 비멤버 403)까지 검증한다. 이동 규칙 자체는 IssueCycleServiceTest 가 맡는다.
 */
@AutoConfigureMockMvc
@Transactional
class IssueCycleMoveEndpointTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired CycleService cycleService;
  @Autowired IssueRepository issueRepository;

  /** USER 역할이 부여된 사용자 시드. */
  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  /** userId 용 access token 발급 (Bearer 헤더 본문). */
  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  private ResultActions move(long userId, String key, String body) throws Exception {
    return mvc.perform(
        post("/api/v1/projects/" + key + "/issues/1/cycles/move")
            .header("Authorization", "Bearer " + tokenFor(userId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  /** 백로그 → 사이클 이동 요청 본문. */
  private static String moveToCycle(Long toCycleId) {
    return "{\"fromCycleId\":null,\"toCycleId\":" + toCycleId + "}";
  }

  @Test
  void member_moves_issue_from_backlog_into_cycle() throws Exception {
    long userId = createUser("m");
    String key = uniqueKey("CM");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    issueRepository.insert(proj.id(), 1, "t", null, "MID", null, userId);
    var cycle =
        cycleService.create(userId, key, new CreateCycleRequest("S", null, null, null, null));

    move(userId, key, moveToCycle(cycle.id()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.cycles[0].id").value(cycle.id()))
        .andExpect(jsonPath("$.removedFrom").value(false))
        .andExpect(jsonPath("$.addedTo").value(true));
  }

  @Test
  void move_into_completed_cycle_returns_400() throws Exception {
    long userId = createUser("c");
    String key = uniqueKey("CC");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    issueRepository.insert(proj.id(), 1, "t", null, "MID", null, userId);
    var done =
        cycleService.create(
            userId, key, new CreateCycleRequest("D", null, null, null, "COMPLETED"));

    move(userId, key, moveToCycle(done.id())).andExpect(status().isBadRequest());
  }

  @Test
  void non_member_forbidden() throws Exception {
    long owner = createUser("o");
    long other = createUser("x");
    String key = uniqueKey("CN");
    ProjectResponse proj = projectService.create(owner, new CreateProjectRequest(key, "P", "x"));
    issueRepository.insert(proj.id(), 1, "t", null, "MID", null, owner);
    var cycle =
        cycleService.create(owner, key, new CreateCycleRequest("S", null, null, null, null));

    move(other, key, moveToCycle(cycle.id())).andExpect(status().isForbidden());
  }
}

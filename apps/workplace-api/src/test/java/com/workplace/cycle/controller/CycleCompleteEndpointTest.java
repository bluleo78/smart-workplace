package com.workplace.cycle.controller;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleCompleteRequest.Destination;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * POST /api/v1/projects/{key}/cycles/{cycleId}/complete 엔드포인트 테스트(WP-1578).
 *
 * <p>JWT + MockMvc 로 보안 체인·예외 매핑·응답 구조를 검증한다. 비즈니스 로직 자체는 CycleCompleteServiceTest 가 맡는다.
 */
@Transactional
class CycleCompleteEndpointTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired CycleService cycleService;
  @Autowired IssueRepository issueRepository;

  /** USER 역할 사용자 생성. */
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
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  /** Bearer token for userId. */
  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  /** 완료 요청 본문 생성. */
  private static String completeJson(
      Destination dest,
      Long targetCycleId,
      Boolean startNow,
      String newName,
      LocalDate newStart,
      LocalDate newEnd) {
    var sb = new StringBuilder();
    sb.append("{\"destination\":\"").append(dest.name()).append("\"");
    if (targetCycleId != null) sb.append(",\"targetCycleId\":").append(targetCycleId);
    if (startNow != null) sb.append(",\"startImmediately\":").append(startNow);
    if (newName != null) sb.append(",\"newCycleName\":\"").append(newName).append("\"");
    if (newStart != null) sb.append(",\"newCycleStartDate\":\"").append(newStart).append("\"");
    if (newEnd != null) sb.append(",\"newCycleEndDate\":\"").append(newEnd).append("\"");
    sb.append("}");
    return sb.toString();
  }

  /** 완료 POST 실행. */
  private ResultActions complete(long userId, String key, Long cycleId, String body)
      throws Exception {
    return mvc.perform(
        post("/api/v1/projects/" + key + "/cycles/" + cycleId + "/complete")
            .header("Authorization", "Bearer " + tokenFor(userId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  @Test
  void owner_complete_cycle_none_returns_200() throws Exception {
    long userId = createUser("oc");
    String key = uniqueKey("CEN");
    ProjectResponse p = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active =
        cycleService.create(
            userId,
            key,
            new CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));

    complete(userId, key, active.id(), completeJson(Destination.NONE, null, null, null, null, null))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.completedCycle.status").value("COMPLETED"))
        .andExpect(jsonPath("$.newCycle").doesNotExist());
  }

  @Test
  void owner_complete_with_new_cycle_returns_new_cycle_active() throws Exception {
    long userId = createUser("onc");
    String key = uniqueKey("COA");
    ProjectResponse p = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active =
        cycleService.create(
            userId,
            key,
            new CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));
    IssueSeeds.insert(issueRepository, dsl, p.id(), 1, "t", null, "MID", null, userId);
    dsl.insertInto(ISSUE_CYCLE)
        .set(
            ISSUE_CYCLE.ISSUE_ID,
            dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(p.id())).fetchOne(ISSUE.ID))
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();

    complete(
            userId,
            key,
            active.id(),
            completeJson(
                Destination.NEW,
                null,
                null,
                "GW-2",
                LocalDate.of(2026, 6, 15),
                LocalDate.of(2026, 6, 28)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.completedCycle.status").value("COMPLETED"))
        .andExpect(jsonPath("$.newCycle.name").value("GW-2"))
        .andExpect(jsonPath("$.newCycle.status").value("ACTIVE"));
  }

  @Test
  void owner_complete_to_scheduled_starts_immediately() throws Exception {
    long userId = createUser("osc");
    String key = uniqueKey("CSI");
    ProjectResponse p = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active =
        cycleService.create(
            userId,
            key,
            new CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));
    var planned =
        cycleService.create(
            userId,
            key,
            new CreateCycleRequest(
                "GW-2", null, LocalDate.of(2026, 6, 15), LocalDate.of(2026, 6, 28), "PLANNED"));

    complete(
            userId,
            key,
            active.id(),
            completeJson(Destination.SCHEDULED, planned.id(), null, null, null, null))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.completedCycle.status").value("COMPLETED"))
        .andExpect(jsonPath("$.newCycle").doesNotExist());
  }

  @Test
  void non_active_cycle_returns_400() throws Exception {
    long userId = createUser("nac");
    String key = uniqueKey("CNA");
    ProjectResponse p = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var planned =
        cycleService.create(
            userId,
            key,
            new CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "PLANNED"));

    complete(
            userId, key, planned.id(), completeJson(Destination.NONE, null, null, null, null, null))
        .andExpect(status().isBadRequest());
  }

  @Test
  void non_member_returns_404_for_private_project() throws Exception {
    long owner = createUser("oc2");
    long stranger = createUser("str");
    String key = uniqueKey("CNM");
    projectService.create(owner, new CreateProjectRequest(key, "P", "x"));
    TestFixtures.activeMemberOfCurrentTenant(dsl, owner);
    // stranger도 tenant 1 멤버이나 프로젝트 멤버는 아님 → PRIVATE 프로젝트이므로 404
    var active =
        cycleService.create(
            owner,
            key,
            new CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));

    complete(
            stranger,
            key,
            active.id(),
            completeJson(Destination.NONE, null, null, null, null, null))
        .andExpect(status().isNotFound());
  }

  @Test
  void project_not_found_returns_404() throws Exception {
    long userId = createUser("npf");
    // 존재하지 않는 프로젝트 키로 호출 → 404
    complete(
            userId,
            "NOTFOUND",
            99999L,
            completeJson(Destination.NONE, null, null, null, null, null))
        .andExpect(status().isNotFound());
  }
}

package com.workplace.cycle.controller;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_ISSUE_SEQUENCE;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleCompleteRequest;
import com.workplace.cycle.dto.CycleCompleteRequest.Destination;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * POST /api/v1/projects/{key}/cycles/{cycleId}/complete 엔드포인트 테스트(WP-1578).
 *
 * <p>JWT + MockMvc 로 보안 체인·예외 매핑·응답 모양을 본다. 비즈니스 규칙은 CycleCompleteServiceTest 가 맡는다. 기본은 테스트 트랜잭션에
 * 합류해 끝나면 롤백되고, 이름 중복 롤백만 실제 커밋 경로로 확인한다({@link #duplicate_name_rolls_back}).
 */
@Transactional
class CycleCompleteEndpointTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;
  @Autowired CycleService cycleService;
  @Autowired IssueRepository issueRepository;
  @Autowired ObjectMapper objectMapper;

  private static final LocalDate D1 = LocalDate.of(2026, 6, 1);
  private static final LocalDate D14 = LocalDate.of(2026, 6, 14);
  private static final LocalDate D15 = LocalDate.of(2026, 6, 15);
  private static final LocalDate D28 = LocalDate.of(2026, 6, 28);

  @Test
  void owner_complete_cycle_none_returns_200() throws Exception {
    long userId = createUser();
    String key = uniqueKey("CEN");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active = createCycle(userId, key, "GW-1", D1, D14, "ACTIVE");

    complete(userId, key, active, none())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.completedCycle.status").value("COMPLETED"))
        .andExpect(jsonPath("$.targetCycle").doesNotExist());
  }

  @Test
  void owner_complete_with_new_cycle_returns_target_cycle_active() throws Exception {
    long userId = createUser();
    String key = uniqueKey("COA");
    ProjectResponse p = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active = createCycle(userId, key, "GW-1", D1, D14, "ACTIVE");
    var issue = IssueSeeds.insert(issueRepository, dsl, p.id(), 1, "t", null, "MID", null, userId);
    attach(issue.id(), active);

    complete(userId, key, active, toNew("GW-2", D15, D28))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.completedCycle.status").value("COMPLETED"))
        .andExpect(jsonPath("$.targetCycle.name").value("GW-2"))
        .andExpect(jsonPath("$.targetCycle.status").value("ACTIVE"));
  }

  @Test
  void owner_complete_to_scheduled_returns_target_cycle() throws Exception {
    long userId = createUser();
    String key = uniqueKey("CSI");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active = createCycle(userId, key, "GW-1", D1, D14, "ACTIVE");
    var planned = createCycle(userId, key, "GW-2", D15, D28, "PLANNED");

    complete(userId, key, active, toScheduled(planned, false))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.completedCycle.status").value("COMPLETED"))
        .andExpect(jsonPath("$.targetCycle.id").value(planned))
        .andExpect(jsonPath("$.targetCycle.status").value("PLANNED"));
  }

  /** NEW 인데 종료일이 없으면 400(한국어 메시지)이고 사이클은 진행 중 그대로다. */
  @Test
  void new_destination_without_end_date_returns_400() throws Exception {
    long userId = createUser();
    String key = uniqueKey("CND");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active = createCycle(userId, key, "GW-1", D1, D14, "ACTIVE");

    complete(userId, key, active, toNew("GW-2", D15, null))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(containsString("종료일")));

    listCycles(userId, key)
        .andExpect(jsonPath("$.length()").value(1))
        .andExpect(jsonPath("$[0].status").value("ACTIVE"));
  }

  /** 새 사이클 이름이 60자를 넘으면 400. */
  @Test
  void new_cycle_name_too_long_returns_400() throws Exception {
    long userId = createUser();
    String key = uniqueKey("CNL");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active = createCycle(userId, key, "GW-1", D1, D14, "ACTIVE");

    complete(userId, key, active, toNew("가".repeat(61), D15, D28))
        .andExpect(status().isBadRequest());
  }

  @Test
  void non_active_cycle_returns_400() throws Exception {
    long userId = createUser();
    String key = uniqueKey("CNA");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var planned = createCycle(userId, key, "GW-1", D1, D14, "PLANNED");

    complete(userId, key, planned, none())
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("진행 중인 사이클만 완료할 수 있습니다"));
  }

  /** 예정이 아닌 사이클(완료된 사이클)로 보내려 하면 400 과 화면에 보일 문구. */
  @Test
  void scheduled_target_not_planned_returns_400() throws Exception {
    long userId = createUser();
    String key = uniqueKey("CTP");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active = createCycle(userId, key, "GW-1", D1, D14, "ACTIVE");
    var completed = createCycle(userId, key, "GW-0", D1, D14, "COMPLETED");

    complete(userId, key, active, toScheduled(completed, null))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("예정 사이클로만 보낼 수 있습니다"));
  }

  /** 완료하는 사이클 자신을 보낼 곳으로 고르면 400 과 화면에 보일 문구. */
  @Test
  void scheduled_target_self_returns_400() throws Exception {
    long userId = createUser();
    String key = uniqueKey("CTS");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var active = createCycle(userId, key, "GW-1", D1, D14, "ACTIVE");

    complete(userId, key, active, toScheduled(active, null))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("완료하는 사이클로는 이슈를 보낼 수 없습니다"));

    listCycles(userId, key).andExpect(jsonPath("$[0].status").value("ACTIVE"));
  }

  /** 프로젝트 MEMBER(OWNER 아님)는 403. */
  @Test
  void member_returns_403() throws Exception {
    long owner = createUser();
    long member = createUser();
    String key = uniqueKey("CMB");
    ProjectResponse p = projectService.create(owner, new CreateProjectRequest(key, "P", "x"));
    memberRepository.insert(p.id(), member, "MEMBER");
    var active = createCycle(owner, key, "GW-1", D1, D14, "ACTIVE");

    complete(member, key, active, none()).andExpect(status().isForbidden());
  }

  @Test
  void non_member_returns_404_for_private_project() throws Exception {
    long owner = createUser();
    long stranger = createUser();
    String key = uniqueKey("CNM");
    projectService.create(owner, new CreateProjectRequest(key, "P", "x"));
    // stranger 는 테넌트 멤버지만 프로젝트 멤버가 아니다 → 비공개 프로젝트라 404
    var active = createCycle(owner, key, "GW-1", D1, D14, "ACTIVE");

    complete(stranger, key, active, none()).andExpect(status().isNotFound());
  }

  @Test
  void project_not_found_returns_404() throws Exception {
    long userId = createUser();
    complete(userId, "NOTFOUND", 99999L, none()).andExpect(status().isNotFound());
  }

  /**
   * 새 사이클 이름이 겹치면 409 이고 한 트랜잭션 전체가 롤백된다 — 원 사이클은 진행 중, 사이클 수·이슈 연결은 그대로.
   *
   * <p>테스트 트랜잭션 안에서는 롤백을 볼 수 없어 이 테스트만 트랜잭션 없이(실제 커밋) 돌리고 끝에 만든 행을 지운다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void duplicate_name_rolls_back() throws Exception {
    String key = uniqueKey("CDR");
    long[] seeded =
        callInTenant(
            1L,
            () -> {
              long u = createUser();
              ProjectResponse p = projectService.create(u, new CreateProjectRequest(key, "P", "x"));
              long active = createCycle(u, key, "GW-A", D1, D14, "ACTIVE");
              createCycle(u, key, "GW-B", D15, D28, "PLANNED");
              var issue =
                  IssueSeeds.insert(issueRepository, dsl, p.id(), 1, "t", null, "MID", null, u);
              attach(issue.id(), active);
              return new long[] {u, p.id(), active, issue.id()};
            });
    long userId = seeded[0];
    long projectId = seeded[1];
    long activeId = seeded[2];
    long issueId = seeded[3];
    try {
      complete(userId, key, activeId, toNew("GW-B", D15, D28)).andExpect(status().isConflict());

      listCycles(userId, key)
          .andExpect(jsonPath("$.length()").value(2))
          .andExpect(jsonPath("$[?(@.name == 'GW-A')].status", contains("ACTIVE")));
      List<Long> links =
          callInTenant(
              1L,
              () ->
                  dsl.select(ISSUE_CYCLE.CYCLE_ID)
                      .from(ISSUE_CYCLE)
                      .where(ISSUE_CYCLE.ISSUE_ID.eq(issueId))
                      .fetch(ISSUE_CYCLE.CYCLE_ID));
      assertThat(links).containsExactly(activeId);
    } finally {
      cleanupInTenant(
          1L,
          () -> {
            // 사이클·issue_cycle 은 프로젝트 삭제에 CASCADE. 이슈는 CASCADE 가 아니라 먼저 지운다.
            List<Long> issueIds =
                dsl.select(ISSUE.ID)
                    .from(ISSUE)
                    .where(ISSUE.PROJECT_ID.eq(projectId))
                    .fetch(ISSUE.ID);
            dsl.deleteFrom(ISSUE_CYCLE).where(ISSUE_CYCLE.ISSUE_ID.in(issueIds)).execute();
            dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.in(issueIds)).execute();
            dsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(issueIds)).execute();
            dsl.deleteFrom(ISSUE).where(ISSUE.ID.in(issueIds)).execute();
            dsl.deleteFrom(PROJECT_ISSUE_SEQUENCE)
                .where(PROJECT_ISSUE_SEQUENCE.PROJECT_ID.eq(projectId))
                .execute();
            dsl.deleteFrom(PROJECT_MEMBER).where(PROJECT_MEMBER.PROJECT_ID.eq(projectId)).execute();
            dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
            // 만든 사용자 — user_role·membership 은 user 삭제에 CASCADE 지만 역할 행은 명시적으로 먼저 지운다
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(userId)).execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
          });
      // 공유 DB 에 사용자가 남지 않았는지 확인 — 정리가 조용히 0건이면(RLS 등) 여기서 드러난다
      assertThat(callInTenant(1L, () -> dsl.fetchCount(USER, USER.ID.eq(userId)))).isZero();
    }
  }

  // ─── 헬퍼 ─────────────────────────────────────────────────────────────────

  /** USER 역할의 현재 테넌트 ACTIVE 멤버를 만든다. */
  private long createUser() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, id, "USER");
    return TestFixtures.activeMemberOfCurrentTenant(dsl, id);
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private long createCycle(
      long owner, String key, String name, LocalDate start, LocalDate end, String status) {
    return cycleService
        .create(owner, key, new CreateCycleRequest(name, null, start, end, status))
        .id();
  }

  private void attach(long issueId, long cycleId) {
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, cycleId)
        .execute();
  }

  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  private static CycleCompleteRequest none() {
    return new CycleCompleteRequest(Destination.NONE, null, null, null, null, null);
  }

  private static CycleCompleteRequest toNew(String name, LocalDate start, LocalDate end) {
    return new CycleCompleteRequest(Destination.NEW, null, null, name, start, end);
  }

  private static CycleCompleteRequest toScheduled(Long targetId, Boolean startNow) {
    return new CycleCompleteRequest(Destination.SCHEDULED, targetId, startNow, null, null, null);
  }

  /** 완료 요청을 보낸다 — 본문은 요청 DTO 를 앱과 같은 ObjectMapper 로 직렬화해 만든다(필드 이름·날짜 형식을 손으로 맞추지 않게). */
  private ResultActions complete(long userId, String key, Long cycleId, CycleCompleteRequest req)
      throws Exception {
    return mvc.perform(
        post("/api/v1/projects/" + key + "/cycles/" + cycleId + "/complete")
            .header("Authorization", "Bearer " + tokenFor(userId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(req)));
  }

  private ResultActions listCycles(long userId, String key) throws Exception {
    return mvc.perform(
        get("/api/v1/projects/" + key + "/cycles")
            .header("Authorization", "Bearer " + tokenFor(userId)));
  }
}

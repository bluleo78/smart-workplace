package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-886 — 이슈 우선순위 5단계(HIGHEST·HIGH·MID·LOW·LOWEST) 통합 테스트. 실 JWT + MockMvc 로 컨트롤러 → 서비스 → DB(V211
 * CHECK)까지 지나가며, 새 두 단계로 만들고 고칠 수 있는지·모르는 값은 400 인지·검색 필터와 그룹 총계가 새 값을 따로 세는지를 본다. 컨트롤러 단위
 * 테스트(IssueControllerTest)는 서비스를 목으로 두므로 DB 제약까지는 이 테스트가 지킨다.
 */
@Transactional
class IssuePriorityFiveLevelsTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;

  /** USER 역할 + 현재 테넌트 ACTIVE 멤버 사용자 시드. */
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

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void create_highest_then_patch_lowest_persists_and_unknown_is_400() throws Exception {
    long userId = createUser("pr");
    String key = uniqueKey("PR");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));

    // 매우 높음으로 생성 — DB CHECK(V211)가 새 값을 받아야 200.
    mvc.perform(
            post("/api/v1/projects/" + key + "/issues")
                .header("Authorization", bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"결제 장애\",\"priority\":\"HIGHEST\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.priority").value("HIGHEST"));

    // 매우 낮음으로 수정.
    mvc.perform(
            patch("/api/v1/projects/" + key + "/issues/1")
                .header("Authorization", bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"priority\":\"LOWEST\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.priority").value("LOWEST"));
    assertThat(
            dsl.select(ISSUE.PRIORITY)
                .from(ISSUE)
                .join(PROJECT)
                .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
                .where(PROJECT.KEY.eq(key))
                .and(ISSUE.NUMBER.eq(1))
                .fetchOne(ISSUE.PRIORITY))
        .isEqualTo("LOWEST");

    // 5단계 밖의 값은 생성·수정 모두 400.
    mvc.perform(
            post("/api/v1/projects/" + key + "/issues")
                .header("Authorization", bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"x\",\"priority\":\"URGENT\"}"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            patch("/api/v1/projects/" + key + "/issues/1")
                .header("Authorization", bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"priority\":\"URGENT\"}"))
        .andExpect(status().isBadRequest());
  }

  /**
   * 입력 검증(@Pattern)을 거치지 않는 경로(리포지토리·jOOQ 직접 쓰기)에서도 DB CHECK(V211)가 5단계 밖의 값을 거절한다 — 검증이 한 겹 뚫려도
   * 잘못된 값이 저장되지 않는지, 그리고 새 두 값은 통과하는지 본다.
   */
  @Test
  void db_check_constraint_rejects_out_of_range_priority_but_accepts_new_levels() {
    long userId = createUser("pc");
    ProjectResponse proj =
        projectService.create(userId, new CreateProjectRequest(uniqueKey("PC"), "P", "x"));
    IssueSeeds.insert(issueRepository, dsl, proj.id(), 1, "최고", null, "HIGHEST", null, userId);
    IssueSeeds.insert(issueRepository, dsl, proj.id(), 2, "최저", null, "LOWEST", null, userId);

    // 5단계 밖의 값은 DB 가 직접 거절한다(마지막 문장 — 거절된 트랜잭션은 테스트 롤백으로 정리).
    assertThatThrownBy(
            () ->
                IssueSeeds.insert(
                    issueRepository, dsl, proj.id(), 3, "긴급", null, "URGENT", null, userId))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void search_filter_and_group_counts_separate_highest_from_high() throws Exception {
    long userId = createUser("pg");
    String key = uniqueKey("PG");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    IssueSeeds.insert(issueRepository, dsl, proj.id(), 1, "긴급", null, "HIGHEST", null, userId);
    IssueSeeds.insert(issueRepository, dsl, proj.id(), 2, "긴급2", null, "HIGHEST", null, userId);
    IssueSeeds.insert(issueRepository, dsl, proj.id(), 3, "높음", null, "HIGH", null, userId);
    IssueSeeds.insert(issueRepository, dsl, proj.id(), 4, "보통", null, "MID", null, userId);
    IssueSeeds.insert(issueRepository, dsl, proj.id(), 5, "최저", null, "LOWEST", null, userId);

    // priority=HIGHEST 는 매우 높음만 — 높음과 섞이지 않는다(이 기능의 목적).
    mvc.perform(
            get("/api/v1/projects/" + key + "/issues")
                .param("priority", "HIGHEST")
                .header("Authorization", bearer(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(2)))
        .andExpect(jsonPath("$.items[*].number", containsInAnyOrder(1, 2)));
    mvc.perform(
            get("/api/v1/projects/" + key + "/issues")
                .param("priority", "lowest")
                .header("Authorization", bearer(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].number", containsInAnyOrder(5)));

    // 그룹 총계도 새 두 키를 따로 센다(0건인 LOW 는 빠진다).
    mvc.perform(
            get("/api/v1/projects/" + key + "/issues/group-counts")
                .param("groupBy", "priority")
                .header("Authorization", bearer(userId)))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.groups[*].key", containsInAnyOrder("HIGHEST", "HIGH", "MID", "LOWEST")))
        .andExpect(jsonPath("$.groups[?(@.key == 'HIGHEST')].count", containsInAnyOrder(2)));

    // 모르는 필터 값은 사용 가능 값(표시 순서)과 함께 400.
    mvc.perform(
            get("/api/v1/projects/" + key + "/issues")
                .param("priority", "URGENT")
                .header("Authorization", bearer(userId)))
        .andExpect(status().isBadRequest());
  }
}

package com.workplace.home.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.home.dto.PriorityItemRow;
import com.workplace.home.repository.PriorityItemRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * GET /api/v1/me/priority-items 통합 테스트. 실 JWT 발급 + MockMvc 로 전체 보안 체인을 통과시켜 점수 합산 내림차순 정렬을
 * 검증한다(DashboardEndpointTest 패턴 미러 — connection-init 이 tenant GUC 를 주입하므로 별도 TenantContext 조작 불필요).
 */
@AutoConfigureMockMvc
@Transactional
class PriorityItemControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired PriorityItemRepository repo;

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

  /** userId 용 access token 발급. */
  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void 우선순위_항목을_점수합산_내림차순으로_반환한다() throws Exception {
    long userId = createUser("pq");
    repo.replaceForUser(
        userId,
        List.of(
            new PriorityItemRow("MENTION", "low", "낮은 항목", "/x", 10, 10, "낮음"),
            new PriorityItemRow("ISSUE_DUE", "high", "높은 항목", "/y", 90, 90, "높음")));

    mockMvc
        .perform(
            get("/api/v1/me/priority-items").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].sourceId").value("high"))
        .andExpect(jsonPath("$.items[1].sourceId").value("low"));
  }
}

package com.workplace.action;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * POST /api/v1/actions/validate 컨트롤러 계약 테스트 (#842).
 *
 * <p>무엇을·왜: 사전검증 엔드포인트의 응답 계약을 고정한다 — 통과는 204(본문 없음), 실패는 승인(confirm)과 동일한 상태코드와 {@code
 * ErrorResponse.message} 로 사유가 전달돼야 AI 가 그 문구로 자가교정할 수 있다.
 */
@Transactional
class ActionControllerValidateTest extends IntegrationTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;

  private long callerId;
  private String projectKey;
  private String token;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    callerId = TestFixtures.createHuman(dsl);
    // project.create_project 는 project:write RBAC 게이트를 지나므로 USER 역할이 필요하다
    // (issue.create 만 쓰는 ActionControllerTest 와 달리 역할 부여가 필수).
    Long userRoleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, callerId)
        .set(USER_ROLE.ROLE_ID, userRoleId)
        .execute();
    projectKey = uniqueKey("AV");
    projectService.create(
        callerId, new CreateProjectRequest(projectKey, "Validate Test Project", null));
    token = jwtTokenProvider.generateAccessToken(callerId, "user-" + callerId);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private String uniqueKey(String prefix) {
    return prefix + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
  }

  @Test
  @DisplayName("성공 — 유효한 issue.create 사전검증은 204 + 본문 없음이고 이슈를 만들지 않는다")
  void validate_issueCreate_returns204AndCreatesNothing() throws Exception {
    // 무엇을·왜: dry-run 의 계약(실행 결과가 없으므로 본문도 없다)과 무흔적 보증을 엔드포인트 계층에서 확인.
    Long projectId =
        dsl.select(PROJECT.ID).from(PROJECT).where(PROJECT.KEY.eq(projectKey)).fetchOne(PROJECT.ID);
    Integer before =
        dsl.selectCount()
            .from(ISSUE)
            .where(ISSUE.PROJECT_ID.eq(projectId))
            .fetchOne(0, Integer.class);

    String body =
        """
        {"actionType":"issue.create","params":{"projectKey":"%s","title":"사전검증 이슈","priority":"MID"}}
        """
            .formatted(projectKey);

    mockMvc
        .perform(
            post("/api/v1/actions/validate")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isNoContent())
        .andExpect(content().string(""));

    Integer after =
        dsl.selectCount()
            .from(ISSUE)
            .where(ISSUE.PROJECT_ID.eq(projectId))
            .fetchOne(0, Integer.class);
    assertThat(after).isEqualTo(before);
  }

  @Test
  @DisplayName("실패 — 없는 projectKey 는 404 와 사유 메시지를 돌려준다")
  void validate_issueCreate_missingProject_returns404WithReason() throws Exception {
    // 무엇을·왜: 승인 때와 동일한 예외→ErrorResponse 매핑이 사전검증에도 적용되는지(AI 자가교정의 전제).
    String ghostKey = uniqueKey("GV");
    String body =
        """
        {"actionType":"issue.create","params":{"projectKey":"%s","title":"없는 프로젝트"}}
        """
            .formatted(ghostKey);

    mockMvc
        .perform(
            post("/api/v1/actions/validate")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString(ghostKey)));
  }

  @Test
  @DisplayName("실패 — 중복 key 프로젝트 생성 사전검증은 409 와 사유 메시지를 돌려준다")
  void validate_projectCreate_duplicateKey_returns409WithReason() throws Exception {
    // 무엇을·왜: 400/404 뿐 아니라 충돌(409)도 그대로 전달되는지 — 상태코드가 사유 해석의 1차 신호다.
    String body =
        """
        {"actionType":"project.create_project","params":{"key":"%s","name":"중복 키"}}
        """
            .formatted(projectKey);

    mockMvc
        .perform(
            post("/api/v1/actions/validate")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isConflict())
        .andExpect(
            jsonPath("$.message").value(org.hamcrest.Matchers.containsString("이미 사용 중인 key")));
  }
}

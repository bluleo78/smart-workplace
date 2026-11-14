package com.workplace.project.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * POST /api/v1/projects 입력 오류의 상태 코드 통합 테스트(WP-1595).
 *
 * <p>무엇을·왜: 지원하지 않는 type(NOPE·team·123)과 TEAM/OPEN 의 key 누락이 409(충돌)로 나와, 같은 부류의 입력 오류인 빈 문자열
 * key(@Pattern → 400)와 상태 코드가 갈렸다. 입력 오류는 400 + 한국어 사유, key 중복은 진짜 충돌이라 여전히 409 임을 실제 서비스·예외 처리기까지
 * 통과시켜 고정한다(컨트롤러 슬라이스 테스트는 서비스를 mock 해 이 매핑을 볼 수 없다).
 */
@Transactional
class ProjectCreateInputValidationTest extends IntegrationTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;

  private String token;
  private String existingKey;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    long callerId = TestFixtures.createHuman(dsl);
    // 프로젝트 생성은 project:write 게이트를 지나므로 USER 역할 + 현재 테넌트 ACTIVE 멤버가 필요하다.
    Long userRoleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, callerId)
        .set(USER_ROLE.ROLE_ID, userRoleId)
        .execute();
    TestFixtures.activeMemberOfCurrentTenant(dsl, callerId);
    existingKey = uniqueKey("PV");
    projectService.create(callerId, new CreateProjectRequest(existingKey, "기존 프로젝트", null));
    token = jwtTokenProvider.generateAccessToken(callerId, "user-" + callerId);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private String uniqueKey(String prefix) {
    return prefix + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
  }

  private ResultActions postProject(String json) throws Exception {
    return mockMvc.perform(
        post("/api/v1/projects")
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(json));
  }

  @ParameterizedTest
  @ValueSource(strings = {"NOPE", "team", "123"})
  @DisplayName("지원하지 않는 type 은 409 가 아니라 400 + 허용 값 안내")
  void unsupportedType_returns400(String type) throws Exception {
    postProject(
            """
            {"key":"%s","name":"유형 오류","type":"%s"}
            """
                .formatted(uniqueKey("TY"), type))
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message")
                .value("지원하지 않는 프로젝트 유형입니다: " + type + " — TEAM·OPEN·PERSONAL 중 하나여야 합니다"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"TEAM", "OPEN"})
  @DisplayName("공유 프로젝트(TEAM·OPEN)에 key 가 없으면 409 가 아니라 400")
  void sharedWithoutKey_returns400(String type) throws Exception {
    postProject(
            """
            {"name":"키 없음","type":"%s"}
            """
                .formatted(type))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("공유 프로젝트는 key 가 필요합니다"));
  }

  @Test
  @DisplayName("key 중복은 진짜 충돌이라 여전히 409")
  void duplicateKey_stillReturns409() throws Exception {
    postProject(
            """
            {"key":"%s","name":"중복","type":"TEAM"}
            """
                .formatted(existingKey))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(containsString("이미 사용 중인 key")));
  }

  @Test
  @DisplayName("정상 TEAM 생성은 200")
  void validTeam_returns200() throws Exception {
    String key = uniqueKey("OK");
    postProject(
            """
            {"key":"%s","name":"정상","type":"TEAM"}
            """
                .formatted(key))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.key").value(key));
  }
}

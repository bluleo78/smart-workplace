package com.workplace.action;

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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 중립 확인 엔드포인트 — actionType 라우팅(여기선 issue.create 로 검증). */
@AutoConfigureMockMvc
@Transactional
class ActionControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;

  private long callerId;
  private String projectKey;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    // 프로젝트 멤버(오너) 사용자 생성
    callerId = TestFixtures.createHuman(dsl);
    // 유니크 프로젝트 키 생성 후 프로젝트 생성 — caller 가 OWNER 멤버로 자동 등록됨
    projectKey =
        ("AC" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4))
            .substring(0, 6);
    projectService.create(
        callerId, new CreateProjectRequest(projectKey, "Action Test Project", null));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /**
   * [정상] 프로젝트 멤버가 POST /api/v1/actions/confirm {actionType:issue.create} 을 호출하면 201 과 이슈 응답을 반환한다.
   */
  @Test
  void confirm_issueCreate_returns201WithIssue() throws Exception {
    // JWT 토큰 발급 — 실제 필터 체인 통과
    String token = jwtTokenProvider.generateAccessToken(callerId, "user-" + callerId);

    String body =
        """
        {"actionType":"issue.create","params":{"projectKey":"%s","title":"엔드포인트 이슈","priority":"MID"}}
        """
            .formatted(projectKey);

    mockMvc
        .perform(
            post("/api/v1/actions/confirm")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.title").value("엔드포인트 이슈"))
        .andExpect(jsonPath("$.projectKey").value(projectKey));
  }
}

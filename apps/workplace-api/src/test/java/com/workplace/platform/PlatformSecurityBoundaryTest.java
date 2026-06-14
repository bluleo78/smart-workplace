package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * /api/platform 보안 경계 테스트 — 운영자 평면은 플랫폼 토큰(ROLE_PLATFORM)만 통과한다.
 *
 * <p>핵심 불변식(권한상승 차단): 일반 테넌트 토큰·Internal(에이전트) 토큰·미인증 어느 것도 /api/platform/** 에 접근할 수 없다. 이 시점엔
 * /api/platform 컨트롤러가 아직 없으므로(Task 5), 검증은 security chain 의 응답 코드로 한다 — 컨트롤러 도달 전 거부는 401/403, 게이트
 * 통과 시 핸들러가 없어 404. 따라서 "403 이 아님(404)" 으로 게이트가 열렸는지를 판별한다.
 */
@AutoConfigureMockMvc
@Transactional
class PlatformSecurityBoundaryTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** USER 역할이 부여된 일반 사용자 시드. */
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

  /** (a) 권한상승 차단(헤드라인): 일반 테넌트 토큰으로는 /api/platform 에 접근 불가 → 403. */
  @Test
  void tenantToken_isDeniedOnPlatformPlane() throws Exception {
    long uid = createUser("tenant");
    String token = jwtTokenProvider.generateAccessToken(uid, "name", 1L);

    mvc.perform(get("/api/platform/tenants").header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());
  }

  /** (b) 미인증: 토큰 없이 /api/platform 접근 → 401(custom entryPoint). */
  @Test
  void unauthenticated_isRejectedOnPlatformPlane() throws Exception {
    mvc.perform(get("/api/platform/tenants")).andExpect(status().isUnauthorized());
  }

  /** (e) 에이전트 누수 차단: Internal 토큰(테넌트 권한만)으로는 /api/platform 접근 불가 → 403. */
  @Test
  void internalAgentToken_isDeniedOnPlatformPlane() throws Exception {
    long uid = createUser("agent");

    mvc.perform(
            get("/api/platform/tenants")
                .header("Authorization", "Internal test-token")
                .header("X-On-Behalf-Of", String.valueOf(uid)))
        .andExpect(status().isForbidden());
  }

  /** (c) 공개 경로 게이트 면제: /api/platform/auth/login 은 ROLE_PLATFORM 게이트에서 면제 → 403 이 아님. */
  @Test
  void platformAuthLogin_isNotGatedByPlatformRole() throws Exception {
    int s =
        mvc.perform(post("/api/platform/auth/login").contentType("application/json").content("{}"))
            .andReturn()
            .getResponse()
            .getStatus();
    // 핸들러가 아직 없어 404 등이 나올 수 있으나, 핵심은 ROLE_PLATFORM 거부(403)가 아니라는 것.
    org.assertj.core.api.Assertions.assertThat(s).isNotEqualTo(403);
  }

  /**
   * (d) 양성 대조: 플랫폼 토큰은 게이트를 통과한다 → 인가 거부(403/401)가 아님. 게이트가 "열린다"는 증명. 컨트롤러 부재 시 404 이지만, 이후 Task
   * 에서 컨트롤러가 추가돼도 깨지지 않도록 상태코드 동치 비교 대신 인가거부 아님만 단언한다.
   */
  @Test
  void platformToken_passesGate() throws Exception {
    long uid = createUser("platform");
    String token = jwtTokenProvider.generatePlatformAccessToken(uid, "name");

    int s =
        mvc.perform(get("/api/platform/tenants").header("Authorization", "Bearer " + token))
            .andReturn()
            .getResponse()
            .getStatus();
    org.assertj.core.api.Assertions.assertThat(s).isNotEqualTo(403).isNotEqualTo(401);
  }
}

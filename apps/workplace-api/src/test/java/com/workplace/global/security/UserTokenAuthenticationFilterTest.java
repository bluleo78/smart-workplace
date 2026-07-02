package com.workplace.global.security;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_API_TOKEN;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.dto.UserApiTokenIssueResponse;
import com.workplace.auth.service.UserApiTokenService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

/**
 * PAT(Bearer swp_...) 인증 필터 통합 테스트. RANDOM_PORT 환경에서 실제 HTTP 호출로 필터 동작/SecurityContext 세팅/테넌트 바인딩
 * fail-closed/last_used_at 갱신을 검증한다. ApiKeyAuthenticationFilterTest 미러 — 실제 HTTP 요청은 별도
 * 트랜잭션이라 @Transactional 사용 시 시드가 보이지 않으므로 수동 cleanup 한다.
 */
class UserTokenAuthenticationFilterTest extends IntegrationTestBase {

  @Autowired private UserApiTokenService tokenService;
  @Autowired private DSLContext dsl;
  @LocalServerPort private int port;

  private static final long DEFAULT_TENANT_ID = 1L;

  private final RestTemplate rest = new RestTemplateBuilder().build();

  private Long humanUserId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    humanUserId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "human-swp-" + n)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Human")
            .set(USER.EMAIL, "human-swp-" + n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, humanUserId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, humanUserId)
        .set(MEMBERSHIP.TENANT_ID, DEFAULT_TENANT_ID)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
  }

  @AfterEach
  void cleanup() {
    // membership 은 app_tenant 런타임 롤의 DELETE 권한이 회수돼(V46) 직접 지울 수 없다 —
    // user 삭제 시 ON DELETE CASCADE 로 함께 정리된다.
    if (humanUserId != null) {
      dsl.deleteFrom(com.workplace.jooq.Tables.AUDIT_LOG)
          .where(com.workplace.jooq.Tables.AUDIT_LOG.USER_ID.eq(humanUserId))
          .execute();
      // GET /api/v1/projects 호출이 HUMAN 사용자에게 기본 개인 프로젝트를 지연 프로비저닝하므로
      // (ProjectService.list → PersonalProjectProvisioner) user 삭제 전에 먼저 정리해야 FK 위반이 없다.
      dsl.deleteFrom(com.workplace.jooq.Tables.PROJECT)
          .where(com.workplace.jooq.Tables.PROJECT.OWNER_ID.eq(humanUserId))
          .execute();
      dsl.deleteFrom(USER).where(USER.ID.eq(humanUserId)).execute();
    }
  }

  /** 발급 시점의 활성 테넌트(TenantContext)에 PAT 를 바인딩한다 — 요청 밖에서 직접 서비스를 호출하므로 수동 설정. */
  private UserApiTokenIssueResponse issueToken() {
    TenantContext.set(DEFAULT_TENANT_ID);
    try {
      return tokenService.issue(humanUserId, new IssueUserTokenRequest("test", null));
    } finally {
      TenantContext.clear();
    }
  }

  private ResponseEntity<String> call(String authValue, String path) {
    HttpHeaders headers = new HttpHeaders();
    if (authValue != null) headers.set("Authorization", authValue);
    try {
      return rest.exchange(
          "http://localhost:" + port + path,
          HttpMethod.GET,
          new HttpEntity<>(headers),
          String.class);
    } catch (org.springframework.web.client.HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
    }
  }

  private ResponseEntity<String> callMe(String authValue) {
    return call(authValue, "/api/v1/users/me");
  }

  /** membership 을 status='SUSPENDED' 로 직접 갱신해 fail-closed 테스트에 사용(membership_status_check 허용값). */
  private void deactivateMembership(long userId, long tenantId) {
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(userId))
        .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .execute();
  }

  @Test
  void valid_swp_authenticates_as_human_user() {
    UserApiTokenIssueResponse res = issueToken();
    ResponseEntity<String> me = callMe("Bearer " + res.plaintextToken());
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(me.getBody()).contains("\"kind\":\"HUMAN\"");
  }

  @Test
  void tenant_guc_injected_rls_table_visible() {
    // PAT 로 RLS 테이블 조회가 되는지 — GET /api/v1/projects 가 200 이면 테넌트 GUC 가 정상 주입된 것
    // (미주입이면 RLS fail-closed 로 빈 결과/권한 오류).
    UserApiTokenIssueResponse res = issueToken();
    ResponseEntity<String> projects = call("Bearer " + res.plaintextToken(), "/api/v1/projects");
    assertThat(projects.getStatusCode()).isEqualTo(HttpStatus.OK);
  }

  @Test
  void unknown_swp_is_401() {
    ResponseEntity<String> me = callMe("Bearer swp_neverexists0000000000000000000000000000000");
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void revoked_swp_is_401() {
    UserApiTokenIssueResponse res = issueToken();
    TenantContext.set(DEFAULT_TENANT_ID);
    try {
      tokenService.revoke(humanUserId, res.id());
    } finally {
      TenantContext.clear();
    }
    ResponseEntity<String> me = callMe("Bearer " + res.plaintextToken());
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void expired_swp_is_401() {
    TenantContext.set(DEFAULT_TENANT_ID);
    UserApiTokenIssueResponse res;
    try {
      res =
          tokenService.issue(
              humanUserId,
              new IssueUserTokenRequest("test", java.time.Instant.now().minusSeconds(60)));
    } finally {
      TenantContext.clear();
    }
    ResponseEntity<String> me = callMe("Bearer " + res.plaintextToken());
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void membership_revoked_fail_closed_401() {
    // 토큰의 tenant_id 가 사용자의 ACTIVE 멤버십에 없으면 인증 자체가 성립하지 않는다.
    UserApiTokenIssueResponse res = issueToken();
    deactivateMembership(humanUserId, DEFAULT_TENANT_ID);
    assertThat(callMe("Bearer " + res.plaintextToken()).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void last_used_at_updated_after_successful_call() {
    UserApiTokenIssueResponse res = issueToken();
    callMe("Bearer " + res.plaintextToken());
    var lastUsed =
        dsl.select(USER_API_TOKEN.LAST_USED_AT)
            .from(USER_API_TOKEN)
            .where(USER_API_TOKEN.ID.eq(res.id()))
            .fetchOne(USER_API_TOKEN.LAST_USED_AT);
    assertThat(lastUsed).isNotNull();
  }
}

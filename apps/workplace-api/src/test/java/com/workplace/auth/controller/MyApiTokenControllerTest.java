package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.dto.UserApiTokenIssueResponse;
import com.workplace.auth.dto.UserApiTokenResponse;
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
 * 본인 PAT 관리 API 통합 테스트. 셋업에서 서비스로 직접 발급한 PAT 를 인증 수단(Authorization 헤더)으로 실어 HTTP 로 GET/POST/DELETE
 * 를 검증한다(자기 자신을 검증하는 구조) — UserTokenAuthenticationFilterTest 의 시드/cleanup 패턴을 미러.
 */
class MyApiTokenControllerTest extends IntegrationTestBase {

  @Autowired private UserApiTokenService tokenService;
  @Autowired private DSLContext dsl;
  @LocalServerPort private int port;

  private static final long DEFAULT_TENANT_ID = 1L;

  private final RestTemplate rest = new RestTemplateBuilder().build();

  private Long humanUserId;
  private Long otherUserId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    humanUserId = createUser("human-mypat-" + n);
    otherUserId = createUser("other-mypat-" + n);
  }

  private Long createUser(String username) {
    Long userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Human")
            .set(USER.EMAIL, username + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, DEFAULT_TENANT_ID)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return userId;
  }

  @AfterEach
  void cleanup() {
    // membership 은 app_tenant 런타임 롤의 DELETE 권한이 회수돼(V46) 직접 지울 수 없다 —
    // user 삭제 시 ON DELETE CASCADE 로 함께 정리된다.
    for (Long userId : new Long[] {humanUserId, otherUserId}) {
      if (userId == null) continue;
      dsl.deleteFrom(com.workplace.jooq.Tables.AUDIT_LOG)
          .where(com.workplace.jooq.Tables.AUDIT_LOG.USER_ID.eq(userId))
          .execute();
      dsl.deleteFrom(com.workplace.jooq.Tables.PROJECT)
          .where(com.workplace.jooq.Tables.PROJECT.OWNER_ID.eq(userId))
          .execute();
      dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
    }
  }

  /** 발급 시점의 활성 테넌트(TenantContext)에 PAT 를 바인딩한다 — 요청 밖에서 직접 서비스를 호출하므로 수동 설정. */
  private UserApiTokenIssueResponse issueToken(Long userId, String name) {
    TenantContext.set(DEFAULT_TENANT_ID);
    try {
      return tokenService.issue(userId, new IssueUserTokenRequest(name, null));
    } finally {
      TenantContext.clear();
    }
  }

  private ResponseEntity<String> exchange(String authValue, HttpMethod method, String path) {
    HttpHeaders headers = new HttpHeaders();
    if (authValue != null) headers.set("Authorization", authValue);
    try {
      return rest.exchange(
          "http://localhost:" + port + path, method, new HttpEntity<>(headers), String.class);
    } catch (org.springframework.web.client.HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
    }
  }

  private ResponseEntity<UserApiTokenIssueResponse> issueViaHttp(String authValue, String name) {
    HttpHeaders headers = new HttpHeaders();
    if (authValue != null) headers.set("Authorization", authValue);
    headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
    HttpEntity<IssueUserTokenRequest> entity =
        new HttpEntity<>(new IssueUserTokenRequest(name, null), headers);
    return rest.exchange(
        "http://localhost:" + port + "/api/v1/users/me/api-tokens",
        HttpMethod.POST,
        entity,
        UserApiTokenIssueResponse.class);
  }

  @Test
  void issue_list_revoke_full_lifecycle() {
    UserApiTokenIssueResponse authToken = issueToken(humanUserId, "인증용");
    String bearer = "Bearer " + authToken.plaintextToken();

    // POST — 새 PAT 발급, 평문 포함
    ResponseEntity<UserApiTokenIssueResponse> issueRes = issueViaHttp(bearer, "내 노트북");
    assertThat(issueRes.getStatusCode()).isIn(HttpStatus.OK, HttpStatus.CREATED);
    assertThat(issueRes.getBody()).isNotNull();
    assertThat(issueRes.getBody().plaintextToken()).startsWith("swp_");
    Long issuedId = issueRes.getBody().id();

    // GET — 목록에 평문/해시 없음
    ResponseEntity<UserApiTokenResponse[]> listRes =
        rest.exchange(
            "http://localhost:" + port + "/api/v1/users/me/api-tokens",
            HttpMethod.GET,
            new HttpEntity<>(authHeaders(bearer)),
            UserApiTokenResponse[].class);
    assertThat(listRes.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(listRes.getBody()).extracting(UserApiTokenResponse::name).contains("내 노트북");
    // 응답 문자열 자체에 평문/해시 필드가 없는지 원시 String 조회로도 확인
    ResponseEntity<String> rawListRes =
        exchange(bearer, HttpMethod.GET, "/api/v1/users/me/api-tokens");
    assertThat(rawListRes.getBody()).doesNotContain("plaintextToken").doesNotContain("tokenHash");

    // DELETE — 회수
    ResponseEntity<String> deleteRes =
        exchange(bearer, HttpMethod.DELETE, "/api/v1/users/me/api-tokens/" + issuedId);
    assertThat(deleteRes.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
  }

  private HttpHeaders authHeaders(String bearer) {
    HttpHeaders headers = new HttpHeaders();
    headers.set("Authorization", bearer);
    return headers;
  }

  @Test
  void revoked_token_used_for_auth_is_401() {
    UserApiTokenIssueResponse target = issueToken(humanUserId, "회수대상");
    String bearer = "Bearer " + target.plaintextToken();

    // 유효할 때 GET 성공 확인
    assertThat(exchange(bearer, HttpMethod.GET, "/api/v1/users/me/api-tokens").getStatusCode())
        .isEqualTo(HttpStatus.OK);

    // 다른(관리용) 토큰으로 회수
    UserApiTokenIssueResponse admin = issueToken(humanUserId, "관리용");
    exchange(
        "Bearer " + admin.plaintextToken(),
        HttpMethod.DELETE,
        "/api/v1/users/me/api-tokens/" + target.id());

    // 회수된 토큰으로 재호출 시 401
    ResponseEntity<String> afterRevoke =
        exchange(bearer, HttpMethod.GET, "/api/v1/users/me/api-tokens");
    assertThat(afterRevoke.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void delete_other_users_token_is_404() {
    UserApiTokenIssueResponse mine = issueToken(humanUserId, "내인증");
    UserApiTokenIssueResponse others = issueToken(otherUserId, "타인토큰");

    ResponseEntity<String> res =
        exchange(
            "Bearer " + mine.plaintextToken(),
            HttpMethod.DELETE,
            "/api/v1/users/me/api-tokens/" + others.id());
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
  }
}

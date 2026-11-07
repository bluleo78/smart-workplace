package com.workplace.global.security;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.auth.service.UserApiTokenService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.UserKind;
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
 * Authorization 헤더의 Bearer scheme 을 대소문자 구분 없이 받는지 통합 테스트(WP-1431, RFC 7235 §2.1). RANDOM_PORT 에서
 * 실제 HTTP 로 {@code /api/v1/users/me} 를 불러, 소문자 {@code bearer}·대문자 {@code BEARER} 로 JWT·AI
 * 키(ak_)·PAT(swp_)가 각각 인증되고(200) Basic·토큰 없음은 여전히 401 인지 본다. ApiKey/UserToken 필터 테스트 미러 — 실제 HTTP
 * 요청은 별도 트랜잭션이라 시드를 커밋하고 수동 cleanup 한다.
 */
class BearerSchemeCaseInsensitiveTest extends IntegrationTestBase {

  private static final long DEFAULT_TENANT_ID = 1L;

  @Autowired private DSLContext dsl;
  @Autowired private JwtTokenProvider jwtTokenProvider;
  @Autowired private UserApiTokenService userTokenService;
  @Autowired private AgentApiKeyService agentKeyService;
  @LocalServerPort private int port;

  private final RestTemplate rest = new RestTemplateBuilder().build();

  private Long humanId;
  private String humanUsername;
  private Long agentId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    humanUsername = "human-bearer-" + n;
    humanId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, humanUsername)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Human")
            .set(USER.EMAIL, humanUsername + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    grantUserRole(humanId);
    withMembership(humanId);
    agentId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "agent-bearer-" + n)
            .setNull(USER.PASSWORD)
            .set(USER.NAME, "Agent")
            .set(USER.EMAIL, "agent-bearer-" + n + "@example.com")
            .set(USER.KIND, UserKind.AGENT)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // AI 키 발급은 대상 AI 가 지금 워크스페이스 구성원일 때만 된다(WP-703).
    withMembership(agentId);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    // 발급 감사 로그가 tenant#1 로 남으므로 그 테넌트 GUC 안에서 지운다. /users/me 가 지연 프로비저닝한 개인 프로젝트도 user 삭제
    // 전에 지워 FK 위반을 피한다(membership·키·토큰은 user 삭제 시 CASCADE).
    cleanupInTenant(
        DEFAULT_TENANT_ID,
        () -> {
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(humanId, agentId)).execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.in(humanId, agentId)).execute();
          // AI 를 먼저 지운다 — AI 키의 created_by 가 사람 사용자를 참조하므로(키는 AI 삭제 시 CASCADE).
          dsl.deleteFrom(USER).where(USER.ID.eq(agentId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(humanId)).execute();
        });
  }

  /** 사람 사용자의 tenant#1 access JWT. */
  private String jwt() {
    return jwtTokenProvider.generateAccessToken(humanId, humanUsername, DEFAULT_TENANT_ID);
  }

  /** 사람 사용자의 PAT(swp_) 평문 — 발급 시점 TenantContext 에 바인딩되므로 tenant#1 로 설정해 발급한다. */
  private String pat() {
    TenantContext.set(DEFAULT_TENANT_ID);
    try {
      return userTokenService
          .issue(humanId, new IssueUserTokenRequest("bearer-case", null))
          .plaintextToken();
    } finally {
      TenantContext.clear();
    }
  }

  /** AI 의 API 키(ak_) 평문 — 발급자는 사람 사용자, tenant#1 컨텍스트에서 발급한다. */
  private String agentKey() {
    TenantContext.set(DEFAULT_TENANT_ID);
    try {
      return agentKeyService
          .issue(humanId, agentId, new IssueAgentKeyRequest("bearer-case"))
          .plaintextKey();
    } finally {
      TenantContext.clear();
    }
  }

  private ResponseEntity<String> callMe(String authValue) {
    HttpHeaders headers = new HttpHeaders();
    if (authValue != null) headers.set("Authorization", authValue);
    try {
      return rest.exchange(
          "http://localhost:" + port + "/api/v1/users/me",
          HttpMethod.GET,
          new HttpEntity<>(headers),
          String.class);
    } catch (org.springframework.web.client.HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
    }
  }

  @Test
  void jwt_authenticates_with_lower_and_upper_case_scheme() {
    String token = jwt();
    for (String scheme : new String[] {"bearer ", "BEARER "}) {
      ResponseEntity<String> me = callMe(scheme + token);
      assertThat(me.getStatusCode()).as(scheme).isEqualTo(HttpStatus.OK);
      assertThat(me.getBody()).as(scheme).contains("\"id\":" + humanId);
    }
  }

  @Test
  void agent_key_authenticates_with_lower_and_upper_case_scheme() {
    String key = agentKey();
    for (String scheme : new String[] {"bearer ", "BEARER "}) {
      ResponseEntity<String> me = callMe(scheme + key);
      assertThat(me.getStatusCode()).as(scheme).isEqualTo(HttpStatus.OK);
      assertThat(me.getBody()).as(scheme).contains("\"kind\":\"AGENT\"");
    }
  }

  @Test
  void pat_authenticates_with_lower_and_upper_case_scheme() {
    String pat = pat();
    for (String scheme : new String[] {"bearer ", "BEARER "}) {
      ResponseEntity<String> me = callMe(scheme + pat);
      assertThat(me.getStatusCode()).as(scheme).isEqualTo(HttpStatus.OK);
      assertThat(me.getBody()).as(scheme).contains("\"kind\":\"HUMAN\"");
    }
  }

  @Test
  void basic_scheme_or_missing_token_stays_unauthorized() {
    // 다른 scheme 에 유효한 JWT 를 실어도 Bearer 가 아니므로 인증하지 않는다.
    assertThat(callMe("Basic " + jwt()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(callMe("Basic dXNlcjpwYXNz").getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    // scheme 뒤 공백 없이 붙인 값도 Bearer 가 아니다.
    assertThat(callMe("bearer" + jwt()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    // 허용 범위는 대소문자만 넓힌다 — scheme 뒤 공백 둘이면 토큰 앞에 공백이 남아 예전처럼 인증되지 않는다.
    assertThat(callMe("Bearer  " + jwt()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    // 토큰 없음 — scheme 만 있거나 헤더 자체가 없음.
    assertThat(callMe("bearer").getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(callMe(null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }
}

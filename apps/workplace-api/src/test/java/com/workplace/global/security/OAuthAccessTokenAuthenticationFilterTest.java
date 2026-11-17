package com.workplace.global.security;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static com.workplace.jooq.Tables.OAUTH_CONNECTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.dto.UserApiTokenIssueResponse;
import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.auth.oauth.repository.OAuthTokenRepository;
import com.workplace.auth.service.UserApiTokenService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

/**
 * OAuth access 토큰(Bearer swo_...) 인증 필터 통합 테스트(WP-1685). RANDOM_PORT 에서 실제 HTTP 로 부른다 —
 * UserTokenAuthenticationFilterTest 처럼 요청이 별도 트랜잭션이라 시드를 커밋하고 끝에 직접 지운다(사용자 삭제가 연결·토큰을 CASCADE 로 함께
 * 지운다). 토큰은 발급 흐름 없이 저장소로 직접 넣어(연결 + ACCESS 행) 필터만 검증한다.
 */
class OAuthAccessTokenAuthenticationFilterTest extends IntegrationTestBase {

  private static final long DEFAULT_TENANT_ID = 1L;

  @Autowired private DSLContext dsl;
  @Autowired private OAuthClientRepository clients;
  @Autowired private OAuthConnectionRepository connections;
  @Autowired private OAuthTokenRepository tokens;
  @Autowired private UserApiTokenService patService;
  @LocalServerPort private int port;

  private final RestTemplate rest = new RestTemplateBuilder().build();

  /** 정리 대상 — 사용자(연결·토큰 CASCADE)와 DCR 클라이언트. */
  private final List<Long> userIds = new ArrayList<>();

  private long humanUserId;
  private long clientPk;

  @BeforeEach
  void seed() {
    humanUserId = TestFixtures.createHuman(dsl);
    userIds.add(humanUserId);
    // UserTokenAuthenticationFilterTest 와 같은 시드 — 기본 테넌트의 USER 역할 + ACTIVE 멤버십.
    TestFixtures.grantRole(dsl, humanUserId, "USER");
    TestFixtures.ensureActiveMember(dsl, humanUserId, DEFAULT_TENANT_ID);
    clientPk =
        clients
            .insertDcr(
                "swc_filter_" + System.nanoTime(), "필터 테스트 앱", List.of("https://app.example/cb"))
            .id();
  }

  @AfterEach
  void cleanup() {
    // membership 은 런타임 롤이 직접 지울 수 없어(V46) user 삭제 CASCADE 로 정리한다. oauth_connection·oauth_token 도
    // CASCADE.
    for (Long id : userIds) {
      dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(id)).execute();
      dsl.deleteFrom(USER).where(USER.ID.eq(id)).execute();
    }
    dsl.deleteFrom(OAUTH_CLIENT).where(OAUTH_CLIENT.ID.eq(clientPk)).execute();
  }

  /** 저장소로 직접 넣은 토큰의 평문과 그 연결 id. */
  private record Seeded(String plaintext, long connectionId) {}

  /** 연결(없으면 생성) + 토큰 한 행을 저장소로 직접 만든다. */
  private Seeded seedToken(long userId, String prefix, String kind, OffsetDateTime expiresAt) {
    long connectionId =
        connections.findOrCreateActive(userId, DEFAULT_TENANT_ID, clientPk).row().id();
    String plaintext = CapabilityTokens.generate(prefix);
    tokens.insert(
        connectionId,
        kind,
        CapabilityTokens.sha256Hex(plaintext),
        plaintext.substring(0, 12),
        null,
        expiresAt);
    return new Seeded(plaintext, connectionId);
  }

  private Seeded seedAccess(long userId) {
    return seedToken(userId, "swo_", "ACCESS", OffsetDateTime.now().plusHours(1));
  }

  private ResponseEntity<String> exchange(
      HttpMethod method, String path, String bearer, String jsonBody) {
    HttpHeaders headers = new HttpHeaders();
    headers.set("Authorization", "Bearer " + bearer);
    if (jsonBody != null) headers.setContentType(MediaType.APPLICATION_JSON);
    try {
      return rest.exchange(
          "http://localhost:" + port + path,
          method,
          new HttpEntity<>(jsonBody, headers),
          String.class);
    } catch (HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
    }
  }

  private ResponseEntity<String> callMe(String bearer) {
    return exchange(HttpMethod.GET, "/api/v1/auth/me", bearer, null);
  }

  private OffsetDateTime connectionLastUsed(long connectionId) {
    return dsl.select(OAUTH_CONNECTION.LAST_USED_AT)
        .from(OAUTH_CONNECTION)
        .where(OAUTH_CONNECTION.ID.eq(connectionId))
        .fetchOne(OAUTH_CONNECTION.LAST_USED_AT);
  }

  /** 발급 시점의 활성 테넌트에 PAT 를 바인딩한다 — 요청 밖에서 서비스를 직접 부르므로 수동 설정. */
  private UserApiTokenIssueResponse issuePat() {
    TenantContext.set(DEFAULT_TENANT_ID);
    try {
      return patService.issue(humanUserId, new IssueUserTokenRequest("test", null));
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void swoAccess_authenticatesAsUserAndTenant() {
    Seeded s = seedAccess(humanUserId);

    ResponseEntity<String> me = callMe(s.plaintext());

    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(me.getBody()).contains("\"id\":" + humanUserId + ",");
    assertThat(connectionLastUsed(s.connectionId())).as("성공 때 연결 last_used_at 갱신").isNotNull();
  }

  @Test
  void swoAccess_tenantGucInjected_rlsTableVisible() {
    // RLS 테이블 조회(GET /api/v1/projects)가 200 이면 토큰의 테넌트 GUC 가 주입된 것 — PAT 테스트와 같은 확인.
    Seeded s = seedAccess(humanUserId);
    try {
      assertThat(exchange(HttpMethod.GET, "/api/v1/projects", s.plaintext(), null).getStatusCode())
          .isEqualTo(HttpStatus.OK);
    } finally {
      // 목록 조회가 기본 개인 프로젝트를 지연 프로비저닝한다 — user 삭제 전에 지워야 FK 위반이 없다.
      dsl.deleteFrom(com.workplace.jooq.Tables.PROJECT)
          .where(com.workplace.jooq.Tables.PROJECT.OWNER_ID.eq(humanUserId))
          .execute();
    }
  }

  @Test
  void membershipSuspended_is401() {
    Seeded s = seedAccess(humanUserId);
    TestFixtures.suspendMember(dsl, humanUserId, DEFAULT_TENANT_ID);

    assertThat(callMe(s.plaintext()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(connectionLastUsed(s.connectionId())).as("실패 때는 갱신하지 않는다").isNull();
  }

  @Test
  void revokedConnection_is401() {
    Seeded s = seedAccess(humanUserId);
    assertThat(connections.revoke(s.connectionId(), humanUserId)).isTrue();

    assertThat(callMe(s.plaintext()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void expiredAccess_is401() {
    Seeded s = seedToken(humanUserId, "swo_", "ACCESS", OffsetDateTime.now().minusSeconds(60));

    assertThat(callMe(s.plaintext()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void unknownSwo_is401() {
    assertThat(callMe(CapabilityTokens.generate("swo_")).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void refreshTokenAsBearer_is401() {
    Seeded s = seedToken(humanUserId, "swr_", "REFRESH", OffsetDateTime.now().plusDays(30));

    assertThat(callMe(s.plaintext()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void agentUserToken_is401() {
    long agentId = TestFixtures.createAgentNoToken(dsl);
    userIds.add(agentId);
    TestFixtures.ensureActiveMember(dsl, agentId, DEFAULT_TENANT_ID);
    Seeded s = seedAccess(agentId);

    assertThat(callMe(s.plaintext()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void swoCannotIssuePat() {
    // 웹 세션 전용 API — PAT 로 막히는 것과 같은 상태 코드여야 한다(AuthDetails 없음 → 403).
    String body = "{\"name\":\"from-token\"}";
    UserApiTokenIssueResponse pat = issuePat();
    HttpStatus patStatus =
        HttpStatus.valueOf(
            exchange(HttpMethod.POST, "/api/v1/users/me/api-tokens", pat.plaintextToken(), body)
                .getStatusCode()
                .value());
    Seeded s = seedAccess(humanUserId);

    ResponseEntity<String> r =
        exchange(HttpMethod.POST, "/api/v1/users/me/api-tokens", s.plaintext(), body);

    assertThat(patStatus).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(r.getStatusCode()).isEqualTo(patStatus);
  }

  @Test
  void patStillWorks() {
    UserApiTokenIssueResponse pat = issuePat();

    ResponseEntity<String> me = callMe(pat.plaintextToken());

    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(me.getBody()).contains("\"id\":" + humanUserId + ",");
  }
}

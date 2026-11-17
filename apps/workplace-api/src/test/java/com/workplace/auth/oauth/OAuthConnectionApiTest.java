package com.workplace.auth.oauth;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static com.workplace.jooq.Tables.OAUTH_CONNECTION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import com.workplace.user.service.UserService;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.util.MultiValueMap;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1685 — 「내 OAuth 연결」 목록·끊기 API 통합 테스트({@code GET/DELETE /api/v1/users/me/oauth-connections}).
 *
 * <p>끊은 뒤 그 연결의 {@code swo_} 가 실제 HTTP 로 401 이 되는지, 남은 code·refresh 가 거절되는지를 봐야 하므로 클래스 단위 트랜잭션을 쓰지
 * 않는다. 테스트마다 새 사용자·클라이언트를 만들고 끝에 직접 지운다(사용자 삭제가 멤버십·연결·code·토큰을 CASCADE 로 함께 지운다). 토큰은 실제 승인 API(웹
 * 세션 ALLOW) → 토큰 엔드포인트(폼 본문)로 받는다 — {@code OAuthTokenEndpointTest} 와 같은 흐름.
 */
class OAuthConnectionApiTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;
  private static final String CALLBACK = OAuthTestSupport.CALLBACK;
  private static final String CIMD_CALLBACK = "http://localhost:33418/callback";
  private static final String BASE = "/api/v1/users/me/oauth-connections";

  /** 서비스의 404 문구 — 경로가 없어서 난 404 와 구별한다. */
  private static final String NOT_FOUND_MESSAGE = "앱 연결을 찾을 수 없습니다";

  /** 비밀번호 변경 테스트 사용자의 비밀번호. */
  private static final String PASSWORD = "Password123";

  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired OAuthClientRepository clients;
  @Autowired OAuthConnectionRepository connections;
  @LocalServerPort int port;

  @Autowired UserService userService;
  @Autowired PasswordEncoder passwordEncoder;

  private OAuthTestSupport oauth;

  private long userId;
  private long otherUserId;
  private long dcrPk;
  private String dcrClientId;

  /** 비밀번호 변경 테스트가 만든 로그인 가능한 사용자(정리용, 없으면 null). */
  private Long loginableUserId;

  private final List<Long> clientPks = new ArrayList<>();

  /** 정리 전에 비동기 풀(승인 커밋 뒤 「새 앱 연결」 알림 등, WP-1686)이 비기를 기다리려고 쓴다. */
  @Autowired ApplicationContext asyncPoolContext;

  @BeforeEach
  void seed() {
    oauth = new OAuthTestSupport(mvc, objectMapper, port);
    userId = seedHuman();
    otherUserId = seedHuman();
    dcrClientId = CapabilityTokens.generate("swc_");
    dcrPk = clients.insertDcr(dcrClientId, "Claude", List.of(CALLBACK)).id();
    clientPks.add(dcrPk);
  }

  @AfterEach
  void cleanup() {
    List<Long> users = new ArrayList<>(List.of(userId, otherUserId));
    if (loginableUserId != null) users.add(loginableUserId);
    // 승인이 새 연결을 만들면 커밋 뒤 알림(WP-1686)이 승인한 기본 테넌트에 비동기로 들어온다 — 사용자 삭제 전에 지운다.
    OAuthTestSupport.deleteAppConnectedNotices(
        asyncPoolContext, dsl, this::cleanupInTenant, TENANT_ID, users);
    dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    // membership·oauth_connection·code·token 은 user 삭제 CASCADE.
    dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    dsl.deleteFrom(OAUTH_CLIENT).where(OAUTH_CLIENT.ID.in(clientPks)).execute();
  }

  // ---- 목록 ----

  @Test
  void list_returnsMyActiveConnectionsAcrossTenants() throws Exception {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    TestFixtures.ensureActiveMember(dsl, userId, tenant2);
    String cimdUrl = "https://app.example/oauth/client-" + CapabilityTokens.generate("x") + ".json";
    long cimdPk =
        clients
            .upsertCimd(
                cimdUrl, "Native App", List.of(CIMD_CALLBACK), null, null, OffsetDateTime.now())
            .id();
    clientPks.add(cimdPk);

    long mine1 = connections.findOrCreateActive(userId, TENANT_ID, dcrPk).row().id();
    long mine2 = connections.findOrCreateActive(userId, tenant2, cimdPk).row().id();
    // 끊긴 연결은 목록에 없다.
    long revoked = connections.findOrCreateActive(userId, tenant2, dcrPk).row().id();
    connections.revoke(revoked, userId);
    // 다른 사용자의 연결도 없다.
    connections.findOrCreateActive(otherUserId, TENANT_ID, dcrPk);

    String body =
        mvc.perform(get(BASE).with(authentication(WebSessionAuth.of(userId, List.of()))))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();

    JsonNode list = objectMapper.readTree(body);
    assertThat(list.size()).isEqualTo(2);
    // 최근 생성 순.
    JsonNode first = list.get(0);
    assertThat(first.get("id").asLong()).isEqualTo(mine2);
    assertThat(first.get("clientName").asString()).isEqualTo("Native App");
    assertThat(first.get("unverified").asBoolean()).isFalse();
    assertThat(first.get("redirectHost").asString()).isEqualTo("localhost");
    assertThat(first.get("tenantId").asLong()).isEqualTo(tenant2);
    assertThat(first.get("tenantName").asString()).isEqualTo("fixture-tenant");
    assertThat(first.get("createdAt").isNull()).isFalse();
    assertThat(first.get("lastUsedAt").isNull()).isTrue();

    JsonNode second = list.get(1);
    assertThat(second.get("id").asLong()).isEqualTo(mine1);
    assertThat(second.get("clientName").asString()).isEqualTo("Claude");
    assertThat(second.get("unverified").asBoolean()).isTrue();
    assertThat(second.get("redirectHost").asString()).isEqualTo("claude.ai");
    assertThat(second.get("tenantId").asLong()).isEqualTo(TENANT_ID);
    assertThat(second.get("tenantName").asString()).isEqualTo(tenantName(TENANT_ID));
  }

  // ---- 끊기 ----

  @Test
  void delete_revokesAndSwoIs401() throws Exception {
    String access = field(token(codeForm(obtainCode())), "access_token");
    assertThat(getWithBearer("/api/v1/auth/me", access).getStatusCode()).isEqualTo(HttpStatus.OK);
    long connectionId = activeConnectionId();

    // 웹 세션이 아닌 인증(AuthDetails 없음 — PAT 와 같은 모양)으로도 끊을 수 있다.
    mvc.perform(delete(BASE + "/" + connectionId).with(authentication(nonSession(userId))))
        .andExpect(status().isNoContent());

    // 완료 기준 10 — 끊은 연결의 swo_ 는 바로 401.
    assertThat(getWithBearer("/api/v1/auth/me", access).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(revokedAuditCount(connectionId)).isEqualTo(1);
    // 목록에서도 빠지고, 다시 끊으면 404(이미 끊긴 것).
    mvc.perform(get(BASE).with(authentication(WebSessionAuth.of(userId, List.of()))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(0));
    mvc.perform(delete(BASE + "/" + connectionId).with(authentication(nonSession(userId))))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(NOT_FOUND_MESSAGE));
    assertThat(revokedAuditCount(connectionId)).isEqualTo(1);
  }

  @Test
  void delete_othersConnection_404() throws Exception {
    long others = connections.findOrCreateActive(otherUserId, TENANT_ID, dcrPk).row().id();

    mvc.perform(delete(BASE + "/" + others).with(authentication(nonSession(userId))))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(NOT_FOUND_MESSAGE));
    // 없는 id 도 같은 404.
    mvc.perform(delete(BASE + "/" + Long.MAX_VALUE).with(authentication(nonSession(userId))))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(NOT_FOUND_MESSAGE));

    // 남의 연결은 그대로 살아 있고 감사도 없다.
    assertThat(isActiveConnection(others)).isTrue();
    assertThat(revokedAuditCount(others)).isZero();
  }

  @Test
  void revokedConnection_codeAndRefreshRejected() throws Exception {
    String refresh = field(token(codeForm(obtainCode())), "refresh_token");
    // 아직 교환하지 않은 code 하나를 더 받아 둔다(같은 연결을 다시 쓴다).
    String pendingCode = obtainCode();
    long connectionId = activeConnectionId();

    mvc.perform(delete(BASE + "/" + connectionId).with(authentication(nonSession(userId))))
        .andExpect(status().isNoContent());

    // Review Focus 4 — 끊은 뒤 남은 code·refresh 로 새 토큰을 받을 수 없다.
    assertInvalidGrant(token(codeForm(pendingCode)));
    assertInvalidGrant(token(refreshForm(refresh)));
    // 끊긴 연결 거절은 재사용 탐지가 아니다 — 재사용 감사가 남지 않는다.
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .USER_ID
                    .eq(userId)
                    .and(AUDIT_LOG.ACTION_TYPE.eq("OAUTH_REFRESH_REUSE_DETECTED"))))
        .isZero();
  }

  /**
   * 리뷰 D6.3 — 지금 요청의 워크스페이스(기본 테넌트의 swo_)와 다른 워크스페이스(tenant2)의 연결을 끊으면 감사는 그 연결의 워크스페이스(tenant2)에
   * 남는다.
   */
  @Test
  void delete_connectionInOtherTenant_auditsInConnectionTenant() throws Exception {
    String access = field(token(codeForm(obtainCode())), "access_token");
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    TestFixtures.ensureActiveMember(dsl, userId, tenant2);
    long other = connections.findOrCreateActive(userId, tenant2, dcrPk).row().id();

    // 기본 테넌트(1)로 인증된 실제 요청으로 tenant2 의 연결을 끊는다.
    assertThat(oauth.deleteWithBearer(BASE + "/" + other, access).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    // audit_log 는 RLS 표 — tenant2 의 행은 tenant2 GUC 로 읽고, 테스트 뒤 같은 GUC 로 지운다.
    assertThat(callInTenant(tenant2, () -> revokedAuditCount(other, tenant2))).isEqualTo(1);
    assertThat(revokedAuditCount(other, TENANT_ID)).isZero();
    assertThat(isActiveConnection(other)).isFalse();
    cleanupInTenant(
        tenant2, () -> dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(userId)).execute());
  }

  /**
   * 리뷰 F5 — 비밀번호를 바꾸면 OAuth 앱 연결도 끊긴다(30일씩 굴러가는 세션이라). 받아 둔 swo_ 는 401, swr_ 는 invalid_grant, 연결마다
   * 그 워크스페이스에 끊기 감사(reason=password_change)가 남는다.
   */
  @Test
  void passwordChange_revokesOAuthConnections() throws Exception {
    TestFixtures.LoginableHuman human =
        TestFixtures.createLoginableHuman(dsl, passwordEncoder.encode(PASSWORD));
    loginableUserId = human.id();
    TestFixtures.grantRole(dsl, human.id(), "USER");
    TestFixtures.ensureActiveMember(dsl, human.id(), TENANT_ID);
    ResponseEntity<String> issued =
        token(codeForm(oauth.obtainCode(human.id(), dcrClientId, TENANT_ID)));
    String access = field(issued, "access_token");
    String refresh = field(issued, "refresh_token");
    assertThat(getWithBearer("/api/v1/auth/me", access).getStatusCode()).isEqualTo(HttpStatus.OK);
    long connectionId = connections.findOrCreateActive(human.id(), TENANT_ID, dcrPk).row().id();

    TenantContext.set(TENANT_ID);
    try {
      userService.changePassword(human.id(), PASSWORD, "Password456", AuthDetails.PASSWORD);
    } finally {
      TenantContext.clear();
    }

    assertThat(getWithBearer("/api/v1/auth/me", access).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertInvalidGrant(token(refreshForm(refresh)));
    String metadata =
        dsl.select(AUDIT_LOG.METADATA)
            .from(AUDIT_LOG)
            .where(AUDIT_LOG.ACTION_TYPE.eq("OAUTH_CONNECTION_REVOKED"))
            .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(connectionId)))
            .and(AUDIT_LOG.TENANT_ID.eq(TENANT_ID))
            .fetchOne(r -> r.value1().data());
    assertThat(objectMapper.readTree(metadata).get("reason").asString())
        .isEqualTo("password_change");
  }

  // ---- 도우미 ----

  /** 기본 테넌트의 USER 역할 + ACTIVE 멤버십을 가진 사람 사용자. */
  private long seedHuman() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, id, "USER");
    TestFixtures.ensureActiveMember(dsl, id, TENANT_ID);
    return id;
  }

  /** 웹 세션이 아닌 인증 — AuthDetails 가 없어 PAT·swo_ 요청처럼 보인다. */
  private static UsernamePasswordAuthenticationToken nonSession(long principal) {
    return new UsernamePasswordAuthenticationToken(principal, null, List.of());
  }

  /** 이 사용자의 (기본 테넌트, DCR 클라이언트) 살아 있는 연결 id. */
  private long activeConnectionId() {
    return connections.findOrCreateActive(userId, TENANT_ID, dcrPk).row().id();
  }

  private String tenantName(long tenantId) {
    return dsl.select(TENANT.NAME).from(TENANT).where(TENANT.ID.eq(tenantId)).fetchOne(TENANT.NAME);
  }

  private int revokedAuditCount(long connectionId) {
    return revokedAuditCount(connectionId, TENANT_ID);
  }

  /** 그 연결의 끊기 감사 행 수 — tenantId 워크스페이스에 남은 것만. */
  private int revokedAuditCount(long connectionId, long tenantId) {
    return dsl.fetchCount(
        AUDIT_LOG,
        AUDIT_LOG
            .ACTION_TYPE
            .eq("OAUTH_CONNECTION_REVOKED")
            .and(AUDIT_LOG.RESOURCE.eq("oauth_connection"))
            .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(connectionId)))
            .and(AUDIT_LOG.TENANT_ID.eq(tenantId)));
  }

  /** 실제 승인 API(웹 세션 ALLOW)로 이 사용자·DCR 클라이언트·기본 테넌트의 code 를 받는다. */
  private String obtainCode() throws Exception {
    return oauth.obtainCode(userId, dcrClientId, TENANT_ID);
  }

  private MultiValueMap<String, String> codeForm(String code) {
    return oauth.codeForm(code, dcrClientId);
  }

  private MultiValueMap<String, String> refreshForm(String refreshToken) {
    return oauth.refreshForm(refreshToken, dcrClientId);
  }

  private ResponseEntity<String> token(MultiValueMap<String, String> form) {
    return oauth.token(form);
  }

  private ResponseEntity<String> getWithBearer(String path, String bearer) {
    return oauth.getWithBearer(path, bearer);
  }

  private String field(ResponseEntity<String> res, String name) {
    return oauth.field(res, name);
  }

  private void assertInvalidGrant(ResponseEntity<String> res) {
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(field(res, "error")).isEqualTo("invalid_grant");
  }

  /** 연결이 살아 있는지(폐기되지 않은 행이 있는지) — DSLContext 로 직접 본다. */
  private boolean isActiveConnection(long id) {
    return dsl.fetchExists(
        OAUTH_CONNECTION, OAUTH_CONNECTION.ID.eq(id).and(OAUTH_CONNECTION.REVOKED_AT.isNull()));
  }
}

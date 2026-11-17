package com.workplace.auth.oauth;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static com.workplace.jooq.Tables.OAUTH_TOKEN;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.repository.OAuthCodeRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1685 — 토큰 엔드포인트({@code POST /api/v1/oauth/token}) 통합 테스트. RANDOM_PORT 에 실제 HTTP(폼 본문)로 부른다.
 *
 * <p>재사용 탐지의 폐기·감사가 오류 응답과 별도로 커밋되는지, 동시 refresh 중 하나만 성공하는지를 봐야 하므로 클래스 단위 {@code @Transactional}
 * 을 쓰지 않는다. 테스트마다 새 사용자·DCR 클라이언트를 만들고 끝에 직접 지운다(사용자 삭제가 멤버십·연결·code·토큰을 CASCADE 로 함께 지운다). code 는
 * 실제 승인 API(Task 4, 웹 세션)로 받고, 만료 code 만 저장소로 직접 넣는다.
 */
class OAuthTokenEndpointTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;
  private static final String CALLBACK = OAuthTestSupport.CALLBACK;
  private static final String RESOURCE = OAuthTestSupport.RESOURCE;
  private static final String CHALLENGE = OAuthTestSupport.CHALLENGE;

  private static final String REUSE_ACTION = "OAUTH_REFRESH_REUSE_DETECTED";

  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired OAuthClientRepository clients;
  @Autowired OAuthConnectionRepository connections;
  @Autowired OAuthCodeRepository codes;
  @LocalServerPort int port;

  private OAuthTestSupport oauth;

  private long userId;
  private long clientPk;
  private String clientId;
  private final List<Long> clientPks = new ArrayList<>();

  @BeforeEach
  void seed() {
    oauth = new OAuthTestSupport(mvc, objectMapper, port);
    userId = TestFixtures.createHuman(dsl);
    // OAuthAccessTokenAuthenticationFilterTest 와 같은 시드 — 기본 테넌트의 USER 역할 + ACTIVE 멤버십.
    TestFixtures.grantRole(dsl, userId, "USER");
    TestFixtures.ensureActiveMember(dsl, userId, TENANT_ID);
    clientId = CapabilityTokens.generate("swc_");
    clientPk = clients.insertDcr(clientId, "Claude", List.of(CALLBACK)).id();
    clientPks.add(clientPk);
  }

  @AfterEach
  void cleanup() {
    // 이슈 목록 확인이 기본 개인 프로젝트를 지연 프로비저닝한다 — user 삭제 전에 지워야 FK 위반이 없다.
    dsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.eq(userId)).execute();
    dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(userId)).execute();
    // membership·oauth_connection·code·token 은 user 삭제 CASCADE.
    dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
    dsl.deleteFrom(OAUTH_CLIENT).where(OAUTH_CLIENT.ID.in(clientPks)).execute();
  }

  // ---- code 교환 ----

  @Test
  void codeExchange_returnsSwoAndSwr_andSwoWorks() throws Exception {
    ResponseEntity<String> res = token(codeForm(obtainCode()));

    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(res.getHeaders().getCacheControl()).contains("no-store");
    assertThat(res.getHeaders().getPragma()).isEqualTo("no-cache");
    JsonNode body = objectMapper.readTree(res.getBody());
    assertThat(body.get("token_type").asString()).isEqualTo("Bearer");
    assertThat(body.get("expires_in").asLong()).isEqualTo(3600L);
    String access = body.get("access_token").asString();
    assertThat(access).startsWith("swo_");
    assertThat(body.get("refresh_token").asString()).startsWith("swr_");

    // 받은 swo_ 로 그 사용자·그 워크스페이스로 API 가 동작한다(완료 기준 3).
    ResponseEntity<String> me = get("/api/v1/auth/me", access);
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(me.getBody()).contains("\"id\":" + userId + ",");
    ResponseEntity<String> projects = get("/api/v1/projects", access);
    assertThat(projects.getStatusCode()).isEqualTo(HttpStatus.OK);
    // 목록 조회가 이 사용자의 개인 프로젝트를 지연 프로비저닝한다 — 그 프로젝트의 이슈 목록이 이 토큰으로 열린다.
    String key = null;
    for (JsonNode p : objectMapper.readTree(projects.getBody()).get("content")) {
      if (p.get("ownerId").asLong() == userId) key = p.get("key").asString();
    }
    assertThat(key).as("이 사용자의 개인 프로젝트").isNotNull();
    assertThat(get("/api/v1/projects/" + key + "/issues", access).getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  void codeReuse_isInvalidGrant_andRevokesTokens() throws Exception {
    MultiValueMap<String, String> form = codeForm(obtainCode());
    ResponseEntity<String> first = token(form);
    assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
    String access = field(first, "access_token");
    String refresh = field(first, "refresh_token");
    assertThat(get("/api/v1/auth/me", access).getStatusCode()).isEqualTo(HttpStatus.OK);

    ResponseEntity<String> second = token(form);

    assertError(second, "invalid_grant");
    // 재사용이면 첫 교환으로 나간 토큰도 무효(완료 기준 7) — 폐기가 오류 응답과 따로 커밋됐다.
    assertThat(get("/api/v1/auth/me", access).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertError(token(refreshForm(refresh)), "invalid_grant");
    assertThat(reuseAuditCount()).isEqualTo(1);
    assertThat(reuseAuditGrant()).isEqualTo("authorization_code");
  }

  @Test
  void codeExpired_isInvalidGrant() {
    long connectionId = connections.findOrCreateActive(userId, TENANT_ID, clientPk).row().id();
    String code = CapabilityTokens.generateUrlSafe(32);
    codes.insert(
        CapabilityTokens.sha256Hex(code),
        connectionId,
        CALLBACK,
        CHALLENGE,
        RESOURCE,
        OffsetDateTime.now().minusSeconds(1));

    assertError(token(codeForm(code)), "invalid_grant");
  }

  @Test
  void codeUnknown_isInvalidGrant() {
    assertError(token(codeForm(CapabilityTokens.generateUrlSafe(32))), "invalid_grant");
  }

  @Test
  void codeWrongVerifier_isInvalidGrant() throws Exception {
    String code = obtainCode();
    MultiValueMap<String, String> form = codeForm(code);
    form.set("code_verifier", "x".repeat(43));
    assertError(token(form), "invalid_grant");
    // 검증 실패는 code 를 태우지 않는다 — 올바른 verifier 로는 여전히 교환된다.
    assertThat(token(codeForm(code)).getStatusCode()).isEqualTo(HttpStatus.OK);
  }

  @Test
  void codeWrongRedirectUri_isInvalidGrant() throws Exception {
    MultiValueMap<String, String> form = codeForm(obtainCode());
    form.set("redirect_uri", CALLBACK + "/other");
    assertError(token(form), "invalid_grant");
  }

  @Test
  void codeWrongClientId_isInvalidGrant() throws Exception {
    String otherClientId = CapabilityTokens.generate("swc_");
    clientPks.add(clients.insertDcr(otherClientId, "Other", List.of(CALLBACK)).id());
    MultiValueMap<String, String> form = codeForm(obtainCode());
    form.set("client_id", otherClientId);
    assertError(token(form), "invalid_grant");
  }

  @Test
  void codeMissingVerifier_isInvalidRequest() throws Exception {
    MultiValueMap<String, String> form = codeForm(obtainCode());
    form.remove("code_verifier");
    assertError(token(form), "invalid_request");
  }

  /** 리뷰 D5.4 — 발급한 토큰의 resource 는 code 에 저장된 값(인가 요청 때 받은 것)이고, 폼의 resource 가 달라도 바뀌지 않는다. */
  @Test
  void codeExchange_tokensCarryCodeResource_andRefreshKeepsIt() throws Exception {
    MultiValueMap<String, String> form = codeForm(obtainCode());
    form.set("resource", "https://other.example/mcp");
    ResponseEntity<String> first = token(form);
    assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(tokenResource(field(first, "access_token"))).isEqualTo(RESOURCE);
    assertThat(tokenResource(field(first, "refresh_token"))).isEqualTo(RESOURCE);

    ResponseEntity<String> rotated = token(refreshForm(field(first, "refresh_token")));
    assertThat(rotated.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(tokenResource(field(rotated, "access_token"))).isEqualTo(RESOURCE);
    assertThat(tokenResource(field(rotated, "refresh_token"))).isEqualTo(RESOURCE);
  }

  /** 리뷰 D5.4 — code 를 받은 뒤 멤버십이 정지되면 교환도 invalid_grant(재사용 처리가 아니다). */
  @Test
  void codeExchange_afterMembershipSuspended_isInvalidGrant() throws Exception {
    String code = obtainCode();
    TestFixtures.suspendMember(dsl, userId, TENANT_ID);

    assertError(token(codeForm(code)), "invalid_grant");
    assertThat(reuseAuditCount()).isZero();
  }

  // ---- refresh ----

  @Test
  void refresh_rotates() throws Exception {
    ResponseEntity<String> first = token(codeForm(obtainCode()));
    String access1 = field(first, "access_token");
    String refresh1 = field(first, "refresh_token");

    ResponseEntity<String> rotated = token(refreshForm(refresh1));

    assertThat(rotated.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(rotated.getHeaders().getCacheControl()).contains("no-store");
    String access2 = field(rotated, "access_token");
    String refresh2 = field(rotated, "refresh_token");
    assertThat(access2).startsWith("swo_").isNotEqualTo(access1);
    assertThat(refresh2).startsWith("swr_").isNotEqualTo(refresh1);
    assertThat(field(rotated, "token_type")).isEqualTo("Bearer");
    // 옛 access 는 만료까지 그대로, 새 access 도 통한다.
    assertThat(get("/api/v1/auth/me", access1).getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(get("/api/v1/auth/me", access2).getStatusCode()).isEqualTo(HttpStatus.OK);
    // 새 refresh 로 한 번 더 회전된다.
    assertThat(token(refreshForm(refresh2)).getStatusCode()).isEqualTo(HttpStatus.OK);
  }

  @Test
  void refreshReuse_isInvalidGrant_andRevokesAll() throws Exception {
    String refresh1 = field(token(codeForm(obtainCode())), "refresh_token");
    ResponseEntity<String> rotated = token(refreshForm(refresh1));
    String access2 = field(rotated, "access_token");
    String refresh2 = field(rotated, "refresh_token");

    assertError(token(refreshForm(refresh1)), "invalid_grant");

    // 연결의 토큰이 모두 무효(완료 기준 5) — 오류 응답과 따로 커밋됐다.
    assertThat(get("/api/v1/auth/me", access2).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertError(token(refreshForm(refresh2)), "invalid_grant");
    assertThat(reuseAuditCount()).isEqualTo(1);
    assertThat(reuseAuditGrant()).isEqualTo("refresh_token");
  }

  @Test
  void refreshConcurrentUse_onlyOneSucceeds() throws Exception {
    String refresh = field(token(codeForm(obtainCode())), "refresh_token");
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch go = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Future<ResponseEntity<String>>> futures = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        futures.add(
            pool.submit(
                () -> {
                  ready.countDown();
                  go.await();
                  return token(refreshForm(refresh));
                }));
      }
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      go.countDown();
      int ok = 0;
      int invalidGrant = 0;
      for (Future<ResponseEntity<String>> f : futures) {
        ResponseEntity<String> r = f.get(30, TimeUnit.SECONDS);
        if (r.getStatusCode() == HttpStatus.OK) {
          ok++;
        } else if (r.getStatusCode() == HttpStatus.BAD_REQUEST
            && "invalid_grant".equals(field(r, "error"))) {
          invalidGrant++;
        }
      }
      assertThat(ok).as("동시에 같은 refresh — 성공은 정확히 하나").isEqualTo(1);
      assertThat(invalidGrant).isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
  }

  /**
   * 리뷰 D5.2 — 쓰지 않았는데 폐기된 refresh(예: 다른 요청의 재사용 처리가 폐기)는 평범한 invalid_grant 다. 재사용 처리(연결 토큰 모두
   * 폐기·감사)를 다시 일으키지 않는다 — 함께 받은 access 는 그대로 통한다.
   */
  @Test
  void refreshRevokedButUnused_isPlainInvalidGrant_noReuseHandling() throws Exception {
    ResponseEntity<String> first = token(codeForm(obtainCode()));
    String access = field(first, "access_token");
    String refresh = field(first, "refresh_token");
    dsl.update(OAUTH_TOKEN)
        .set(OAUTH_TOKEN.REVOKED_AT, OffsetDateTime.now())
        .where(OAUTH_TOKEN.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(refresh)))
        .execute();

    assertError(token(refreshForm(refresh)), "invalid_grant");
    assertThat(reuseAuditCount()).isZero();
    assertThat(get("/api/v1/auth/me", access).getStatusCode()).isEqualTo(HttpStatus.OK);
  }

  @Test
  void refreshWrongClientId_isInvalidGrant() throws Exception {
    String refresh = field(token(codeForm(obtainCode())), "refresh_token");
    MultiValueMap<String, String> form = refreshForm(refresh);
    form.set("client_id", CapabilityTokens.generate("swc_"));
    assertError(token(form), "invalid_grant");
    // 다른 클라이언트의 시도는 회전·폐기를 일으키지 않는다 — 원래 클라이언트는 그대로 갱신한다.
    assertThat(token(refreshForm(refresh)).getStatusCode()).isEqualTo(HttpStatus.OK);
  }

  @Test
  void refreshUnknown_isInvalidGrant() {
    assertError(token(refreshForm(CapabilityTokens.generate("swr_"))), "invalid_grant");
  }

  @Test
  void accessTokenAsRefresh_isInvalidGrant() throws Exception {
    String access = field(token(codeForm(obtainCode())), "access_token");
    assertError(token(refreshForm(access)), "invalid_grant");
  }

  @Test
  void token_afterMembershipSuspended_isInvalidGrant() throws Exception {
    String refresh = field(token(codeForm(obtainCode())), "refresh_token");
    TestFixtures.suspendMember(dsl, userId, TENANT_ID);

    assertError(token(refreshForm(refresh)), "invalid_grant");
  }

  @Test
  void token_afterConnectionRevoked_isInvalidGrant() throws Exception {
    String refresh = field(token(codeForm(obtainCode())), "refresh_token");
    long connectionId = connections.findOrCreateActive(userId, TENANT_ID, clientPk).row().id();
    assertThat(connections.revoke(connectionId, userId)).isTrue();

    assertError(token(refreshForm(refresh)), "invalid_grant");
  }

  // ---- 요청 형식 ----

  @Test
  void token_jsonBody_isInvalidRequest() {
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    ResponseEntity<String> res =
        send(
            new HttpEntity<>(
                "{\"grant_type\":\"refresh_token\",\"refresh_token\":\"swr_x\",\"client_id\":\"c\"}",
                headers));
    assertError(res, "invalid_request");
  }

  @Test
  void token_missingGrantType_isInvalidRequest() {
    MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
    form.add("client_id", clientId);
    assertError(token(form), "invalid_request");
  }

  @Test
  void token_passwordGrant_isUnsupportedGrantType() {
    MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
    form.add("grant_type", "password");
    form.add("username", "a");
    form.add("password", "b");
    assertError(token(form), "unsupported_grant_type");
  }

  @Test
  void token_duplicateParameter_isInvalidRequest() {
    MultiValueMap<String, String> form = refreshForm(CapabilityTokens.generate("swr_"));
    form.add("client_id", "another");
    assertError(token(form), "invalid_request");
  }

  /** 리뷰 D5.3 — grant 파라미터를 쿼리 문자열로 보내면(폼 본문이 맞아도) invalid_request. 자격이 주소에 실려 오는 요청을 받지 않는다. */
  @Test
  void token_grantParamsInQueryString_isInvalidRequest() throws Exception {
    String code = obtainCode();
    for (String name :
        List.of(
            "grant_type", "code", "code_verifier", "redirect_uri", "client_id", "refresh_token")) {
      MultiValueMap<String, String> form = codeForm(code);
      String value = form.containsKey(name) ? form.getFirst(name) : "x";
      form.remove(name);
      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
      String path =
          UriComponentsBuilder.fromPath(OAuthTestSupport.TOKEN_PATH)
              .queryParam(name, value)
              .encode()
              .build()
              .toUriString();
      ResponseEntity<String> res =
          oauth.exchange(path, HttpMethod.POST, new HttpEntity<>(form, headers));
      assertError(res, "invalid_request");
    }
    // 쿼리에 실려 온 시도가 code 를 태우지 않았다 — 폼 본문으로는 여전히 교환된다.
    assertThat(token(codeForm(code)).getStatusCode()).isEqualTo(HttpStatus.OK);
  }

  // ---- 도우미 ----

  /** 실제 승인 API(웹 세션 ALLOW)로 이 사용자·클라이언트·기본 테넌트의 code 를 받는다. */
  private String obtainCode() throws Exception {
    return oauth.obtainCode(userId, clientId, TENANT_ID);
  }

  private MultiValueMap<String, String> codeForm(String code) {
    return oauth.codeForm(code, clientId);
  }

  private MultiValueMap<String, String> refreshForm(String refreshToken) {
    return oauth.refreshForm(refreshToken, clientId);
  }

  private ResponseEntity<String> token(MultiValueMap<String, String> form) {
    return oauth.token(form);
  }

  private ResponseEntity<String> send(HttpEntity<?> entity) {
    return oauth.exchange(OAuthTestSupport.TOKEN_PATH, HttpMethod.POST, entity);
  }

  private ResponseEntity<String> get(String path, String bearer) {
    return oauth.getWithBearer(path, bearer);
  }

  private String field(ResponseEntity<String> res, String name) {
    return oauth.field(res, name);
  }

  /** RFC 6749 §5.2 오류 — 400, snake_case 본문, 캐시 금지 헤더. */
  private void assertError(ResponseEntity<String> res, String error) {
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(field(res, "error")).isEqualTo(error);
    assertThat(field(res, "error_description")).isNotBlank();
    assertThat(res.getHeaders().getCacheControl()).contains("no-store");
    assertThat(res.getHeaders().getPragma()).isEqualTo("no-cache");
  }

  /** 평문 토큰으로 저장된 행의 resource. */
  private String tokenResource(String plaintext) {
    return dsl.select(OAUTH_TOKEN.RESOURCE)
        .from(OAUTH_TOKEN)
        .where(OAUTH_TOKEN.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(plaintext)))
        .fetchOne(OAUTH_TOKEN.RESOURCE);
  }

  private int reuseAuditCount() {
    return dsl.fetchCount(
        AUDIT_LOG,
        AUDIT_LOG
            .USER_ID
            .eq(userId)
            .and(AUDIT_LOG.ACTION_TYPE.eq(REUSE_ACTION))
            .and(AUDIT_LOG.RESOURCE.eq("oauth_connection"))
            .and(AUDIT_LOG.TENANT_ID.eq(TENANT_ID)));
  }

  /** 재사용 감사 행의 metadata.grant. */
  private String reuseAuditGrant() {
    return dsl.select(AUDIT_LOG.METADATA)
        .from(AUDIT_LOG)
        .where(AUDIT_LOG.USER_ID.eq(userId))
        .and(AUDIT_LOG.ACTION_TYPE.eq(REUSE_ACTION))
        .fetchOne(r -> objectMapper.readTree(r.value1().data()).get("grant").asString());
  }
}

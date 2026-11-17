package com.workplace.auth.oauth;

import static com.workplace.jooq.Tables.OAUTH_AUTHORIZATION_CODE;
import static com.workplace.jooq.Tables.OAUTH_CONNECTION;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.repository.OAuthCodeRepository;
import com.workplace.auth.oauth.repository.OAuthCodeRepository.CodeRow;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.auth.oauth.repository.OAuthTokenRepository;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1685 — 인가 요청 검증({@code GET /api/v1/oauth/authorize/validate})·승인({@code POST
 * /api/v1/oauth/authorize}) 통합 테스트. 동의 화면(웹)이 브라우저 JWT 로 부르는 두 엔드포인트라 {@link WebSessionAuth} 로 웹 세션
 * 인증을 싣는다. DCR 클라이언트는 저장소로 직접 넣고, 클래스 단위 {@code @Transactional} 로 연결·code·감사 행이 롤백된다.
 */
@Transactional
class OAuthAuthorizeTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;
  private static final String CALLBACK = "https://claude.ai/api/mcp/auth_callback";

  /** 기존 쿼리가 있는 루프백 redirect — 포트는 등록과 달라도 맞는다(RFC 8252 §7.3). */
  private static final String LOOPBACK_REGISTERED = "http://127.0.0.1/callback?src=cli";

  private static final String LOOPBACK_REQUESTED = "http://127.0.0.1:41234/callback?src=cli";

  /** S256 code_challenge 모양(base64url 43자). */
  private static final String CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired OAuthClientRepository clients;
  @Autowired OAuthCodeRepository codes;
  @Autowired OAuthConnectionRepository connections;
  @Autowired OAuthTokenRepository tokens;

  @Value("${workplace.public-base-url}")
  String publicBaseUrl;

  private long userId;
  private long clientPk;
  private String clientId;

  @BeforeEach
  void seed() {
    userId = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, userId, TENANT_ID);
    clientId = CapabilityTokens.generate("swc_");
    clientPk = clients.insertDcr(clientId, "Claude", List.of(CALLBACK, LOOPBACK_REGISTERED)).id();
  }

  // ---- validate ----

  @Test
  void validate_ok_returnsClientAndWorkspaces() throws Exception {
    mvc.perform(validate(params()).with(web(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.clientName").value("Claude"))
        .andExpect(jsonPath("$.unverified").value(true))
        .andExpect(jsonPath("$.redirectHost").value("claude.ai"))
        .andExpect(jsonPath("$.workspaces[?(@.tenantId == 1)]").exists())
        .andExpect(jsonPath("$.workspaces[0].name").exists())
        .andExpect(jsonPath("$.workspaces[0].slug").exists())
        .andExpect(jsonPath("$.currentTenantId").value(1));
  }

  @Test
  void validate_loopbackOtherPortWithQuery_ok() throws Exception {
    Map<String, String> p = params();
    p.put("redirect_uri", LOOPBACK_REQUESTED);
    mvc.perform(validate(p).with(web(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.redirectHost").value("127.0.0.1"));
  }

  @Test
  void validate_unknownClient_noRedirect() throws Exception {
    Map<String, String> p = params();
    p.put("client_id", "swc_unknown");
    mvc.perform(validate(p).with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_client"))
        .andExpect(jsonPath("$.errorDescription").isNotEmpty())
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
  }

  @Test
  void validate_unregisteredRedirect_noRedirect() throws Exception {
    Map<String, String> p = params();
    p.put("redirect_uri", "https://evil.example/callback");
    mvc.perform(validate(p).with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_redirect_uri"))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
  }

  @Test
  void validate_missingRedirect_noRedirect() throws Exception {
    Map<String, String> p = params();
    p.remove("redirect_uri");
    mvc.perform(validate(p).with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_redirect_uri"))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
  }

  @Test
  void validate_missingPkce_hasErrorRedirect() throws Exception {
    Map<String, String> p = params();
    p.remove("code_challenge");
    p.remove("code_challenge_method");
    String body =
        mvc.perform(validate(p).with(web(userId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_request"))
            .andExpect(jsonPath("$.errorRedirectUrl").value(startsWith(CALLBACK + "?")))
            .andReturn()
            .getResponse()
            .getContentAsString();
    Map<String, String> q = query(objectMapper.readTree(body).get("errorRedirectUrl").asString());
    assertThat(q).containsEntry("error", "invalid_request").containsEntry("state", "st-1");
    assertThat(q).containsEntry("iss", issuer());
  }

  @Test
  void validate_plainChallengeMethod_rejected() throws Exception {
    Map<String, String> p = params();
    p.put("code_challenge_method", "plain");
    mvc.perform(validate(p).with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorRedirectUrl").value(containsString("error=invalid_request")));
  }

  @Test
  void validate_responseTypeToken_unsupported() throws Exception {
    Map<String, String> p = params();
    p.put("response_type", "token");
    mvc.perform(validate(p).with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("unsupported_response_type"))
        .andExpect(
            jsonPath("$.errorRedirectUrl")
                .value(containsString("error=unsupported_response_type")));
  }

  @Test
  void validate_badResource_invalidRequestWithRedirect() throws Exception {
    for (String bad :
        List.of("http://mcp.example/mcp", "https://mcp.example/mcp#frag", "/relative")) {
      Map<String, String> p = params();
      p.put("resource", bad);
      mvc.perform(validate(p).with(web(userId)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.error").value("invalid_request"))
          .andExpect(jsonPath("$.errorRedirectUrl").value(startsWith(CALLBACK + "?")));
    }
  }

  @Test
  void validate_withPatAuth_isForbidden() throws Exception {
    mvc.perform(validate(params()).with(authentication(nonWeb(userId))))
        .andExpect(status().isForbidden());
  }

  @Test
  void validate_agentUser_isForbidden() throws Exception {
    long agentId = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.ensureActiveMember(dsl, agentId, TENANT_ID);
    mvc.perform(validate(params()).with(web(agentId))).andExpect(status().isForbidden());
  }

  // ---- authorize ----

  @Test
  void authorize_allow_returnsCodeRedirectAndCreatesConnection() throws Exception {
    String redirectUrl = allow(params());
    assertThat(redirectUrl).startsWith(CALLBACK + "?");
    Map<String, String> q = query(redirectUrl);
    assertThat(q).containsKeys("code").containsEntry("state", "st-1");
    assertThat(q).containsEntry("iss", issuer());
    assertThat(connectionCount()).isEqualTo(1);
    assertThat(auditCount()).isEqualTo(1);

    // code 는 해시로만 저장되고 요청 값(redirect_uri·challenge·resource)과 10분 만료를 담는다
    CodeRow code = codes.findByHash(CapabilityTokens.sha256Hex(q.get("code"))).orElseThrow();
    assertThat(code.redirectUri()).isEqualTo(CALLBACK);
    assertThat(code.codeChallenge()).isEqualTo(CHALLENGE);
    assertThat(code.resource()).isEqualTo("https://mcp.example/mcp");
    assertThat(code.usedAt()).isNull();
    assertThat(Duration.between(OffsetDateTime.now(), code.expiresAt()))
        .isBetween(Duration.ofMinutes(9), Duration.ofMinutes(10).plusSeconds(5));
    assertThat(dsl.fetchCount(OAUTH_AUTHORIZATION_CODE, DSL.trueCondition())).isPositive();

    // 같은 요청 한 번 더 — 연결은 다시 쓰고 감사는 더 남기지 않는다(code 는 새로)
    String again = allow(params());
    assertThat(query(again).get("code")).isNotEqualTo(q.get("code"));
    assertThat(connectionCount()).isEqualTo(1);
    assertThat(auditCount()).isEqualTo(1);
  }

  @Test
  void authorize_allow_loopbackKeepsExistingQueryAndEncodesState() throws Exception {
    Map<String, String> p = params();
    p.put("redirect_uri", LOOPBACK_REQUESTED);
    p.put("state", "a b&c=d+e/é");
    p.remove("resource");
    String redirectUrl = allow(p);
    assertThat(redirectUrl).startsWith(LOOPBACK_REQUESTED + "&");
    Map<String, String> q = query(redirectUrl);
    assertThat(q).containsEntry("src", "cli").containsEntry("state", "a b&c=d+e/é");
    assertThat(q).containsKey("code");
    CodeRow code = codes.findByHash(CapabilityTokens.sha256Hex(q.get("code"))).orElseThrow();
    assertThat(code.redirectUri()).isEqualTo(LOOPBACK_REQUESTED);
    assertThat(code.resource()).isNull();
  }

  @Test
  void authorize_allow_withoutState_omitsState() throws Exception {
    Map<String, String> p = params();
    p.remove("state");
    Map<String, String> q = query(allow(p));
    assertThat(q).containsKey("code").doesNotContainKey("state");
  }

  @Test
  void authorize_deny_returnsAccessDenied() throws Exception {
    String body =
        mvc.perform(authorize(params(), TENANT_ID, "DENY").with(web(userId)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String redirectUrl = objectMapper.readTree(body).get("redirectUrl").asString();
    assertThat(redirectUrl).startsWith(CALLBACK + "?");
    Map<String, String> q = query(redirectUrl);
    assertThat(q).containsEntry("error", "access_denied").containsEntry("state", "st-1");
    assertThat(q).containsEntry("iss", issuer()).doesNotContainKey("code");
    assertThat(connectionCount()).isZero();
    assertThat(auditCount()).isZero();
  }

  @Test
  void authorize_deny_stillValidatesFirst() throws Exception {
    Map<String, String> p = params();
    p.put("redirect_uri", "https://evil.example/callback");
    mvc.perform(authorize(p, TENANT_ID, "DENY").with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_redirect_uri"))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
  }

  @Test
  void authorize_validationFailure_sameAsValidate() throws Exception {
    Map<String, String> p = params();
    p.put("code_challenge_method", "plain");
    mvc.perform(authorize(p, TENANT_ID, "ALLOW").with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorRedirectUrl").value(startsWith(CALLBACK + "?")));
    assertThat(connectionCount()).isZero();
  }

  @Test
  void authorize_tenantNotMember_400NoRedirect() throws Exception {
    long other = TestFixtures.createTenant(dsl, "ACTIVE");
    mvc.perform(authorize(params(), other, "ALLOW").with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
    assertThat(connectionCount()).isZero();
  }

  @Test
  void authorize_suspendedTenant_400NoRedirect() throws Exception {
    long suspended = TestFixtures.createTenant(dsl, "SUSPENDED");
    TestFixtures.ensureActiveMember(dsl, userId, suspended);
    mvc.perform(authorize(params(), suspended, "ALLOW").with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
    assertThat(connectionCount()).isZero();
  }

  @Test
  void authorize_badDecision_400NoRedirect() throws Exception {
    mvc.perform(authorize(params(), TENANT_ID, "MAYBE").with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
  }

  @Test
  void authorize_withPatAuth_isForbidden() throws Exception {
    mvc.perform(authorize(params(), TENANT_ID, "ALLOW").with(authentication(nonWeb(userId))))
        .andExpect(status().isForbidden());
    assertThat(connectionCount()).isZero();
  }

  @Test
  void authorize_unauthenticated_is401() throws Exception {
    mvc.perform(authorize(params(), TENANT_ID, "ALLOW")).andExpect(status().isUnauthorized());
  }

  @Test
  void authorize_responseIsNoStore() throws Exception {
    mvc.perform(authorize(params(), TENANT_ID, "ALLOW").with(web(userId)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", containsString("no-store")));
  }

  // ---- SSO 세션(WP-48, 리뷰 F1) ----

  @Test
  void validate_ssoSession_listsOnlySsoEnabledWorkspaces() throws Exception {
    long ssoTenant = ssoTenantWithMember();
    setSso(TENANT_ID, false);
    mvc.perform(validate(params()).with(authentication(sso(userId))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.workspaces[?(@.tenantId == " + ssoTenant + ")]").exists())
        .andExpect(jsonPath("$.workspaces[?(@.tenantId == " + TENANT_ID + ")]").doesNotExist());
  }

  @Test
  void authorize_ssoSession_nonSsoWorkspace_rejectedLikeNonMember() throws Exception {
    ssoTenantWithMember();
    setSso(TENANT_ID, false);
    mvc.perform(authorize(params(), TENANT_ID, "ALLOW").with(authentication(sso(userId))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorDescription").value("이 워크스페이스에는 앱을 연결할 수 없습니다."))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
    assertThat(connectionCount()).isZero();
  }

  @Test
  void authorize_ssoSession_ssoWorkspace_ok() throws Exception {
    long ssoTenant = ssoTenantWithMember();
    String body =
        mvc.perform(authorize(params(), ssoTenant, "ALLOW").with(authentication(sso(userId))))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(query(objectMapper.readTree(body).get("redirectUrl").asString()))
        .containsKey("code");
    assertThat(connectionCount()).isEqualTo(1);
  }

  // ---- 겹친 파라미터(RFC 6749 §3.1, 리뷰 D4.1) ----

  @Test
  void validate_repeatedClientIdOrRedirect_invalidRequestNoRedirect() throws Exception {
    for (String name : List.of("client_id", "redirect_uri")) {
      Map<String, String> p = params();
      mvc.perform(validate(p).queryParam(name, p.get(name)).with(web(userId)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.error").value("invalid_request"))
          .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
    }
  }

  @Test
  void validate_repeatedState_invalidRequestWithRedirectWithoutState() throws Exception {
    String body =
        mvc.perform(validate(params()).queryParam("state", "st-2").with(web(userId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_request"))
            .andExpect(jsonPath("$.errorRedirectUrl").value(startsWith(CALLBACK + "?")))
            .andReturn()
            .getResponse()
            .getContentAsString();
    Map<String, String> q = query(objectMapper.readTree(body).get("errorRedirectUrl").asString());
    assertThat(q).containsEntry("error", "invalid_request").doesNotContainKey("state");
  }

  @Test
  void validate_repeatedCodeChallenge_invalidRequestWithRedirect() throws Exception {
    mvc.perform(validate(params()).queryParam("code_challenge", CHALLENGE).with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorRedirectUrl").value(containsString("state=st-1")));
  }

  @Test
  void authorize_repeatedBodyFields_invalidRequest() throws Exception {
    // 같은 키 두 번(clientId) — 어느 클라이언트인지 모르므로 redirect 없이.
    String clientIdTwice =
        "{\"responseType\":\"code\",\"clientId\":\""
            + clientId
            + "\",\"clientId\":\"swc_other\",\"redirectUri\":\""
            + CALLBACK
            + "\",\"codeChallenge\":\""
            + CHALLENGE
            + "\",\"codeChallengeMethod\":\"S256\",\"tenantId\":1,\"decision\":\"ALLOW\"}";
    mvc.perform(authorizeRaw(clientIdTwice).with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
    // 같은 키 두 번(state) — 클라이언트·redirect 확인 뒤라 돌려보낼 주소와 함께, state 는 싣지 않는다.
    String stateTwice =
        "{\"responseType\":\"code\",\"clientId\":\""
            + clientId
            + "\",\"redirectUri\":\""
            + CALLBACK
            + "\",\"codeChallenge\":\""
            + CHALLENGE
            + "\",\"codeChallengeMethod\":\"S256\",\"state\":\"a\",\"state\":\"b\","
            + "\"tenantId\":1,\"decision\":\"ALLOW\"}";
    String body =
        mvc.perform(authorizeRaw(stateTwice).with(web(userId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_request"))
            .andExpect(jsonPath("$.errorRedirectUrl").value(startsWith(CALLBACK + "?")))
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(query(objectMapper.readTree(body).get("errorRedirectUrl").asString()))
        .doesNotContainKey("state");
    // 동의 화면 필드(decision)가 겹치면 redirect 없이.
    String decisionTwice =
        "{\"responseType\":\"code\",\"clientId\":\""
            + clientId
            + "\",\"redirectUri\":\""
            + CALLBACK
            + "\",\"codeChallenge\":\""
            + CHALLENGE
            + "\",\"codeChallengeMethod\":\"S256\",\"tenantId\":1,"
            + "\"decision\":\"DENY\",\"decision\":\"ALLOW\"}";
    mvc.perform(authorizeRaw(decisionTwice).with(web(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_request"))
        .andExpect(jsonPath("$.errorRedirectUrl").doesNotExist());
    assertThat(connectionCount()).isZero();
  }

  // ---- 인증 수단(리뷰 D4.4) ----

  @Test
  void validate_unauthenticated_is401() throws Exception {
    mvc.perform(validate(params())).andExpect(status().isUnauthorized());
  }

  @Test
  void validateAndAuthorize_withRealSwoBearer_isForbidden() throws Exception {
    // 실제 swo_ 토큰(연결 + ACCESS 행) — 인증 필터를 거쳐 인증되지만 웹 세션이 아니라 403.
    long connectionId = connections.findOrCreateActive(userId, TENANT_ID, clientPk).row().id();
    String swo = CapabilityTokens.generate("swo_");
    tokens.insert(
        connectionId,
        "ACCESS",
        CapabilityTokens.sha256Hex(swo),
        swo.substring(0, 12),
        null,
        OffsetDateTime.now().plusHours(1));

    mvc.perform(validate(params()).header("Authorization", "Bearer " + swo))
        .andExpect(status().isForbidden());
    mvc.perform(authorize(params(), TENANT_ID, "ALLOW").header("Authorization", "Bearer " + swo))
        .andExpect(status().isForbidden());
    assertThat(
            dsl.fetchCount(
                OAUTH_AUTHORIZATION_CODE, OAUTH_AUTHORIZATION_CODE.CONNECTION_ID.eq(connectionId)))
        .isZero();
  }

  // ---- 도우미 ----

  /** 정상 인가 요청 파라미터(쿼리 이름, snake_case). 순서를 지키려 LinkedHashMap. */
  private Map<String, String> params() {
    Map<String, String> p = new LinkedHashMap<>();
    p.put("response_type", "code");
    p.put("client_id", clientId);
    p.put("redirect_uri", CALLBACK);
    p.put("code_challenge", CHALLENGE);
    p.put("code_challenge_method", "S256");
    p.put("state", "st-1");
    p.put("resource", "https://mcp.example/mcp");
    return p;
  }

  private static MockHttpServletRequestBuilder validate(Map<String, String> p) {
    MockHttpServletRequestBuilder b = get("/api/v1/oauth/authorize/validate");
    p.forEach((k, v) -> b.queryParam(k, v));
    return b;
  }

  /** 승인 요청 — 본문은 camelCase JSON(웹 API 관례). */
  private MockHttpServletRequestBuilder authorize(
      Map<String, String> p, long tenantId, String decision) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("responseType", p.get("response_type"));
    body.put("clientId", p.get("client_id"));
    body.put("redirectUri", p.get("redirect_uri"));
    body.put("codeChallenge", p.get("code_challenge"));
    body.put("codeChallengeMethod", p.get("code_challenge_method"));
    body.put("state", p.get("state"));
    body.put("resource", p.get("resource"));
    body.put("tenantId", tenantId);
    body.put("decision", decision);
    return post("/api/v1/oauth/authorize")
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(body));
  }

  /** 승인 요청 — 본문 글자 그대로(겹친 키 검사용). */
  private static MockHttpServletRequestBuilder authorizeRaw(String json) {
    return post("/api/v1/oauth/authorize").contentType(MediaType.APPLICATION_JSON).content(json);
  }

  /** SSO 로그인 웹 세션(amr=sso) 인증. */
  private static Authentication sso(long uid) {
    UsernamePasswordAuthenticationToken token =
        new UsernamePasswordAuthenticationToken(uid, "n/a", List.of());
    token.setDetails(new AuthDetails(AuthDetails.SSO));
    return token;
  }

  /** SSO 를 켠 ACTIVE 테넌트를 만들고 이 사용자를 ACTIVE 멤버로 넣는다. */
  private long ssoTenantWithMember() {
    long t = TestFixtures.createTenant(dsl, "ACTIVE");
    setSso(t, true);
    TestFixtures.ensureActiveMember(dsl, userId, t);
    return t;
  }

  private void setSso(long tenantId, boolean enabled) {
    dsl.update(TENANT).set(TENANT.SSO_ENABLED, enabled).where(TENANT.ID.eq(tenantId)).execute();
  }

  /** ALLOW 를 보내 200 의 redirectUrl 을 돌려준다. */
  private String allow(Map<String, String> p) throws Exception {
    String body =
        mvc.perform(authorize(p, TENANT_ID, "ALLOW").with(web(userId)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode node = objectMapper.readTree(body);
    return node.get("redirectUrl").asString();
  }

  private static org.springframework.test.web.servlet.request.RequestPostProcessor web(long uid) {
    return authentication(WebSessionAuth.of(uid, List.of()));
  }

  /** 웹 세션이 아닌 인증(PAT·swo_·AI 키처럼 AuthDetails 없음). */
  private static Authentication nonWeb(long uid) {
    return new UsernamePasswordAuthenticationToken(uid, null, List.of());
  }

  /** redirect URL 의 쿼리를 디코드해 이름→값(첫 값)으로. */
  private static Map<String, String> query(String url) {
    Map<String, String> out = new LinkedHashMap<>();
    UriComponentsBuilder.fromUriString(url)
        .build()
        .getQueryParams()
        .forEach(
            (k, vs) ->
                out.put(
                    k,
                    vs.get(0) == null ? "" : URLDecoder.decode(vs.get(0), StandardCharsets.UTF_8)));
    return out;
  }

  private String issuer() {
    return CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
  }

  private int connectionCount() {
    return dsl.fetchCount(OAUTH_CONNECTION, OAUTH_CONNECTION.USER_ID.eq(userId));
  }

  private int auditCount() {
    return dsl.fetchCount(
        DSL.table(DSL.name("audit_log")),
        DSL.field(DSL.name("user_id"), Long.class)
            .eq(userId)
            .and(DSL.field(DSL.name("action_type"), String.class).eq("OAUTH_CONNECTION_CREATED"))
            .and(DSL.field(DSL.name("resource"), String.class).eq("oauth_connection")));
  }
}

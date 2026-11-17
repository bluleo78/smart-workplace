package com.workplace.auth.oauth;

import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.oauth.exception.OAuthClientException;
import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.service.OAuthClientService;
import com.workplace.auth.oauth.service.OAuthClientService.ResolvedClient;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.FixtureHttpFetcherConfig;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1685 — OAuth 클라이언트(DCR 등록·CIMD 해석)와 인가 서버 메타데이터·공개 CORS 통합 테스트. 클래스 단위 {@code @Transactional}
 * 로 등록·CIMD 캐시 행이 롤백돼 다음 테스트에 남지 않는다. CIMD 문서는 {@link FixtureHttpFetcherConfig} 의 고정 응답이다.
 */
@Transactional
class OAuthClientAndMetadataTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired OAuthClientService clientService;
  @Autowired OAuthClientRepository clients;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;

  @Value("${workplace.public-base-url}")
  String publicBaseUrl;

  @BeforeEach
  void resetFetchCounts() {
    FixtureHttpFetcherConfig.resetFetchCount(FixtureHttpFetcherConfig.CIMD_CLIENT);
    FixtureHttpFetcherConfig.resetFetchCount(FixtureHttpFetcherConfig.CIMD_MISMATCH);
  }

  // ---- 메타데이터 ----

  @Test
  void metadata_hasS256CimdRegistrationAndPublicUrls() throws Exception {
    String issuer = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
    String body =
        mvc.perform(get("/.well-known/oauth-authorization-server"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode m = objectMapper.readTree(body);
    assertThat(m.get("issuer").asString()).isEqualTo(issuer);
    for (String key :
        List.of("authorization_endpoint", "token_endpoint", "registration_endpoint")) {
      assertThat(m.get(key).asString()).as(key).startsWith(issuer + "/");
    }
    assertThat(m.get("authorization_endpoint").asString()).isEqualTo(issuer + "/oauth/authorize");
    assertThat(m.get("token_endpoint").asString()).isEqualTo(issuer + "/api/v1/oauth/token");
    assertThat(m.get("registration_endpoint").asString())
        .isEqualTo(issuer + "/api/v1/oauth/register");
    assertThat(texts(m.get("code_challenge_methods_supported"))).containsExactly("S256");
    assertThat(texts(m.get("response_types_supported"))).containsExactly("code");
    assertThat(texts(m.get("grant_types_supported")))
        .containsExactly("authorization_code", "refresh_token");
    assertThat(texts(m.get("token_endpoint_auth_methods_supported"))).containsExactly("none");
    assertThat(m.get("client_id_metadata_document_supported").asBoolean()).isTrue();
    assertThat(m.get("authorization_response_iss_parameter_supported").asBoolean()).isTrue();
    assertThat(m.has("scopes_supported")).isFalse();
  }

  // ---- DCR ----

  @Test
  void register_dcr_returnsSwcClientId() throws Exception {
    String body =
        mvc.perform(
                post("/api/v1/oauth/register")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"redirect_uris\":[\"http://localhost:33418/callback\"],"
                            + "\"client_name\":\"Claude Code\","
                            + "\"token_endpoint_auth_method\":\"none\","
                            + "\"grant_types\":[\"authorization_code\",\"refresh_token\"],"
                            + "\"response_types\":[\"code\"]}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.client_id").value(startsWith("swc_")))
            .andExpect(jsonPath("$.client_name").value("Claude Code"))
            .andExpect(jsonPath("$.redirect_uris[0]").value("http://localhost:33418/callback"))
            .andExpect(jsonPath("$.token_endpoint_auth_method").value("none"))
            .andExpect(jsonPath("$.client_id_issued_at").isNumber())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String clientId = objectMapper.readTree(body).get("client_id").asString();
    var row = clients.findByClientId(clientId).orElseThrow();
    assertThat(row.kind()).isEqualTo("DCR");
    assertThat(row.clientName()).isEqualTo("Claude Code");
    assertThat(row.redirectUris()).containsExactly("http://localhost:33418/callback");

    // 해석도 표에서 된다
    ResolvedClient resolved = clientService.resolve(clientId);
    assertThat(resolved.kind()).isEqualTo("DCR");
    assertThat(resolved.redirectUris()).containsExactly("http://localhost:33418/callback");
  }

  @Test
  void register_withoutName_usesDefaultName() throws Exception {
    mvc.perform(
            post("/api/v1/oauth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"redirect_uris\":[\"https://app.example/cb\"]}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.client_name").value("이름 없는 앱"))
        .andExpect(jsonPath("$.token_endpoint_auth_method").value("none"));
  }

  @Test
  void register_rejectsHttpNonLoopbackRedirect() throws Exception {
    mvc.perform(
            post("/api/v1/oauth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"redirect_uris\":[\"http://evil.example/cb\"]}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_redirect_uri"))
        .andExpect(jsonPath("$.error_description").isString());
  }

  @Test
  void register_rejectsClientSecretAuthMethod() throws Exception {
    mvc.perform(
            post("/api/v1/oauth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"redirect_uris\":[\"https://app.example/cb\"],"
                        + "\"token_endpoint_auth_method\":\"client_secret_basic\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_client_metadata"));
  }

  @Test
  void register_rejectsTooLongNameAndUnsupportedGrantAndBadJson() throws Exception {
    mvc.perform(
            post("/api/v1/oauth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"redirect_uris\":[\"https://app.example/cb\"],\"client_name\":\""
                        + "가".repeat(101)
                        + "\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_client_metadata"));
    mvc.perform(
            post("/api/v1/oauth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"redirect_uris\":[\"https://app.example/cb\"],"
                        + "\"grant_types\":[\"client_credentials\"]}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_client_metadata"));
    mvc.perform(
            post("/api/v1/oauth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"redirect_uris\": \"not-json"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_client_metadata"));
  }

  /** 리뷰 D3.1 — grant_types·response_types 의 null 원소는 500(NPE)이 아니라 400 invalid_client_metadata. */
  @Test
  void register_nullElementInGrantOrResponseTypes_isInvalidClientMetadata() throws Exception {
    for (String field : List.of("grant_types", "response_types")) {
      mvc.perform(
              post("/api/v1/oauth/register")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(
                      "{\"redirect_uris\":[\"https://app.example/cb\"],\"" + field + "\":[null]}"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.error").value("invalid_client_metadata"));
    }
  }

  @Test
  void resolve_unknownDcrOrGarbage_isInvalidClient() {
    assertInvalidClient("swc_doesnotexist");
    assertInvalidClient("plain-name");
    assertInvalidClient("");
    assertInvalidClient(null);
  }

  // ---- CIMD ----

  @Test
  void cimd_fetchesAndCaches() {
    String url = FixtureHttpFetcherConfig.CIMD_CLIENT;
    ResolvedClient first = clientService.resolve(url);
    ResolvedClient second = clientService.resolve(url);

    assertThat(FixtureHttpFetcherConfig.fetchCount(url)).isEqualTo(1);
    assertThat(first.kind()).isEqualTo("CIMD");
    assertThat(first.clientId()).isEqualTo(url);
    assertThat(first.clientName()).isEqualTo("픽스처 CIMD 앱");
    assertThat(first.redirectUris()).containsExactly(FixtureHttpFetcherConfig.CIMD_REDIRECT);
    assertThat(first.clientUri()).isEqualTo("https://cimd.example");
    assertThat(second.id()).isEqualTo(first.id());
    assertThat(clients.findByClientId(url).orElseThrow().logoUri())
        .isEqualTo("https://cimd.example/logo.png");
  }

  @Test
  void cimd_staleCache_isRefetchedAfterAnHour() {
    String url = FixtureHttpFetcherConfig.CIMD_CLIENT;
    clients.upsertCimd(
        url,
        "옛 이름",
        List.of("https://old.example/cb"),
        null,
        null,
        OffsetDateTime.now().minusHours(2));
    ResolvedClient r = clientService.resolve(url);
    assertThat(FixtureHttpFetcherConfig.fetchCount(url)).isEqualTo(1);
    assertThat(r.clientName()).isEqualTo("픽스처 CIMD 앱");
  }

  @Test
  void cimd_fetchFailure_usesCacheWithin24Hours_elseRejects() {
    // 픽스처에 없는 URL — 가져오기는 늘 실패한다
    String url = "https://203.0.113.50/oauth/gone.json";
    clients.upsertCimd(
        url,
        "캐시 앱",
        List.of("https://cache.example/cb"),
        null,
        null,
        OffsetDateTime.now().minusHours(2));
    assertThat(clientService.resolve(url).clientName()).isEqualTo("캐시 앱");

    dsl.update(OAUTH_CLIENT)
        .set(OAUTH_CLIENT.FETCHED_AT, OffsetDateTime.now().minusHours(25))
        .where(OAUTH_CLIENT.CLIENT_ID.eq(url))
        .execute();
    assertInvalidClient(url);
  }

  @Test
  void cimd_clientIdMismatch_rejected() {
    assertInvalidClient(FixtureHttpFetcherConfig.CIMD_MISMATCH);
    assertThat(clients.findByClientId(FixtureHttpFetcherConfig.CIMD_MISMATCH)).isEmpty();
  }

  @Test
  void cimd_privateAddress_rejected() {
    String url = "https://10.0.0.1/client.json";
    FixtureHttpFetcherConfig.resetFetchCount(url);
    assertInvalidClient(url);
    assertThat(FixtureHttpFetcherConfig.fetchCount(url)).isZero();
    // 루프백·링크로컬(클라우드 메타데이터)도 가져오지 않는다
    for (String u :
        List.of(
            "https://127.0.0.1/client.json",
            "https://[::1]/client.json",
            "https://169.254.169.254/latest/meta-data",
            "https://localhost/client.json")) {
      FixtureHttpFetcherConfig.resetFetchCount(u);
      assertInvalidClient(u);
      assertThat(FixtureHttpFetcherConfig.fetchCount(u)).as(u).isZero();
    }
  }

  @Test
  void cimd_httpUrl_rejected() {
    String url = "http://203.0.113.50/oauth/client.json";
    FixtureHttpFetcherConfig.resetFetchCount(url);
    assertInvalidClient(url);
    assertThat(FixtureHttpFetcherConfig.fetchCount(url)).isZero();
  }

  @Test
  void cimd_malformedUrls_rejectedWithoutFetch() {
    for (String u :
        List.of(
            "https://203.0.113.50",
            "https://203.0.113.50/",
            "https://203.0.113.50/oauth/client.json#x",
            "https://user@203.0.113.50/oauth/client.json")) {
      FixtureHttpFetcherConfig.resetFetchCount(u);
      assertInvalidClient(u);
      assertThat(FixtureHttpFetcherConfig.fetchCount(u)).as(u).isZero();
    }
  }

  // ---- 공개 CORS ----

  @Test
  void publicOAuthEndpoints_allowAnyOriginWithoutCredentials() throws Exception {
    mvc.perform(
            options("/api/v1/oauth/register")
                .header("Origin", "https://claude.ai")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "content-type"))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", "*"))
        .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    mvc.perform(
            options("/api/v1/oauth/token")
                .header("Origin", "https://claude.ai")
                .header("Access-Control-Request-Method", "POST"))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", "*"));
    mvc.perform(
            get("/.well-known/oauth-authorization-server").header("Origin", "https://claude.ai"))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", "*"))
        .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    // 기존 /api/** 는 그대로 — 모르는 원점에 * 를 주지 않는다
    mvc.perform(get("/api/v1/health").header("Origin", "https://claude.ai"))
        .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
  }

  private void assertInvalidClient(String clientId) {
    assertThatThrownBy(() -> clientService.resolve(clientId))
        .as(String.valueOf(clientId))
        .isInstanceOfSatisfying(
            OAuthClientException.class, e -> assertThat(e.error()).isEqualTo("invalid_client"));
  }

  private static List<String> texts(JsonNode array) {
    return array.valueStream().map(JsonNode::asString).toList();
  }
}

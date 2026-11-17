package com.workplace.auth.oauth;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.WebSessionAuth;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * OAuth 토큰 흐름 통합 테스트 공용 도우미(WP-1685) — 실제 승인 API(웹 세션 ALLOW)로 code 를 받고, 토큰 엔드포인트를 폼 본문 실제 HTTP 로
 * 부르고, 받은 {@code swo_} 로 API 를 부른다. {@code OAuthTokenEndpointTest}·{@code OAuthConnectionApiTest} 가
 * 같은 흐름을 따로 들고 있던 것을 한 곳에 모아 두 테스트가 같은 요청 모양을 쓰게 한다.
 *
 * <p>{@code @LocalServerPort} 가 주입된 뒤(테스트의 {@code @BeforeEach})에 만든다.
 */
final class OAuthTestSupport {

  /** 테스트 클라이언트의 redirect_uri(Claude 앱 커넥터 콜백 모양). */
  static final String CALLBACK = "https://claude.ai/api/mcp/auth_callback";

  /** 인가 요청이 싣는 resource(RFC 8707). */
  static final String RESOURCE = "https://mcp.example/mcp";

  /** RFC 7636 부록 B 값 — verifier 와 그 S256 challenge. */
  static final String VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  static final String CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  /** 토큰 엔드포인트 경로. */
  static final String TOKEN_PATH = "/api/v1/oauth/token";

  private final MockMvc mvc;
  private final ObjectMapper objectMapper;
  private final int port;
  private final RestTemplate rest = new RestTemplateBuilder().build();

  OAuthTestSupport(MockMvc mvc, ObjectMapper objectMapper, int port) {
    this.mvc = mvc;
    this.objectMapper = objectMapper;
    this.port = port;
  }

  /** 실제 승인 API(웹 세션 ALLOW)로 code 를 받는다 — 연결 생성·code 저장이 커밋된다. */
  String obtainCode(long userId, String clientId, long tenantId) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("responseType", "code");
    body.put("clientId", clientId);
    body.put("redirectUri", CALLBACK);
    body.put("codeChallenge", CHALLENGE);
    body.put("codeChallengeMethod", "S256");
    body.put("state", "st-1");
    body.put("resource", RESOURCE);
    body.put("tenantId", tenantId);
    body.put("decision", "ALLOW");
    String res =
        mvc.perform(
                post("/api/v1/oauth/authorize")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(body))
                    .with(authentication(WebSessionAuth.of(userId, List.of()))))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String redirectUrl = objectMapper.readTree(res).get("redirectUrl").asString();
    String code =
        UriComponentsBuilder.fromUriString(redirectUrl).build().getQueryParams().getFirst("code");
    return URLDecoder.decode(code, StandardCharsets.UTF_8);
  }

  /** authorization_code grant 폼. */
  MultiValueMap<String, String> codeForm(String code, String clientId) {
    MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
    form.add("grant_type", "authorization_code");
    form.add("code", code);
    form.add("redirect_uri", CALLBACK);
    form.add("client_id", clientId);
    form.add("code_verifier", VERIFIER);
    form.add("resource", RESOURCE);
    return form;
  }

  /** refresh_token grant 폼. */
  MultiValueMap<String, String> refreshForm(String refreshToken, String clientId) {
    MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
    form.add("grant_type", "refresh_token");
    form.add("refresh_token", refreshToken);
    form.add("client_id", clientId);
    return form;
  }

  /** 폼 본문({@code application/x-www-form-urlencoded})으로 토큰 엔드포인트를 부른다. */
  ResponseEntity<String> token(MultiValueMap<String, String> form) {
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
    return exchange(TOKEN_PATH, HttpMethod.POST, new HttpEntity<>(form, headers));
  }

  /** Bearer 토큰을 실어 GET. */
  ResponseEntity<String> getWithBearer(String path, String bearer) {
    return exchange(path, HttpMethod.GET, new HttpEntity<>(bearerHeaders(bearer)));
  }

  /** Bearer 토큰을 실어 DELETE. */
  ResponseEntity<String> deleteWithBearer(String path, String bearer) {
    return exchange(path, HttpMethod.DELETE, new HttpEntity<>(bearerHeaders(bearer)));
  }

  /** 실제 HTTP 호출 — 4xx·5xx 도 예외 대신 상태·헤더·본문을 담은 응답으로 돌려준다. */
  ResponseEntity<String> exchange(String path, HttpMethod method, HttpEntity<?> entity) {
    try {
      return rest.exchange("http://localhost:" + port + path, method, entity, String.class);
    } catch (HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode())
          .headers(e.getResponseHeaders())
          .body(e.getResponseBodyAsString());
    }
  }

  /** JSON 응답 본문의 최상위 필드(문자열), 없으면 null. */
  String field(ResponseEntity<String> res, String name) {
    JsonNode node = objectMapper.readTree(res.getBody()).get(name);
    return node == null ? null : node.asString();
  }

  private static HttpHeaders bearerHeaders(String bearer) {
    HttpHeaders headers = new HttpHeaders();
    headers.set("Authorization", "Bearer " + bearer);
    return headers;
  }
}

package com.workplace.auth.sso;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * 전역 멀티테넌트 Entra 앱의 OIDC 호출(WP-48) — 인가 URL, 토큰 교환(PKCE + client_secret_post), id_token 검증.
 *
 * <p>멀티테넌트라 issuer 가 고정값이 아니다. 토큰의 tid 가 GUID 이고 개인 MSA 테넌트가 아니며 iss 가 정확히 {@code
 * {authority}/{tid}/v2.0} 인지로 검증한다(Microsoft 권장 방식). 모든 HTTP 호출은 5초 타임아웃 — IdP 가 느리면 로그인 요청 스레드가
 * 그만큼 묶인다. 예외 메시지에 응답 본문·시크릿을 싣지 않는다(로그로 나간다).
 */
@Slf4j
@Component
public class M365OidcClient {

  static final String MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
  private static final Pattern GUID =
      Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
  private static final Duration TIMEOUT = Duration.ofSeconds(5);
  // upn 클레임은 profile 범위로 들어온다. email 은 매칭에 쓰지 않으므로 요청하지 않는다.
  private static final String SCOPE = "openid profile";

  private final SsoProperties props;
  private final RestClient http;
  private final RestTemplate jwksHttp;
  // JWKS 는 공통 엔드포인트 하나라 디코더도 하나. 모르는 kid 를 만나면 Nimbus 가 JWKS 를 다시 가져온다.
  private volatile NimbusJwtDecoder decoder;

  public M365OidcClient(SsoProperties props, RestClient.Builder builder) {
    this.props = props;
    // JDK HttpClient — HttpURLConnection 은 4xx 본문을 비워 AADSTS 코드 분류가 사라진다.
    var factory =
        new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(TIMEOUT).build());
    factory.setReadTimeout(TIMEOUT);
    this.http = builder.requestFactory(factory).build();
    this.jwksHttp = new RestTemplate(factory);
  }

  /** Microsoft 인가 엔드포인트 URL — PKCE S256, response_mode=query. */
  public String authorizationUrl(String state, String nonce, String codeChallenge) {
    return UriComponentsBuilder.fromUriString(
            props.authority() + "/organizations/oauth2/v2.0/authorize")
        .queryParam("client_id", props.clientId())
        .queryParam("response_type", "code")
        .queryParam("redirect_uri", props.redirectUri())
        .queryParam("response_mode", "query")
        .queryParam("scope", SCOPE)
        .queryParam("state", state)
        .queryParam("nonce", nonce)
        .queryParam("code_challenge", codeChallenge)
        .queryParam("code_challenge_method", "S256")
        .encode()
        .build()
        .toUriString();
  }

  /** 고객사 Entra 관리자가 조직 전체를 대신해 한 번 동의하는 URL. 워크스페이스 SSO 설정 화면에 노출. */
  public String adminConsentUrl() {
    return UriComponentsBuilder.fromUriString(
            props.authority() + "/organizations/v2.0/adminconsent")
        .queryParam("client_id", props.clientId())
        .queryParam("scope", SCOPE)
        .queryParam("redirect_uri", props.redirectUri())
        .encode()
        .build()
        .toUriString();
  }

  /** 인가 코드 → id_token. 실패는 분류해 SsoLoginException 으로 던진다. */
  public String exchange(String code, String codeVerifier) {
    var form = new LinkedMultiValueMap<String, String>();
    form.add("grant_type", "authorization_code");
    form.add("code", code);
    form.add("code_verifier", codeVerifier);
    form.add("redirect_uri", props.redirectUri());
    form.add("client_id", props.clientId());
    form.add("client_secret", props.clientSecret());
    form.add("scope", SCOPE);
    Map<?, ?> res;
    try {
      res =
          http.post()
              .uri(props.authority() + "/organizations/oauth2/v2.0/token")
              .contentType(MediaType.APPLICATION_FORM_URLENCODED)
              .body(form)
              .retrieve()
              .body(Map.class);
    } catch (HttpClientErrorException e) {
      String body = e.getResponseBodyAsString();
      if (OidcErrorClassifier.isConfigError(body)) {
        // 운영 설정 문제(시크릿 만료·무효) — 운영자가 봐야 하므로 ERROR. 본문은 AADSTS 코드만 판별에 쓰고 로그에 싣지 않는다.
        log.error("SSO 토큰 교환 실패: 클라이언트 인증 오류(시크릿 만료/무효 가능성) status={}", e.getStatusCode().value());
      }
      throw new SsoLoginException(
          OidcErrorClassifier.fromTokenError(body), "token_error_" + e.getStatusCode().value());
    } catch (RestClientException | IllegalArgumentException e) {
      throw new SsoLoginException(
          SsoLoginException.RETRY, "token_exchange_failed: " + e.getClass().getSimpleName());
    }
    if (res == null || !(res.get("id_token") instanceof String idToken)) {
      throw new SsoLoginException(SsoLoginException.RETRY, "no_id_token");
    }
    return idToken;
  }

  /** id_token 서명·tid/iss·aud·exp/nbf·nonce 검증. */
  public Jwt decode(String idToken, String expectedNonce) {
    Jwt jwt;
    try {
      jwt = decoder().decode(idToken);
    } catch (JwtException e) {
      throw new SsoLoginException(SsoLoginException.RETRY, "id_token_invalid: " + e.getMessage());
    }
    // 기대값이 null 이면 nonce 없는 토큰과 equals 로 맞아떨어진다 — 기대값 없는 검증은 실패로 본다.
    if (expectedNonce == null || !expectedNonce.equals(jwt.getClaimAsString("nonce"))) {
      throw new SsoLoginException(SsoLoginException.RETRY, "id_token_invalid: nonce");
    }
    return jwt;
  }

  private NimbusJwtDecoder decoder() {
    NimbusJwtDecoder d = decoder;
    if (d == null) {
      synchronized (this) {
        if (decoder == null) {
          NimbusJwtDecoder created =
              NimbusJwtDecoder.withJwkSetUri(props.authority() + "/common/discovery/v2.0/keys")
                  .restOperations(jwksHttp)
                  .build();
          created.setJwtValidator(
              new DelegatingOAuth2TokenValidator<>(
                  new JwtTimestampValidator(),
                  // JwtTimestampValidator 는 exp 가 없으면 만료 검사를 건너뛴다 — 무기한 토큰을 막기 위해 exp 존재를 강제.
                  new JwtClaimValidator<Instant>(JwtClaimNames.EXP, Objects::nonNull),
                  tenantIssuerValidator(),
                  new JwtClaimValidator<List<String>>(
                      JwtClaimNames.AUD, aud -> aud != null && aud.contains(props.clientId()))));
          decoder = created;
        }
        d = decoder;
      }
    }
    return d;
  }

  /** 멀티테넌트 issuer 검증 — tid 가 GUID·비 MSA 이고 iss == {authority}/{tid}/v2.0. */
  private OAuth2TokenValidator<Jwt> tenantIssuerValidator() {
    return jwt -> {
      String tid = jwt.getClaimAsString("tid");
      String iss = jwt.getClaimAsString(JwtClaimNames.ISS);
      boolean ok =
          tid != null
              && GUID.matcher(tid).matches()
              && !MSA_TENANT.equals(tid)
              && (props.authority() + "/" + tid + "/v2.0").equals(iss);
      return ok
          ? OAuth2TokenValidatorResult.success()
          : OAuth2TokenValidatorResult.failure(
              new OAuth2Error("invalid_token", "tid/iss 불일치", null));
    };
  }
}

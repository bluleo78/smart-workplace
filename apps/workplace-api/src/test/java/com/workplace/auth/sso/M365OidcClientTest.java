package com.workplace.auth.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.util.Date;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.util.UriComponentsBuilder;

/** M365OidcClient — 인가 URL, 토큰 교환, 멀티테넌트 id_token 검증. */
class M365OidcClientTest extends SsoIntegrationTestBase {

  private static final String TID = "11111111-2222-3333-4444-555555555555";

  @Autowired M365OidcClient client;

  @Test
  void authorizationUrl_hasPkceAndOrganizationsAuthority() {
    String url = client.authorizationUrl("st", "nn", "ch");
    var q = UriComponentsBuilder.fromUri(URI.create(url)).build().getQueryParams();
    assertThat(url).startsWith(FAKE.authority() + "/organizations/oauth2/v2.0/authorize?");
    assertThat(q.getFirst("client_id")).isEqualTo("test-client");
    assertThat(q.getFirst("response_type")).isEqualTo("code");
    assertThat(q.getFirst("scope")).isEqualTo("openid%20profile%20email");
    assertThat(q.getFirst("state")).isEqualTo("st");
    assertThat(q.getFirst("nonce")).isEqualTo("nn");
    assertThat(q.getFirst("code_challenge")).isEqualTo("ch");
    assertThat(q.getFirst("code_challenge_method")).isEqualTo("S256");
  }

  @Test
  void adminConsentUrl_usesOrganizations() {
    assertThat(client.adminConsentUrl())
        .startsWith(FAKE.authority() + "/organizations/v2.0/adminconsent?client_id=test-client");
  }

  @Test
  void exchangeAndDecode_validToken() {
    FAKE.claims(f -> FAKE.claimsBuilder(TID, "oid-1").claim("nonce", "n1").build());
    String idToken = client.exchange("code-1", "verifier-1");
    Jwt jwt = client.decode(idToken, "n1");

    assertThat(jwt.getClaimAsString("oid")).isEqualTo("oid-1");
    assertThat(FAKE.lastTokenRequestForm())
        .containsEntry("code", "code-1")
        .containsEntry("code_verifier", "verifier-1")
        .containsEntry("client_secret", "test-secret");
  }

  @Test
  void decode_rejectsNonceMismatch() {
    FAKE.claims(f -> FAKE.claimsBuilder(TID, "oid-1").claim("nonce", "other").build());
    String idToken = client.exchange("c", "v");
    assertThatThrownBy(() -> client.decode(idToken, "n1"))
        .isInstanceOf(SsoLoginException.class)
        .extracting("webCode")
        .isEqualTo("retry");
  }

  @Test
  void decode_rejectsIssuerNotMatchingTid() {
    FAKE.claims(
        f ->
            FAKE.claimsBuilder(TID, "oid-1")
                .claim("nonce", "n1")
                .issuer(FAKE.authority() + "/99999999-2222-3333-4444-555555555555/v2.0")
                .build());
    String idToken = client.exchange("c", "v");
    assertThatThrownBy(() -> client.decode(idToken, "n1")).isInstanceOf(SsoLoginException.class);
  }

  @Test
  void decode_rejectsPersonalMicrosoftAccountTenant() {
    String msa = "9188040d-6c67-4c5b-b112-36a304b66dad";
    FAKE.claims(f -> FAKE.claimsBuilder(msa, "oid-1").claim("nonce", "n1").build());
    String idToken = client.exchange("c", "v");
    assertThatThrownBy(() -> client.decode(idToken, "n1")).isInstanceOf(SsoLoginException.class);
  }

  @Test
  void decode_rejectsWrongAudience() {
    FAKE.claims(
        f -> FAKE.claimsBuilder(TID, "oid-1").claim("nonce", "n1").audience("other-app").build());
    String idToken = client.exchange("c", "v");
    assertThatThrownBy(() -> client.decode(idToken, "n1")).isInstanceOf(SsoLoginException.class);
  }

  @Test
  void decode_rejectsExpired() {
    FAKE.claims(
        f ->
            FAKE.claimsBuilder(TID, "oid-1")
                .claim("nonce", "n1")
                .expirationTime(new Date(System.currentTimeMillis() - 600_000))
                .build());
    String idToken = client.exchange("c", "v");
    assertThatThrownBy(() -> client.decode(idToken, "n1")).isInstanceOf(SsoLoginException.class);
  }

  /** exp 없는 id_token 은 만료 검사를 건너뛰므로(JwtTimestampValidator) 명시적으로 거부한다(WP-48). */
  @Test
  void decode_rejectsMissingExp() {
    FAKE.claims(
        f -> FAKE.claimsBuilder(TID, "oid-1").claim("nonce", "n1").expirationTime(null).build());
    String idToken = client.exchange("c", "v");
    assertThatThrownBy(() -> client.decode(idToken, "n1")).isInstanceOf(SsoLoginException.class);
  }

  @Test
  void decode_rejectsUnpublishedSigningKey() throws Exception {
    FAKE.signWithUnpublishedKey();
    FAKE.claims(f -> FAKE.claimsBuilder(TID, "oid-1").claim("nonce", "n1").build());
    String idToken = client.exchange("c", "v");
    assertThatThrownBy(() -> client.decode(idToken, "n1")).isInstanceOf(SsoLoginException.class);
  }

  @Test
  void exchange_invalidGrantIsRetry() {
    FAKE.failTokenEndpoint(400, "{\"error\":\"invalid_grant\"}");
    assertThatThrownBy(() -> client.exchange("c", "v"))
        .isInstanceOf(SsoLoginException.class)
        .extracting("webCode")
        .isEqualTo("retry");
  }

  @Test
  void exchange_consentRequiredIsConsent() {
    FAKE.failTokenEndpoint(
        400, "{\"error\":\"invalid_grant\",\"error_description\":\"AADSTS65001: not consented\"}");
    assertThatThrownBy(() -> client.exchange("c", "v"))
        .isInstanceOf(SsoLoginException.class)
        .extracting("webCode")
        .isEqualTo("consent");
  }
}

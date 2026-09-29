package com.workplace.auth.sso;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 인가/토큰 오류 → 웹 코드 분류. */
class OidcErrorClassifierTest {

  @Test
  void authorize_consentRequired() {
    assertThat(OidcErrorClassifier.fromAuthorizeError("consent_required", null)).isEqualTo("consent");
    assertThat(OidcErrorClassifier.fromAuthorizeError("access_denied", "AADSTS65001: The user or administrator has not consented"))
        .isEqualTo("consent");
    assertThat(OidcErrorClassifier.fromAuthorizeError("access_denied", "AADSTS90094: admin approval required"))
        .isEqualTo("consent");
  }

  @Test
  void authorize_userCancelIsRetry() {
    assertThat(OidcErrorClassifier.fromAuthorizeError("access_denied", "AADSTS65004: User declined to consent"))
        .isEqualTo("retry");
    assertThat(OidcErrorClassifier.fromAuthorizeError("access_denied", null)).isEqualTo("retry");
  }

  @Test
  void token_classification() {
    assertThat(OidcErrorClassifier.fromTokenError("{\"error\":\"invalid_grant\",\"error_description\":\"AADSTS65001: consent\"}"))
        .isEqualTo("consent");
    assertThat(OidcErrorClassifier.fromTokenError("{\"error\":\"invalid_grant\"}")).isEqualTo("retry");
    assertThat(OidcErrorClassifier.isConfigError("{\"error\":\"invalid_client\",\"error_description\":\"AADSTS7000222: expired\"}"))
        .isTrue();
    assertThat(OidcErrorClassifier.isConfigError("{\"error\":\"invalid_client\"}")).isTrue();
    assertThat(OidcErrorClassifier.isConfigError("{\"error\":\"invalid_grant\"}")).isFalse();
    assertThat(OidcErrorClassifier.fromTokenError(null)).isEqualTo("retry");
  }
}

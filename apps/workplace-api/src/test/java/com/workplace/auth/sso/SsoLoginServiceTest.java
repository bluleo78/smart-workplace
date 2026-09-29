package com.workplace.auth.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.service.AuthService;
import com.workplace.auth.web.RefreshTokenCookies;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseCookie;

/**
 * SsoLoginService.callback 경계 단위 테스트(WP-48) — 예상 못 한 예외의 리다이렉트, state_invalid 미감사, 감사 사유 정제. 의존성은
 * 모두 목으로 두어 실패 분기만 정확히 겨냥한다(정상 흐름은 SsoLoginFlowTest 가 가짜 IdP 로 검증).
 */
class SsoLoginServiceTest {

  private final SsoProperties props =
      new SsoProperties("client-id", "secret", "http://localhost/cb", null);
  private final SsoTransactionCookie txCookie = mock(SsoTransactionCookie.class);
  private final M365OidcClient oidc = mock(M365OidcClient.class);
  private final SsoUserResolver resolver = mock(SsoUserResolver.class);
  private final AuthService authService = mock(AuthService.class);
  private final RefreshTokenCookies refreshCookies = mock(RefreshTokenCookies.class);
  private final AuditLogService audit = mock(AuditLogService.class);
  private final ResponseCookie clearTx = ResponseCookie.from(SsoTransactionCookie.NAME, "").build();

  private SsoLoginService service;

  @BeforeEach
  void setUp() {
    service =
        new SsoLoginService(props, txCookie, oidc, resolver, authService, refreshCookies, audit);
    when(txCookie.expired()).thenReturn(clearTx);
    when(txCookie.read("raw"))
        .thenReturn(
            Optional.of(
                new SsoTransactionCookie.Tx("st", "nonce", "verifier", "/", Instant.now())));
  }

  @Test
  void unexpectedRuntimeException_redirectsRetryAndClearsTx() {
    when(oidc.exchange("code", "verifier")).thenThrow(new IllegalStateException("boom"));

    var r =
        service.callback(new SsoLoginService.CallbackParams("code", "st", null, null, null), "raw");

    assertThat(r.location()).isEqualTo("/login?sso_error=retry");
    assertThat(r.cookies()).containsExactly(clearTx);
  }

  @Test
  void stateInvalid_isNotAudited() {
    var r =
        service.callback(
            new SsoLoginService.CallbackParams("code", "forged", null, null, null), "raw");

    assertThat(r.location()).isEqualTo("/login?sso_error=retry");
    verifyNoInteractions(audit);
    verifyNoInteractions(oidc);
  }

  @Test
  void missingTxCookie_isNotAudited() {
    var r =
        service.callback(new SsoLoginService.CallbackParams("code", "st", null, null, null), null);

    assertThat(r.location()).isEqualTo("/login?sso_error=retry");
    verifyNoInteractions(audit);
  }

  @Test
  void idpErrorReason_isSanitizedForAudit() {
    String hostile = "access_denied\r\nFAKE LOG LINE" + "x".repeat(500);

    service.callback(new SsoLoginService.CallbackParams(null, "st", hostile, null, null), "raw");

    ArgumentCaptor<String> description = ArgumentCaptor.forClass(String.class);
    ArgumentCaptor<String> reason = ArgumentCaptor.forClass(String.class);
    verify(audit)
        .log(
            isNull(),
            anyString(),
            eq("LOGIN_FAILED"),
            anyString(),
            isNull(),
            description.capture(),
            isNull(),
            isNull(),
            eq("FAILURE"),
            reason.capture(),
            any());
    assertThat(reason.getValue()).doesNotContain("\r", "\n").hasSizeLessThanOrEqualTo(200);
    assertThat(description.getValue()).doesNotContain("\r", "\n");
  }
}

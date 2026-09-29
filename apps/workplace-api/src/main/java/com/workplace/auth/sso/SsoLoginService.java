package com.workplace.auth.sso;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.service.AuthService;
import com.workplace.auth.web.RefreshTokenCookies;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseCookie;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

/**
 * SSO 로그인 오케스트레이션(WP-48). callback 처리 순서 자체가 규칙이다:
 *
 * <ol>
 *   <li>SSO 사용 가능 여부 → 관리자 동의 복귀(admin_consent) 분기 — state 쿠키가 없으므로 state 검사보다 먼저
 *   <li>트랜잭션 쿠키 서명·만료·state 일치 — 통과 전에는 Microsoft 를 호출하지 않는다(위조 code 로 IdP 를 두드리는 경로 차단)
 *   <li>IdP 오류 분류 → 토큰 교환 → id_token 검증 → 사용자 결정 → 세션 발급
 * </ol>
 *
 * 모든 결과는 웹으로의 302 이고 트랜잭션 쿠키는 항상 지운다. 실패 상세는 감사 로그에만 남긴다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SsoLoginService {

  /** 실패 감사의 username — audit_log.username 이 NOT NULL 이고 실패 시점엔 사용자가 확정되지 않는다. */
  private static final String AUDIT_USERNAME = "sso";

  /** Microsoft 왕복 전 state/쿠키 검증 실패 사유 — 감사하지 않는다. */
  private static final String STATE_INVALID = "state_invalid";

  /** 로그/감사 사유 최대 길이. */
  private static final int MAX_REASON_LENGTH = 200;

  private final SsoProperties props;
  private final SsoTransactionCookie txCookie;
  private final M365OidcClient oidc;
  private final SsoUserResolver resolver;
  private final AuthService authService;
  private final RefreshTokenCookies refreshCookies;
  private final AuditLogService auditLogService;

  /** 302 대상과 함께 설정할 쿠키. */
  public record Redirect(String location, List<ResponseCookie> cookies) {}

  /** Microsoft 가 callback 에 붙여 보내는 파라미터. */
  public record CallbackParams(
      String code, String state, String error, String errorDescription, String adminConsent) {}

  /** 트랜잭션 쿠키(state/nonce/PKCE)를 심고 Microsoft 인가 URL 로 보낸다. SSO 불가 시 로그인 화면으로. */
  public Redirect start(String returnTo) {
    if (!props.isAvailable()) {
      return new Redirect(errorPath(SsoLoginException.UNAVAILABLE), List.of());
    }
    SsoTransactionCookie.Tx tx = txCookie.create(returnTo);
    String url =
        oidc.authorizationUrl(
            tx.state(), tx.nonce(), SsoTransactionCookie.challenge(tx.codeVerifier()));
    return new Redirect(url, List.of(txCookie.toCookie(tx)));
  }

  /** Microsoft 복귀 처리. 성공 시 refresh 쿠키 발급, 실패 시 사유 코드만 웹에 전달하고 상세는 감사 로그로. */
  public Redirect callback(CallbackParams p, String rawTxCookie) {
    ResponseCookie clearTx = txCookie.expired();
    if (!props.isAvailable()) {
      return new Redirect(errorPath(SsoLoginException.UNAVAILABLE), List.of(clearTx));
    }
    if (p.adminConsent() != null) {
      String location =
          "True".equalsIgnoreCase(p.adminConsent()) && p.error() == null
              ? "/login?sso_notice=consented"
              : errorPath(SsoLoginException.CONSENT);
      return new Redirect(location, List.of(clearTx));
    }
    if (p.state() == null && p.error() != null) {
      // 관리자 동의 화면에서 취소/거부하면 Microsoft 는 admin_consent·state 없이 error 만 붙여 복귀시킨다
      // (동의 URL 은 state 를 싣지 않음). 정상 로그인 callback 은 항상 state 를 가지므로 state 검사는 약해지지 않는다.
      auditFailure(SsoLoginException.CONSENT, "admin_consent_denied: " + sanitize(p.error()));
      return new Redirect(errorPath(SsoLoginException.CONSENT), List.of(clearTx));
    }
    try {
      Optional<SsoTransactionCookie.Tx> tx =
          rawTxCookie == null ? Optional.empty() : txCookie.read(rawTxCookie);
      if (tx.isEmpty() || p.state() == null || !p.state().equals(tx.get().state())) {
        throw new SsoLoginException(SsoLoginException.RETRY, STATE_INVALID);
      }
      if (p.error() != null) {
        throw new SsoLoginException(
            OidcErrorClassifier.fromAuthorizeError(p.error(), p.errorDescription()),
            "idp_error: " + p.error());
      }
      if (p.code() == null || p.code().isBlank()) {
        throw new SsoLoginException(SsoLoginException.RETRY, "no_code");
      }
      String idToken = oidc.exchange(p.code(), tx.get().codeVerifier());
      Jwt jwt = oidc.decode(idToken, tx.get().nonce());
      SsoUserResolver.Resolution r = resolver.resolve(jwt);
      if (r.newlyLinked()) {
        auditLogService.log(
            r.user().id(),
            r.user().username(),
            "USER_SSO_LINK",
            "auth",
            String.valueOf(r.user().id()),
            "SSO 계정 연결",
            null,
            null,
            "SUCCESS",
            null,
            Map.of("provider", "M365", "tid", r.tid()));
      }
      AuthService.SsoSession session = authService.issueSsoSession(r.user());
      String location =
          "/login/sso/complete?returnTo="
              + URLEncoder.encode(tx.get().returnTo(), StandardCharsets.UTF_8);
      return new Redirect(location, List.of(clearTx, refreshCookies.issue(session.refreshToken())));
    } catch (SsoLoginException e) {
      // 사유에는 IdP 가 보낸 error 파라미터 등 외부 입력이 섞인다 — 로그/감사 주입을 막기 위해 개행 제거·길이 제한.
      String reason = sanitize(e.reason());
      if (STATE_INVALID.equals(reason)) {
        // state 불일치/쿠키 없음은 Microsoft 왕복 전 단계라 누구나 무한히 유발할 수 있다 — 감사 테이블을 채우지 않게 로그만 남긴다.
        log.info("SSO 로그인 실패 code={} reason={}", e.webCode(), reason);
        return new Redirect(errorPath(e.webCode()), List.of(clearTx));
      }
      auditFailure(e.webCode(), reason);
      log.info("SSO 로그인 실패 code={} reason={}", e.webCode(), reason);
      return new Redirect(errorPath(e.webCode()), List.of(clearTx));
    } catch (RuntimeException e) {
      // 예상 못 한 예외(DB·JSON 등)도 사용자에겐 재시도 안내로 돌려보내고 트랜잭션 쿠키를 지운다.
      // 메시지·스택에 토큰/코드가 섞일 수 있어 예외 타입만 남긴다.
      log.warn("SSO 로그인 처리 중 예외 type={}", e.getClass().getName());
      return new Redirect(errorPath(SsoLoginException.RETRY), List.of(clearTx));
    }
  }

  /**
   * 실패 감사 기록. 감사 저장소 오류(DB 등)가 callback 을 500 으로 깨뜨려 "항상 302 + 트랜잭션 쿠키 삭제" 계약을 어기지 않도록 삼키고 경고만 남긴다.
   * 메시지에 민감 정보가 섞일 수 있어 예외 타입만 기록한다.
   */
  private void auditFailure(String webCode, String reason) {
    try {
      auditLogService.log(
          null,
          AUDIT_USERNAME,
          "LOGIN_FAILED",
          "auth",
          null,
          "SSO 로그인 실패: " + reason,
          null,
          null,
          "FAILURE",
          reason,
          Map.of("method", "sso", "code", webCode));
    } catch (RuntimeException e) {
      log.warn("SSO 실패 감사 기록 실패 type={}", e.getClass().getName());
    }
  }

  /** 로그/감사에 넣을 외부 유래 문자열 정제 — CR/LF 제거, 최대 {@value #MAX_REASON_LENGTH}자. */
  private static String sanitize(String value) {
    if (value == null) {
      return null;
    }
    String flat = value.replace('\r', ' ').replace('\n', ' ');
    return flat.length() > MAX_REASON_LENGTH ? flat.substring(0, MAX_REASON_LENGTH) : flat;
  }

  private static String errorPath(String code) {
    return "/login?sso_error=" + code;
  }
}

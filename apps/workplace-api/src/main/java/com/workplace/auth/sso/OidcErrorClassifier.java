package com.workplace.auth.sso;

/**
 * Entra 인가/토큰 오류를 웹 코드로 분류한다(WP-48).
 *
 * <p>관리자 동의가 필요한 경우(AADSTS65001 미동의, AADSTS90094 관리자 승인 필요, consent_required)만 consent 로 보내 "조직 관리자
 * 승인" 안내를 띄운다. 사용자가 동의 화면에서 취소(AADSTS65004)하거나 코드 없는 access_denied 는 retry 다. 시크릿 만료·무효는 운영 설정 문제라
 * 웹에는 retry 로 보이되 {@link #isConfigError} 로 ERROR 로그를 남긴다.
 */
final class OidcErrorClassifier {

  private OidcErrorClassifier() {}

  static String fromAuthorizeError(String error, String description) {
    if ("consent_required".equals(error) || needsAdminConsent(description)) {
      return SsoLoginException.CONSENT;
    }
    return SsoLoginException.RETRY;
  }

  static String fromTokenError(String body) {
    return needsAdminConsent(body) ? SsoLoginException.CONSENT : SsoLoginException.RETRY;
  }

  static boolean isConfigError(String body) {
    String b = body == null ? "" : body;
    return b.contains("AADSTS7000222")
        || b.contains("AADSTS7000215")
        || b.contains("\"invalid_client\"");
  }

  private static boolean needsAdminConsent(String text) {
    return text != null && (text.contains("AADSTS65001") || text.contains("AADSTS90094"));
  }
}

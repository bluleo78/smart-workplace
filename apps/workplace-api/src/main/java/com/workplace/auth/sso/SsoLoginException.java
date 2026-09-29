package com.workplace.auth.sso;

/**
 * SSO 로그인 실패(WP-48). webCode 는 웹 배너용 코드(denied|consent|retry|unavailable)이고 reason 은 감사 로그에만 남기는 상세
 * 사유다 — 사용자에게 계정 존재 여부 같은 정보를 흘리지 않기 위해 둘을 분리한다.
 */
public class SsoLoginException extends RuntimeException {

  public static final String DENIED = "denied";
  public static final String CONSENT = "consent";
  public static final String RETRY = "retry";
  public static final String UNAVAILABLE = "unavailable";

  private final String webCode;
  private final String reason;

  public SsoLoginException(String webCode, String reason) {
    super(webCode + ": " + reason);
    this.webCode = webCode;
    this.reason = reason;
  }

  public String webCode() {
    return webCode;
  }

  public String reason() {
    return reason;
  }
}

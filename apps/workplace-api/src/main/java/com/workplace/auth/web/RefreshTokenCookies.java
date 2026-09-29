package com.workplace.auth.web;

import com.workplace.global.security.JwtProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * refresh 토큰 쿠키 생성/삭제(WP-48 에서 추출). 비밀번호 로그인(AuthController)과 SSO 콜백(SsoAuthController)이 같은
 * 이름·경로·속성을 써야 브라우저가 같은 쿠키로 본다.
 */
@Component
public class RefreshTokenCookies {

  public static final String NAME = "refreshToken";
  public static final String PATH = "/api/v1/auth";

  private final JwtProperties jwtProperties;
  private final boolean secure;

  public RefreshTokenCookies(
      JwtProperties jwtProperties, @Value("${app.cookie.secure:true}") boolean secure) {
    this.jwtProperties = jwtProperties;
    this.secure = secure;
  }

  public ResponseCookie issue(String refreshToken) {
    return ResponseCookie.from(NAME, refreshToken)
        .httpOnly(true)
        .secure(secure)
        .sameSite("Lax")
        .path(PATH)
        .maxAge(jwtProperties.refreshExpiration() / 1000)
        .build();
  }

  public ResponseCookie clear() {
    return ResponseCookie.from(NAME, "")
        .httpOnly(true)
        .secure(secure)
        .sameSite("Lax")
        .path(PATH)
        .maxAge(0)
        .build();
  }
}

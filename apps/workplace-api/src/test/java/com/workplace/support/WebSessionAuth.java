package com.workplace.support;

import com.workplace.global.security.AuthDetails;
import java.util.Collection;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;

/**
 * MockMvc 용 웹 로그인 세션 인증 — 브라우저 JWT 처럼 {@link AuthDetails} 를 싣는다. 웹 세션 전용 관리 동작(WP-845 {@code
 * RequireWebSession})을 부르는 테스트가 쓴다. details 가 없는 토큰은 PAT·AI 키 요청으로 보여 403 이 난다.
 */
public final class WebSessionAuth {

  private WebSessionAuth() {}

  public static UsernamePasswordAuthenticationToken of(
      Object principal, Collection<? extends GrantedAuthority> authorities) {
    var token = new UsernamePasswordAuthenticationToken(principal, "n/a", authorities);
    token.setDetails(new AuthDetails(AuthDetails.PASSWORD));
    return token;
  }
}

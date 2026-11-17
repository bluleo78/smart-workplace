package com.workplace.auth.oauth.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * PKCE(RFC 7636) S256 — 순수 함수(WP-1685). 토큰 엔드포인트가 code 교환 때 {@code code_verifier} 가 인가 요청의 {@code
 * code_challenge} 와 맞는지 보고, 인가 요청 검증이 code_challenge 형식을 본다. plain 방식은 받지 않는다(OAuth 2.1). S256 계산은
 * 이 한 곳에 두고 SSO 로그인(SsoTransactionCookie)도 이걸 쓴다.
 */
public final class Pkce {

  /**
   * RFC 7636 §4.1 code_verifier·§4.2 code_challenge 문법 — 둘 다 unreserved 문자 43~128자(S256 challenge 는
   * base64url 43자).
   */
  private static final Pattern SHAPE = Pattern.compile("^[A-Za-z0-9\\-._~]{43,128}$");

  private Pkce() {}

  /** code_verifier·code_challenge 문법(unreserved 문자 43~128자)에 맞는지. null 이면 false. */
  public static boolean isValidShape(String value) {
    return value != null && SHAPE.matcher(value).matches();
  }

  /**
   * {@code BASE64URL(SHA256(ASCII(verifier))) == challenge} 인지. verifier 문법이 틀리면 해시를 보지 않고 false.
   * 비교는 상수 시간({@link MessageDigest#isEqual})이라 응답 시간으로 challenge 를 한 글자씩 맞춰 볼 수 없다.
   *
   * @param verifier 클라이언트가 토큰 요청에 실은 code_verifier
   * @param challenge 인가 요청 때 저장한 code_challenge
   */
  public static boolean verifyS256(String verifier, String challenge) {
    if (challenge == null || !isValidShape(verifier)) {
      return false;
    }
    byte[] expected = s256(verifier).getBytes(StandardCharsets.US_ASCII);
    byte[] actual = challenge.getBytes(StandardCharsets.US_ASCII);
    return MessageDigest.isEqual(expected, actual);
  }

  /**
   * verifier 의 S256 challenge — BASE64URL(SHA-256(ASCII(verifier))), 패딩 없음. verifier 문법은 보지 않는다.
   */
  public static String s256(String verifier) {
    try {
      byte[] hash =
          MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
    } catch (NoSuchAlgorithmException e) {
      // 모든 JVM 이 SHA-256 을 제공한다(Java 표준 요구 알고리즘) — 여기 오면 런타임이 망가진 것.
      throw new IllegalStateException("SHA-256 을 쓸 수 없습니다", e);
    }
  }
}

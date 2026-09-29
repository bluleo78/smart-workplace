package com.workplace.auth.sso;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtProperties;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Optional;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * 인가 요청과 콜백 사이의 OIDC 트랜잭션(state·nonce·PKCE verifier·returnTo)을 서버 저장 없이 쿠키에 싣는다(WP-48).
 *
 * <p>값은 {@code base64url(json).base64url(hmac)} 이고 서명은 인코딩된 페이로드 문자열 위에 건다. 서버에 상태를 두지 않으므로 인스턴스가
 * 여러 개여도 동작한다(기존 인메모리 OAuthStateStore 와 다른 점). HMAC 키는 JWT 시크릿에서 라벨로 도메인 분리해 파생한다 — JWT 서명
 * 키를 그대로 쓰면 한쪽 서명이 다른 쪽 검증을 통과할 여지가 생긴다.
 */
@Component
public class SsoTransactionCookie {

  public static final String NAME = "swp_sso_tx";
  public static final String PATH = "/api/v1/auth/sso";

  private static final Duration TTL = Duration.ofMinutes(10);
  private static final String HMAC = "HmacSHA256";
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder B64D = Base64.getUrlDecoder();

  /** 한 번의 SSO 로그인 시도 상태. */
  public record Tx(
      String state, String nonce, String codeVerifier, String returnTo, Instant expiresAt) {}

  // 직렬화 형태 — expiresAt 은 epoch seconds 로 둬 Jackson 시간 모듈 설정에 기대지 않는다.
  private record Wire(String s, String n, String v, String r, long e) {}

  private final byte[] key;
  private final boolean secure;
  private final Clock clock;

  @Autowired
  public SsoTransactionCookie(JwtProperties jwt, @Value("${app.cookie.secure:true}") boolean secure) {
    this(jwt, secure, Clock.systemUTC());
  }

  /** 테스트용 — 시계를 고정한다. */
  SsoTransactionCookie(JwtProperties jwt, boolean secure, Clock clock) {
    this.key = hmac(jwt.secret().getBytes(StandardCharsets.UTF_8), "swp-sso-tx-v1");
    this.secure = secure;
    this.clock = clock;
  }

  /** 새 트랜잭션 — state/nonce/verifier 는 32바이트 난수(base64url 43자, PKCE 최소 길이 충족). */
  public Tx create(String returnTo) {
    Instant expiresAt = clock.instant().plus(TTL).truncatedTo(ChronoUnit.SECONDS);
    return new Tx(random(), random(), random(), ReturnToSanitizer.sanitize(returnTo), expiresAt);
  }

  public ResponseCookie toCookie(Tx tx) {
    String payload;
    try {
      payload =
          B64.encodeToString(
              JSON.writeValueAsBytes(
                  new Wire(
                      tx.state(), tx.nonce(), tx.codeVerifier(), tx.returnTo(),
                      tx.expiresAt().getEpochSecond())));
    } catch (Exception e) {
      throw new IllegalStateException("SSO 트랜잭션 직렬화 실패", e);
    }
    return base(payload + "." + B64.encodeToString(hmac(key, payload))).maxAge(TTL).build();
  }

  /** 서명이 맞고 만료 전일 때만 값을 준다. 형식 오류를 포함한 모든 실패는 empty — 콜백은 "트랜잭션 없음"으로 다룬다. */
  public Optional<Tx> read(String cookieValue) {
    try {
      int dot = cookieValue.indexOf('.');
      if (dot <= 0) return Optional.empty();
      String payload = cookieValue.substring(0, dot);
      byte[] sig = B64D.decode(cookieValue.substring(dot + 1));
      if (!MessageDigest.isEqual(sig, hmac(key, payload))) return Optional.empty();
      Wire w = JSON.readValue(B64D.decode(payload), Wire.class);
      Instant expiresAt = Instant.ofEpochSecond(w.e());
      if (expiresAt.isBefore(clock.instant())) return Optional.empty();
      return Optional.of(new Tx(w.s(), w.n(), w.v(), w.r(), expiresAt));
    } catch (Exception e) {
      return Optional.empty();
    }
  }

  /** 콜백 뒤 지우는 쿠키 — 경로가 같아야 브라우저가 같은 쿠키로 본다. */
  public ResponseCookie expired() {
    return base("").maxAge(Duration.ZERO).build();
  }

  /** PKCE S256 challenge — base64url(SHA-256(verifier)). */
  public static String challenge(String verifier) {
    try {
      return B64.encodeToString(
          MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  private ResponseCookie.ResponseCookieBuilder base(String value) {
    return ResponseCookie.from(NAME, value).httpOnly(true).secure(secure).sameSite("Lax").path(PATH);
  }

  private static String random() {
    byte[] b = new byte[32];
    RANDOM.nextBytes(b);
    return B64.encodeToString(b);
  }

  private static byte[] hmac(byte[] key, String data) {
    try {
      Mac mac = Mac.getInstance(HMAC);
      mac.init(new SecretKeySpec(key, HMAC));
      return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }
}

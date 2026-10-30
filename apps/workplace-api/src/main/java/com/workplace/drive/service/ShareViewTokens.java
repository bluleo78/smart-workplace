package com.workplace.drive.service;

import com.workplace.global.security.JwtProperties;
import com.workplace.global.util.CapabilityTokens;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 공유 링크 열람 토큰(WP-1227) — 비밀번호 링크를 한 번 연 뒤 미리보기·원본·다운로드를 비밀번호 없이 이어 받게 하는 짧은 서명 값.
 *
 * <p>형식은 {@code base64url(payload).base64url(HMAC-SHA256(payload 문자열))}, payload 는 {@code
 * tokenHash|expEpochSec|pwFingerprint}. 서버에 상태를 두지 않아 인스턴스가 여러 개여도 동작한다(SsoTransactionCookie 와 같은
 * 방식).
 *
 * <ul>
 *   <li>tokenHash — 이 링크에서 받은 토큰만 이 링크에 쓰이게 한다(다른 링크 토큰 재사용 차단).
 *   <li>pwFingerprint — sha256(password_hash) 앞 16hex. 비밀번호가 바뀌면 기존 토큰이 저절로 무효가 된다.
 *   <li>키 — JWT 시크릿에서 라벨로 도메인 분리해 파생한다. JWT 서명 키를 그대로 쓰면 한쪽 서명이 다른 쪽 검증을 통과할 여지가 생긴다.
 * </ul>
 *
 * <p>토큰은 링크 가드(없음·만료·폐기·사내 범위)를 대신하지 않는다 — 호출부가 매 요청 가드를 그대로 거친 뒤 비밀번호 단계만 이것으로 건너뛴다.
 */
@Component
public class ShareViewTokens {

  /** 열람 토큰 유효 시간 — 미리보기를 읽는 동안은 충분하고, 새어 나가도 오래 쓰이지 않게 짧게 둔다. */
  static final Duration TTL = Duration.ofMinutes(30);

  private static final String HMAC = "HmacSHA256";
  private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder B64D = Base64.getUrlDecoder();

  private final byte[] key;
  private final Clock clock;

  @Autowired
  public ShareViewTokens(JwtProperties jwt) {
    this(jwt, Clock.systemUTC());
  }

  /** 테스트용 — 시계를 고정해 만료된 토큰을 만든다. */
  ShareViewTokens(JwtProperties jwt, Clock clock) {
    this.key = hmac(jwt.secret().getBytes(StandardCharsets.UTF_8), "swp-share-view-v1");
    this.clock = clock;
  }

  /** 발급 결과 — 응답 본문 {@code {viewToken, expiresAt}} 그대로. */
  public record ViewToken(String viewToken, Instant expiresAt) {}

  /** 링크(tokenHash)와 현재 비밀번호 해시에 묶인 열람 토큰을 발급한다. */
  public ViewToken issue(String tokenHash, String passwordHash) {
    Instant expiresAt = clock.instant().plus(TTL).truncatedTo(ChronoUnit.SECONDS);
    String payload =
        B64.encodeToString(
            (tokenHash + "|" + expiresAt.getEpochSecond() + "|" + fingerprint(passwordHash))
                .getBytes(StandardCharsets.UTF_8));
    return new ViewToken(payload + "." + B64.encodeToString(hmac(key, payload)), expiresAt);
  }

  /**
   * 서명이 맞고, 만료 전이며, 같은 링크·같은 비밀번호 해시로 발급된 토큰일 때만 true. 형식 오류를 포함한 모든 실패는 false(호출부가 401 또는 「비밀번호
   * 필요」로 다룬다). 서명 비교는 상수 시간({@link MessageDigest#isEqual})이다.
   */
  public boolean isValid(String viewToken, String tokenHash, String passwordHash) {
    if (viewToken == null || viewToken.isBlank()) return false;
    try {
      int dot = viewToken.indexOf('.');
      if (dot <= 0) return false;
      String payload = viewToken.substring(0, dot);
      byte[] sig = B64D.decode(viewToken.substring(dot + 1));
      if (!MessageDigest.isEqual(sig, hmac(key, payload))) return false;
      String[] parts = new String(B64D.decode(payload), StandardCharsets.UTF_8).split("\\|", -1);
      if (parts.length != 3) return false;
      // 링크·비밀번호 지문 비교도 상수 시간으로 — 서명이 맞은 뒤라 실익은 작지만 비교 방식을 한 가지로 둔다.
      if (!constantEquals(parts[0], tokenHash)) return false;
      if (!constantEquals(parts[2], fingerprint(passwordHash))) return false;
      return Instant.ofEpochSecond(Long.parseLong(parts[1])).isAfter(clock.instant());
    } catch (RuntimeException e) {
      return false;
    }
  }

  /** 비밀번호 해시 지문 — sha256 앞 16hex. 비밀번호 없는 링크는 빈 문자열. */
  private static String fingerprint(String passwordHash) {
    return passwordHash == null ? "" : CapabilityTokens.sha256Hex(passwordHash).substring(0, 16);
  }

  private static boolean constantEquals(String a, String b) {
    return b != null
        && MessageDigest.isEqual(
            a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
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

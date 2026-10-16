package com.workplace.global.util;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;

/**
 * 능력 토큰(capability token) 도우미 — 로그인 없이 쓰는 일회용·공유 링크의 비밀 토큰을 만들고, DB 에 남길 SHA-256 해시를 계산한다.
 *
 * <p>드라이브 공유 링크(sl_)·전송 링크(dl_·ul_)와 스테이징 업로드 링크(WP-421)가 같은 방식을 쓰도록 drive 에서 뽑아 왔다: 토큰은 접두사 +
 * base62(32 랜덤 바이트), DB 에는 평문 대신 SHA-256 hex 만 둔다. 상태가 없어 정적 메서드로 둔다.
 */
public final class CapabilityTokens {

  private static final String BASE62 =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  /** SecureRandom 은 스레드 안전 — 호출마다 새로 만들지 않고 하나를 공유한다. */
  private static final SecureRandom SECURE_RANDOM = new SecureRandom();

  private CapabilityTokens() {}

  /**
   * 접두사 + base62(32 랜덤 바이트). 32바이트(256비트) 엔트로피라 추측할 수 없다. 앞자리 0 은 생략된다(길이는 대개 43자 안팎).
   *
   * @param prefix 토큰 종류를 드러내는 접두사(예: {@code dl_})
   */
  public static String generate(String prefix) {
    byte[] bytes = new byte[32];
    SECURE_RANDOM.nextBytes(bytes);
    BigInteger n = new BigInteger(1, bytes);
    BigInteger base = BigInteger.valueOf(62);
    StringBuilder sb = new StringBuilder();
    while (n.signum() > 0) {
      BigInteger[] qr = n.divideAndRemainder(base);
      sb.insert(0, BASE62.charAt(qr[1].intValue()));
      n = qr[0];
    }
    return prefix + (sb.length() > 0 ? sb.toString() : "0");
  }

  /** UTF-8 바이트의 SHA-256 소문자 hex(64자) — 토큰 저장·조회 키. 평문 토큰은 DB 에 남기지 않는다. */
  public static String sha256Hex(String plaintext) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] hash = md.digest(plaintext.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 미지원", e);
    }
  }

  /**
   * 공개 링크의 기준 주소를 정리한다 — 앞뒤 공백과 끝 슬래시를 떼어 {@code 기준주소 + /api/v1/public/…} 로 이을 때 슬래시가 겹치지 않게 한다.
   * null 은 빈 문자열.
   */
  public static String normalizeBaseUrl(String url) {
    String s = url == null ? "" : url.trim();
    while (s.endsWith("/")) {
      s = s.substring(0, s.length() - 1);
    }
    return s;
  }
}

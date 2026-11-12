package com.workplace.global.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Optional;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 서버 상태 없는 짧은 토큰의 공용 암호 도구 — 라벨로 도메인 분리한 키, HMAC 서명·상수 시간 검증, AES-GCM 봉인(WP-1227 공유 열람 토큰·WP-1532
 * 재생 토큰이 같이 쓴다). 토큰마다 보안 코드를 따로 두면 한쪽만 고쳐지거나 비교가 상수 시간이 아닌 채로 남기 쉬워 한 곳에 모았다.
 *
 * <p>키 — 루트 시크릿(JWT 시크릿)을 라벨로 HMAC 해 파생한다. JWT 서명 키를 그대로 쓰면 한쪽 서명이 다른 쪽 검증을 통과할 여지가 생기고, 토큰 종류끼리도
 * 라벨이 달라 서로의 서명·봉인을 받아 주지 않는다.
 *
 * <ul>
 *   <li>서명({@link #sign}·{@link #verifySigned}) — {@code payload.base64url(HMAC-SHA256(macKey,
 *       payload 문자열))}. macKey = HMAC-SHA256(root, label). 공유 열람 토큰의 기존 형식과 바이트 단위로 같다(이미 발급한 토큰이
 *       그대로 통한다).
 *   <li>봉인({@link #seal}·{@link #open}) — {@code base64url(iv(12) ‖ AES-256-GCM 암호문+태그)}, encKey =
 *       HMAC-SHA256(root, label + ":enc"), AAD = 라벨. 내용이 보이지 않고(내부 id 노출 없음) GCM 태그가 변조를 막는다. URL
 *       경로에 그대로 쓸 수 있게 base64url(패딩 없음)이다 — 앱 공용 {@link EncryptionService} 출력은 표준 Base64·{@code
 *       iv:ct} 라 경로 조각이 될 수 없고 설정값 암호화 키를 공유하게 된다.
 * </ul>
 */
public final class LabeledTokenCrypto {

  private static final String HMAC = "HmacSHA256";
  private static final String AES_GCM = "AES/GCM/NoPadding";
  private static final int IV_LENGTH = 12;
  private static final int TAG_BITS = 128;
  private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder B64D = Base64.getUrlDecoder();
  private static final SecureRandom RANDOM = new SecureRandom();

  private final byte[] macKey;
  private final SecretKeySpec encKey;
  private final byte[] aad;

  private LabeledTokenCrypto(byte[] root, String label) {
    this.macKey = hmac(root, label);
    this.encKey = new SecretKeySpec(hmac(root, label + ":enc"), "AES");
    this.aad = label.getBytes(StandardCharsets.UTF_8);
  }

  /** 루트 시크릿 문자열(UTF-8)과 라벨로 키를 파생한다. 라벨은 토큰 종류마다 달라야 한다. */
  public static LabeledTokenCrypto derive(String rootSecret, String label) {
    return new LabeledTokenCrypto(rootSecret.getBytes(StandardCharsets.UTF_8), label);
  }

  /** 서명된 토큰 — 호출부가 만든 payload(보통 base64url 문자열) 뒤에 {@code .서명}을 붙인다. */
  public String sign(String payload) {
    return payload + "." + B64.encodeToString(hmac(macKey, payload));
  }

  /** 서명이 맞으면 payload 부분, 아니면(형식 오류 포함) 빈 값. 비교는 상수 시간이다. */
  public Optional<String> verifySigned(String token) {
    if (token == null) return Optional.empty();
    try {
      int dot = token.indexOf('.');
      if (dot <= 0) return Optional.empty();
      String payload = token.substring(0, dot);
      byte[] sig = B64D.decode(token.substring(dot + 1));
      return MessageDigest.isEqual(sig, hmac(macKey, payload))
          ? Optional.of(payload)
          : Optional.empty();
    } catch (RuntimeException e) {
      return Optional.empty();
    }
  }

  /** 평문을 봉인한다 — 호출마다 새 IV 라 같은 평문도 다른 토큰이 된다. */
  public String seal(String plaintext) {
    try {
      byte[] iv = new byte[IV_LENGTH];
      RANDOM.nextBytes(iv);
      Cipher c = Cipher.getInstance(AES_GCM);
      c.init(Cipher.ENCRYPT_MODE, encKey, new GCMParameterSpec(TAG_BITS, iv));
      c.updateAAD(aad);
      byte[] ct = c.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
      return B64.encodeToString(ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct).array());
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  /** 봉인을 연다. 형식 오류·태그 불일치(변조·다른 라벨·다른 키)는 모두 빈 값. */
  public Optional<String> open(String token) {
    if (token == null || token.isBlank()) return Optional.empty();
    try {
      byte[] all = B64D.decode(token);
      if (all.length <= IV_LENGTH + TAG_BITS / 8) return Optional.empty();
      Cipher c = Cipher.getInstance(AES_GCM);
      c.init(Cipher.DECRYPT_MODE, encKey, new GCMParameterSpec(TAG_BITS, all, 0, IV_LENGTH));
      c.updateAAD(aad);
      byte[] pt = c.doFinal(all, IV_LENGTH, all.length - IV_LENGTH);
      return Optional.of(new String(pt, StandardCharsets.UTF_8));
    } catch (GeneralSecurityException | RuntimeException e) {
      return Optional.empty();
    }
  }

  /** 두 문자열을 상수 시간으로 비교한다(b 가 null 이면 false). */
  public static boolean constantEquals(String a, String b) {
    return a != null
        && b != null
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

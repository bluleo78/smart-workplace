package com.workplace.notify.push;

import java.math.BigInteger;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;

/**
 * P-256(secp256r1) 키 변환 유틸. Web Push 는 공개키를 65바이트 비압축점(0x04‖X‖Y), 개인키를 32바이트 스칼라로 주고받는데 JDK 는
 * X.509/PKCS#8 객체를 쓰므로 그 사이를 변환한다. base64url 은 패딩 없는 형식(브라우저 PushSubscription.toJSON 과 동일).
 */
public final class EcKeys {

  private static final ECParameterSpec P256 = p256();

  private EcKeys() {}

  private static ECParameterSpec p256() {
    try {
      AlgorithmParameters ap = AlgorithmParameters.getInstance("EC");
      ap.init(new ECGenParameterSpec("secp256r1"));
      return ap.getParameterSpec(ECParameterSpec.class);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("P-256 파라미터 초기화 실패", e);
    }
  }

  /** 새 P-256 키쌍 생성(VAPID 키, 메시지별 임시 키). */
  public static KeyPair generate() {
    try {
      KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
      g.initialize(new ECGenParameterSpec("secp256r1"));
      return g.generateKeyPair();
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("P-256 키 생성 실패", e);
    }
  }

  /** 공개키 → 65바이트 비압축점. */
  public static byte[] encodePublic(ECPublicKey key) {
    byte[] out = new byte[65];
    out[0] = 0x04;
    System.arraycopy(fixed32(key.getW().getAffineX()), 0, out, 1, 32);
    System.arraycopy(fixed32(key.getW().getAffineY()), 0, out, 33, 32);
    return out;
  }

  /** 65바이트 비압축점 → 공개키. 형식이 다르면 IllegalArgumentException(400 으로 매핑). */
  public static ECPublicKey decodePublic(byte[] raw) {
    if (raw == null || raw.length != 65 || raw[0] != 0x04) {
      throw new IllegalArgumentException("P-256 공개키는 65바이트 비압축점이어야 합니다");
    }
    BigInteger x = new BigInteger(1, Arrays.copyOfRange(raw, 1, 33));
    BigInteger y = new BigInteger(1, Arrays.copyOfRange(raw, 33, 65));
    try {
      return (ECPublicKey)
          KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(x, y), P256));
    } catch (GeneralSecurityException e) {
      throw new IllegalArgumentException("유효하지 않은 P-256 공개키", e);
    }
  }

  /** 개인키 → 32바이트 스칼라. */
  public static byte[] encodePrivate(ECPrivateKey key) {
    return fixed32(key.getS());
  }

  /** 32바이트 스칼라 → 개인키. */
  public static ECPrivateKey decodePrivate(byte[] d) {
    if (d == null || d.length != 32) {
      throw new IllegalArgumentException("P-256 개인키는 32바이트여야 합니다");
    }
    try {
      return (ECPrivateKey)
          KeyFactory.getInstance("EC")
              .generatePrivate(new ECPrivateKeySpec(new BigInteger(1, d), P256));
    } catch (GeneralSecurityException e) {
      throw new IllegalArgumentException("유효하지 않은 P-256 개인키", e);
    }
  }

  /** raw 공개키 + raw 개인키 → KeyPair. */
  public static KeyPair fromRaw(byte[] pub65, byte[] d32) {
    return new KeyPair(decodePublic(pub65), decodePrivate(d32));
  }

  /** base64url 디코드(패딩 유무 모두 허용). 잘못된 문자면 IllegalArgumentException. */
  public static byte[] b64d(String s) {
    return Base64.getUrlDecoder().decode(s);
  }

  /** base64url 인코드(패딩 없음). */
  public static String b64e(byte[] b) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }

  /** BigInteger → 정확히 32바이트(앞자리 0 채움 / 부호 바이트 제거). */
  private static byte[] fixed32(BigInteger v) {
    byte[] b = v.toByteArray();
    byte[] out = new byte[32];
    int len = Math.min(b.length, 32);
    System.arraycopy(b, b.length - len, out, 32 - len, len);
    return out;
  }
}

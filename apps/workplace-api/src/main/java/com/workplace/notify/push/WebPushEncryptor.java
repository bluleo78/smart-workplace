package com.workplace.notify.push;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * RFC 8291 Web Push 메시지 암호화(Content-Encoding: aes128gcm, 단일 레코드). 메시지마다 임시 P-256 키와 16바이트 salt 를 새로
 * 만들어 브라우저 공개키와 ECDH → HKDF 로 CEK/nonce 를 유도하고 AES-128-GCM 으로 암호화한다. 푸시 서비스(Apple/Google)는 내용을 볼 수
 * 없다.
 */
@Component
public class WebPushEncryptor {

  /** 레코드 크기(rs). 단일 레코드만 쓰므로 페이로드(≤ 약 3KB)가 이 안에 들어가야 한다. */
  static final int RECORD_SIZE = 4096;

  private static final byte[] KEY_INFO_PREFIX =
      "WebPush: info\0".getBytes(StandardCharsets.US_ASCII);
  private static final byte[] CEK_INFO =
      "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII);
  private static final byte[] NONCE_INFO =
      "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII);
  private static final SecureRandom RANDOM = new SecureRandom();

  /** 운영 경로 — 임시 키·salt 를 새로 생성해 암호화. */
  public byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret) {
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    return encrypt(plaintext, uaPublic, authSecret, EcKeys.generate(), salt);
  }

  /** 결정적 경로(테스트 벡터 검증용) — 임시 키·salt 를 주입받는다. */
  byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret, KeyPair as, byte[] salt) {
    if (authSecret == null || authSecret.length != 16) {
      throw new IllegalArgumentException("auth 비밀은 16바이트여야 합니다");
    }
    try {
      ECPublicKey uaKey = EcKeys.decodePublic(uaPublic);
      byte[] asPublic = EcKeys.encodePublic((ECPublicKey) as.getPublic());

      // 1) ECDH 공유 비밀
      KeyAgreement ka = KeyAgreement.getInstance("ECDH");
      ka.init(as.getPrivate());
      ka.doPhase(uaKey, true);
      byte[] ecdh = ka.generateSecret();

      // 2) auth 비밀로 IKM 유도 (HKDF-Extract(auth, ecdh) → Expand(key_info, 32))
      byte[] prkKey = hmac(authSecret, ecdh);
      byte[] ikm = hmac(prkKey, concat(KEY_INFO_PREFIX, uaPublic, asPublic, new byte[] {1}));

      // 3) salt 로 CEK(16)·nonce(12) 유도
      byte[] prk = hmac(salt, ikm);
      byte[] cek = Arrays.copyOf(hmac(prk, concat(CEK_INFO, new byte[] {1})), 16);
      byte[] nonce = Arrays.copyOf(hmac(prk, concat(NONCE_INFO, new byte[] {1})), 12);

      // 4) 평문 + 마지막 레코드 구분자(0x02) 를 AES-128-GCM 암호화
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
      byte[] ct = c.doFinal(concat(plaintext, new byte[] {2}));

      // 5) 헤더(salt ‖ rs ‖ idlen ‖ keyid=임시 공개키) + 암호문
      ByteBuffer out = ByteBuffer.allocate(16 + 4 + 1 + asPublic.length + ct.length);
      out.put(salt).putInt(RECORD_SIZE).put((byte) asPublic.length).put(asPublic).put(ct);
      return out.array();
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("Web Push 암호화 실패", e);
    }
  }

  private static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    return mac.doFinal(data);
  }

  private static byte[] concat(byte[]... parts) {
    int n = 0;
    for (byte[] p : parts) n += p.length;
    byte[] out = new byte[n];
    int o = 0;
    for (byte[] p : parts) {
      System.arraycopy(p, 0, out, o, p.length);
      o += p.length;
    }
    return out;
  }
}

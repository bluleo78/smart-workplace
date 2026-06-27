package com.workplace.global.security;

import com.workplace.global.exception.CryptoException;
import jakarta.annotation.PostConstruct;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class EncryptionService {

  private static final String ALGORITHM = "AES/GCM/NoPadding";
  private static final int GCM_TAG_LENGTH = 128;
  private static final int IV_LENGTH = 12;

  @Value("${app.encryption.master-key}")
  private String masterKeyBase64;

  private SecretKey secretKey;

  @PostConstruct
  void init() {
    byte[] keyBytes = Base64.getDecoder().decode(masterKeyBase64);
    secretKey = new SecretKeySpec(keyBytes, "AES");
  }

  // 단위 테스트용 package-private 생성자 — Spring 컨텍스트 없이 키를 직접 주입.
  // 같은 패키지의 TestEncryptionFactory 를 통해서만 외부 테스트가 호출.
  EncryptionService(String masterKeyBase64) {
    byte[] keyBytes = Base64.getDecoder().decode(masterKeyBase64);
    this.secretKey = new SecretKeySpec(keyBytes, "AES");
  }

  // No-arg constructor for Spring (Spring uses @PostConstruct to set key)
  EncryptionService() {}

  /**
   * Encrypts plainText using AES-256-GCM with a random 12-byte IV.
   *
   * @return Base64-encoded string in the format {@code iv:ciphertext}
   */
  public String encrypt(String plainText) {
    try {
      byte[] iv = new byte[IV_LENGTH];
      new SecureRandom().nextBytes(iv);

      Cipher cipher = Cipher.getInstance(ALGORITHM);
      cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

      byte[] cipherBytes = cipher.doFinal(plainText.getBytes());

      String ivBase64 = Base64.getEncoder().encodeToString(iv);
      String cipherBase64 = Base64.getEncoder().encodeToString(cipherBytes);
      return ivBase64 + ":" + cipherBase64;
    } catch (Exception e) {
      throw new CryptoException("Encryption failed", e);
    }
  }

  /**
   * Decrypts a Base64-encoded {@code iv:ciphertext} string.
   *
   * @return the original plain text
   */
  public String decrypt(String encryptedText) {
    try {
      String[] parts = encryptedText.split(":", 2);
      if (parts.length != 2) {
        throw new IllegalArgumentException("Invalid encrypted format — expected 'iv:ciphertext'");
      }

      byte[] iv = Base64.getDecoder().decode(parts[0]);
      byte[] cipherBytes = Base64.getDecoder().decode(parts[1]);

      Cipher cipher = Cipher.getInstance(ALGORITHM);
      cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

      byte[] plainBytes = cipher.doFinal(cipherBytes);
      return new String(plainBytes);
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new CryptoException("Decryption failed", e);
    }
  }

  /**
   * 바이너리를 AES-256-GCM 으로 암호화한다. blob 마다 새 12바이트 IV 를 생성하고 {@code iv(12) ‖ ciphertext+tag} 형식의 raw
   * 바이트를 반환한다(String/Base64 경로와 달리 바이너리 낭비 없음).
   */
  public byte[] encryptBytes(byte[] plain) {
    try {
      byte[] iv = new byte[IV_LENGTH];
      new SecureRandom().nextBytes(iv);
      Cipher cipher = Cipher.getInstance(ALGORITHM);
      cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
      byte[] cipherBytes = cipher.doFinal(plain);
      byte[] out = new byte[IV_LENGTH + cipherBytes.length];
      System.arraycopy(iv, 0, out, 0, IV_LENGTH);
      System.arraycopy(cipherBytes, 0, out, IV_LENGTH, cipherBytes.length);
      return out;
    } catch (Exception e) {
      throw new CryptoException("Binary encryption failed", e);
    }
  }

  /** {@link #encryptBytes} 의 역 — 앞 12바이트를 IV 로 읽어 복호화한다. 변조 시 GCM 태그 검증 실패로 예외. */
  public byte[] decryptBytes(byte[] data) {
    try {
      if (data.length < IV_LENGTH) {
        throw new IllegalArgumentException("Invalid encrypted blob — too short");
      }
      byte[] iv = new byte[IV_LENGTH];
      System.arraycopy(data, 0, iv, 0, IV_LENGTH);
      Cipher cipher = Cipher.getInstance(ALGORITHM);
      cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
      return cipher.doFinal(data, IV_LENGTH, data.length - IV_LENGTH);
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new CryptoException("Binary decryption failed", e);
    }
  }

  /**
   * Returns {@code ****} followed by the last 4 characters of value, or {@code ****} if value has
   * fewer than 4 characters.
   */
  public String maskValue(String value) {
    if (value == null || value.length() < 4) {
      return "****";
    }
    return "****" + value.substring(value.length() - 4);
  }
}

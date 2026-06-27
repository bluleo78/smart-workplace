package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.exception.CryptoException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** EncryptionService 바이너리(byte[]) 경로 단위 테스트 — Spring 컨텍스트 없이 개발용 키로 직접 생성. */
class EncryptionServiceBytesTest {

  // 32바이트(256비트) 키의 Base64 — EncryptionService 패키지-프라이빗 생성자와 동일 형식.
  private final EncryptionService enc =
      new EncryptionService(java.util.Base64.getEncoder().encodeToString(new byte[32]));

  @Test
  void encryptBytes_decryptBytes_왕복() {
    byte[] plain = "한글과 바이너리".getBytes(StandardCharsets.UTF_8);
    byte[] cipher = enc.encryptBytes(plain);
    // 평문과 다르고, iv(12) + tag(16) 만큼 길다.
    assertThat(cipher).isNotEqualTo(plain);
    assertThat(cipher.length).isEqualTo(plain.length + 12 + 16);
    assertThat(enc.decryptBytes(cipher)).isEqualTo(plain);
  }

  @Test
  void encryptBytes_매번_다른_IV_로_다른_암호문() {
    byte[] plain = "same".getBytes(StandardCharsets.UTF_8);
    assertThat(enc.encryptBytes(plain)).isNotEqualTo(enc.encryptBytes(plain));
  }

  @Test
  void decryptBytes_변조시_실패() {
    byte[] cipher = enc.encryptBytes("payload".getBytes(StandardCharsets.UTF_8));
    cipher[cipher.length - 1] ^= 0x01; // 마지막 바이트 변조 → GCM 태그 검증 실패
    assertThatThrownBy(() -> enc.decryptBytes(cipher)).isInstanceOf(CryptoException.class);
  }
}

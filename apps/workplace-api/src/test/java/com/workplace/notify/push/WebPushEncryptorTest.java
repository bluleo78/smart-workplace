package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.interfaces.ECPublicKey;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/** RFC 8291(aes128gcm) 암호화 검증 — 공식 테스트 벡터 일치 + 수신자 관점 왕복 복호화. */
class WebPushEncryptorTest {

  // RFC 8291 Appendix A — 원문(https://www.rfc-editor.org/rfc/rfc8291.txt) 과 대조 완료.
  static final String PLAINTEXT = "When I grow up, I want to be a watermelon";
  static final String AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
  static final String AS_PUBLIC =
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  static final String UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
  static final String UA_PUBLIC =
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
  static final String SALT = "DGv6ra1nlYgDCS1FRnbzlw";
  static final String AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
  static final String EXPECTED =
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

  final WebPushEncryptor encryptor = new WebPushEncryptor();

  @Test
  void matchesRfc8291Vector() {
    KeyPair as = EcKeys.fromRaw(EcKeys.b64d(AS_PUBLIC), EcKeys.b64d(AS_PRIVATE));
    byte[] out =
        encryptor.encrypt(
            PLAINTEXT.getBytes(StandardCharsets.UTF_8),
            EcKeys.b64d(UA_PUBLIC),
            EcKeys.b64d(AUTH),
            as,
            EcKeys.b64d(SALT));
    assertThat(EcKeys.b64e(out)).isEqualTo(EXPECTED);
  }

  @Test
  void roundTrip_receiverCanDecrypt() throws Exception {
    KeyPair ua = EcKeys.generate();
    byte[] auth = new byte[16];
    new java.security.SecureRandom().nextBytes(auth);
    byte[] uaPub = EcKeys.encodePublic((ECPublicKey) ua.getPublic());
    byte[] msg = "{\"v\":1,\"title\":\"한글 제목\"}".getBytes(StandardCharsets.UTF_8);

    byte[] body = encryptor.encrypt(msg, uaPub, auth);

    assertThat(decrypt(body, ua, uaPub, auth)).isEqualTo(msg);
  }

  @Test
  void decodePublic_rejectsWrongLength() {
    assertThatThrownBy(() -> EcKeys.decodePublic(new byte[64]))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 테스트 전용 수신자(브라우저) 측 복호화 — RFC 8291 §3.4 역연산. */
  private static byte[] decrypt(byte[] body, KeyPair ua, byte[] uaPub, byte[] auth)
      throws Exception {
    ByteBuffer buf = ByteBuffer.wrap(body);
    byte[] salt = new byte[16];
    buf.get(salt);
    buf.getInt(); // rs
    int idlen = buf.get() & 0xff;
    byte[] asPub = new byte[idlen];
    buf.get(asPub);
    byte[] ct = new byte[buf.remaining()];
    buf.get(ct);

    KeyAgreement ka = KeyAgreement.getInstance("ECDH");
    ka.init(ua.getPrivate());
    ka.doPhase(EcKeys.decodePublic(asPub), true);
    byte[] ecdh = ka.generateSecret();
    byte[] prkKey = hmac(auth, ecdh);
    byte[] keyInfo =
        concat("WebPush: info\0".getBytes(StandardCharsets.US_ASCII), uaPub, asPub, new byte[] {1});
    byte[] ikm = hmac(prkKey, keyInfo);
    byte[] prk = hmac(salt, ikm);
    byte[] cek =
        Arrays.copyOf(
            hmac(
                prk,
                concat(
                    "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII),
                    new byte[] {1})),
            16);
    byte[] nonce =
        Arrays.copyOf(
            hmac(
                prk,
                concat(
                    "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII),
                    new byte[] {1})),
            12);
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
    byte[] padded = c.doFinal(ct);
    assertThat(padded[padded.length - 1]).isEqualTo((byte) 2); // 마지막 레코드 구분자
    return Arrays.copyOf(padded, padded.length - 1);
  }

  private static byte[] hmac(byte[] key, byte[] data) throws Exception {
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

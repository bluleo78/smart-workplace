package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import java.security.KeyPair;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** RFC 8292 VAPID 헤더 — 서명 검증 가능, aud=endpoint origin, sub=설정값, exp=12시간 후. */
class VapidSignerTest {

  @Test
  void authorization_isVerifiableJwtWithOriginAudience() {
    KeyPair kp = EcKeys.generate();
    ECPublicKey pub = (ECPublicKey) kp.getPublic();
    String pubB64 = EcKeys.b64e(EcKeys.encodePublic(pub));
    VapidKeys keys = new VapidKeys(pubB64, pub, (ECPrivateKey) kp.getPrivate());
    Instant now = Instant.parse("2026-09-28T00:00:00Z");
    VapidSigner signer =
        new VapidSigner(() -> keys, "mailto:ops@example.com", Clock.fixed(now, ZoneOffset.UTC));

    String header = signer.authorization("https://fcm.googleapis.com:443/fcm/send/abc?x=1");

    assertThat(header).startsWith("vapid t=").endsWith(", k=" + pubB64);
    String jwt = header.substring("vapid t=".length(), header.indexOf(", k="));
    Claims c =
        Jwts.parser()
            .verifyWith(pub)
            .clock(() -> java.util.Date.from(now))
            .build()
            .parseSignedClaims(jwt)
            .getPayload();
    assertThat(c.getAudience()).containsExactly("https://fcm.googleapis.com:443");
    assertThat(c.getSubject()).isEqualTo("mailto:ops@example.com");
    assertThat(c.getExpiration().toInstant()).isEqualTo(now.plusSeconds(12 * 3600));
  }
}

package com.workplace.agentaccount.genialogin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Collections;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** GeniaTrustStores 테스트(WP-1461) — JDK 기본 신뢰 + 추가 사설 CA 합성. */
class GeniaTrustStoresTest {

  /** 테스트용 자체 서명 인증서(CN=wp1461-test-ca). */
  private static final String PEM =
"""
-----BEGIN CERTIFICATE-----
MIIDEzCCAfugAwIBAgIUa2UQh0pTozdlj/rq8rkqsXytzFowDQYJKoZIhvcNAQEL
BQAwGTEXMBUGA1UEAwwOd3AxNDYxLXRlc3QtY2EwHhcNMjYxMTEyMDYzMjM3WhcN
MzYxMTA5MDYzMjM3WjAZMRcwFQYDVQQDDA53cDE0NjEtdGVzdC1jYTCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBALN5XYcd7HC3CRj8rin1ZgPyK7355D0W
ukDwIrtnB8eM1kxrvzcJbAJUYxot9212zVijiPNTF1GfUgPSG46Vnnb7l2lgRE0v
zi4rHuxSPpqu1MjNe7Xgx9sv7E53W9fvuigabhgI4KC3HCu9/JbkuN6fs4NwzwZi
S+NF8QUpNlx1aB4mGYF0OP344Jm4p2G5/imIA5HcBVGUtiRLlrEc1yG29dexsfeU
gG2CzM6QnphbATVJZrV8w7goVJQasFdAhVaRNwb9Phxa632wVXFPOymOd2PvwkeE
08Zbf9B2gD6R92gCHVPGH6yONnxnp0eco1PYbT0I0xfmN8DLZdxkX1MCAwEAAaNT
MFEwHQYDVR0OBBYEFEwev0l5Jidtj8q63yWZB8ZvTPvNMB8GA1UdIwQYMBaAFEwe
v0l5Jidtj8q63yWZB8ZvTPvNMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEL
BQADggEBAJToOySxC0E/ozASSDjJabf54F7iUeoYcsq+5SXA1iUVsja5lJnLF26k
X9JFic59U4mVHfF1JjO2OTbgHUONfZYLOgHfx8noVdueCwOJoz0J6pbmV3fR0h3A
GF8CpWzgbINIMrpvFFEwXOhHl0aH/WYMvkGtf1fWTelAeXscXS+9huRPL7JzxmVv
qvMYsib0HJFg9tp8Cl+3IzBuwBxhnYn7fyiHLZbpzTP4/G6Lv4ujdBvY/t5h+NwO
RaOR9b17Ts7WV+VxNbSDt0gFFVhcrfqC45v5J8b63kXEmO1EMQd8UBoFbU9O8dL3
P3CGiS0ljOSY844UO7XO/hyf36FWtKQ=
-----END CERTIFICATE-----
""";

  @TempDir Path dir;

  @Test
  void withExtraCa_containsDefaultsAndExtra() throws Exception {
    Path f = dir.resolve("ca.pem");
    Files.writeString(f, PEM, StandardCharsets.UTF_8);
    KeyStore ks = GeniaTrustStores.withExtraCa(f);
    assertThat(Collections.list(ks.aliases()).size()).isGreaterThan(1);
    Certificate extra =
        CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(PEM.getBytes(StandardCharsets.UTF_8)));
    assertThat(ks.getCertificateAlias(extra)).isNotNull();
  }

  @Test
  void withExtraCa_missingFile_throws() {
    Path f = dir.resolve("nope.pem");
    assertThatThrownBy(() -> GeniaTrustStores.withExtraCa(f))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining(f.toString());
  }
}

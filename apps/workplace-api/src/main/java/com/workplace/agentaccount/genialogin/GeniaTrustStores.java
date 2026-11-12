package com.workplace.agentaccount.genialogin;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * 신뢰 저장소 합성(WP-1461). Gen:iA 서버가 사설 CA 로 서명된 인증서를 쓰면 JDK 기본 신뢰만으로는 TLS 가 실패하므로, 기본 신뢰 CA 에 PEM 으로
 * 받은 사설 CA 를 더한 저장소를 만든다(기본 신뢰를 버리지 않아 공인 CA 로 바뀌어도 그대로 동작).
 */
public final class GeniaTrustStores {

  private GeniaTrustStores() {}

  /**
   * JDK 기본 trust manager 의 accepted issuers 와 PEM 파일의 인증서들을 담은 KeyStore 를 만든다.
   *
   * @throws IllegalStateException 파일을 못 읽거나 인증서가 없을 때(경로를 메시지에 싣는다 — 비밀 아님)
   */
  static KeyStore withExtraCa(Path pemFile) {
    try {
      KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
      ks.load(null, null);
      int i = 0;
      // 기본 신뢰 CA — 인자 없는 init 은 JDK cacerts 를 쓴다.
      TrustManagerFactory tmf =
          TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      tmf.init((KeyStore) null);
      for (var tm : tmf.getTrustManagers()) {
        if (tm instanceof X509TrustManager x) {
          for (X509Certificate c : x.getAcceptedIssuers())
            ks.setCertificateEntry("default-" + i++, c);
        }
      }
      int extra = 0;
      try (InputStream in = Files.newInputStream(pemFile)) {
        for (Certificate c : CertificateFactory.getInstance("X.509").generateCertificates(in)) {
          ks.setCertificateEntry("genia-extra-" + extra++, c);
        }
      }
      if (extra == 0) throw new IllegalStateException("CA 인증서가 없습니다: " + pemFile);
      return ks;
    } catch (IOException | java.security.GeneralSecurityException e) {
      throw new IllegalStateException("CA 인증서를 읽지 못했습니다: " + pemFile, e);
    }
  }
}

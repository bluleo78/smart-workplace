package com.workplace.global.net;

import com.workplace.global.util.ClientIpExtractor;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 클라이언트 IP 판정의 믿는 프록시 대역(WP-1317). {@code app.client-ip} 로 바인딩하고, 기동 때 {@link
 * ClientIpExtractor#trustProxies} 에 넘긴다({@link ClientIpTrustInitializer}).
 *
 * @param trustedProxies X-Forwarded-For 를 붙였다고 믿을 프록시의 CIDR 목록(예: 클러스터 파드 대역 {@code
 *     10.244.0.0/16}). 비면 내부 대역 전체(사설·CGNAT·루프백 등 — {@link InternalAddresses})를 믿는다
 */
@ConfigurationProperties(prefix = "app.client-ip")
public record ClientIpProperties(List<String> trustedProxies) {

  /** 키가 없으면 빈 목록 — 기본(내부 대역)으로 돈다. */
  public ClientIpProperties {
    trustedProxies = trustedProxies == null ? List.of() : List.copyOf(trustedProxies);
  }
}

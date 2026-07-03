package com.workplace.auth.service;

import com.workplace.auth.exception.UnsafeProbeUrlException;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;

/**
 * Task10 — 모델 프로브 baseURL 제약(SSRF 최소화). {@code https:} 는 항상 허용, {@code http:} 는 DNS 해석 결과가
 * loopback/site-local/link-local 인 경우에만 허용(로컬 opencode 호환 서버 대상). 그 외(공인 IP·알 수 없는 스킴·형식 오류)는
 * UnsafeProbeUrlException(400).
 */
public final class ProbeUrlValidator {

  private ProbeUrlValidator() {}

  public static void validate(String baseURL) {
    URI uri;
    try {
      uri = URI.create(baseURL);
    } catch (IllegalArgumentException e) {
      throw new UnsafeProbeUrlException("올바르지 않은 baseURL 형식입니다.");
    }
    String scheme = uri.getScheme();
    String host = uri.getHost();
    if (scheme == null || host == null) {
      throw new UnsafeProbeUrlException("올바르지 않은 baseURL 형식입니다.");
    }
    if ("https".equalsIgnoreCase(scheme)) {
      return;
    }
    if (!"http".equalsIgnoreCase(scheme)) {
      throw new UnsafeProbeUrlException("baseURL 은 https 또는 사설망 http 만 허용됩니다.");
    }
    try {
      InetAddress addr = InetAddress.getByName(host);
      if (!(addr.isLoopbackAddress() || addr.isSiteLocalAddress() || addr.isLinkLocalAddress())) {
        throw new UnsafeProbeUrlException("http baseURL 은 사설망 주소만 허용됩니다.");
      }
    } catch (UnknownHostException e) {
      throw new UnsafeProbeUrlException("baseURL 호스트를 확인할 수 없습니다.");
    }
  }
}

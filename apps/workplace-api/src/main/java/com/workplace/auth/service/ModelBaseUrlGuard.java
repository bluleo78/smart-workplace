package com.workplace.auth.service;

import com.workplace.auth.exception.UnsafeProbeUrlException;
import com.workplace.global.net.InternalAddresses;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 개인 비서·AI 구성원 모델 서버 주소(baseURL) 검사(WP-596 — SSRF). 서버(ai-agent)가 이 주소로 대신 접속하므로, 예전처럼 http 사설망을
 * 허용하거나 https 를 검사 없이 통과시키면 일반 구성원이 서버를 통해 클라우드 메타데이터(169.254.169.254)·서버 자신·클러스터 내부망을 두드릴 수 있었다.
 *
 * <p>규칙: https 만, 이름은 실제 IP 로 모두 풀어 하나라도 내부 대역이면 거절, 풀리지 않으면 거절(fail-closed). 예외는 우리 운영자만 바꾸는 설정
 * {@code workplace.assistant.model-url-allowed-hosts}(환경 변수 MODEL_URL_ALLOWED_HOSTS, 기본 비어 있음)에 적힌
 * 호스트뿐이며, 그 호스트는 사내 LLM 용으로 http 도 허용한다. 고객사 관리자는 이 목록을 바꿀 수 없다. 접속 직전 검사·리다이렉트 금지는 ai-agent 가 같은
 * 규칙으로 한 번 더 한다(이름은 접속 순간 다시 풀리므로).
 */
@Component
public class ModelBaseUrlGuard {

  /** 호스트 이름 → 주소 목록. 테스트가 DNS 없이 결과를 정하도록 분리한다. */
  @FunctionalInterface
  interface HostResolver {
    InetAddress[] resolve(String host) throws UnknownHostException;
  }

  private final Set<String> allowedHosts;
  private final HostResolver resolver;

  @Autowired
  public ModelBaseUrlGuard(
      @Value("${workplace.assistant.model-url-allowed-hosts:}") List<String> allowedHosts) {
    this(allowedHosts, InetAddress::getAllByName);
  }

  ModelBaseUrlGuard(Collection<String> allowedHosts, HostResolver resolver) {
    this.allowedHosts =
        allowedHosts.stream()
            .map(h -> h.trim().toLowerCase(Locale.ROOT))
            .filter(h -> !h.isEmpty())
            .collect(Collectors.toUnmodifiableSet());
    this.resolver = resolver;
  }

  /** 쓸 수 없는 주소면 {@link UnsafeProbeUrlException}(400). */
  public void validate(String baseURL) {
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
    host = host.replaceAll("^\\[|\\]$", "").toLowerCase(Locale.ROOT);
    boolean http = "http".equalsIgnoreCase(scheme);
    if (!http && !"https".equalsIgnoreCase(scheme)) {
      throw new UnsafeProbeUrlException("baseURL 은 https 만 쓸 수 있습니다.");
    }
    // 운영자가 허용한 사내 모델 서버 — 내부 주소·http 여도 통과.
    if (allowedHosts.contains(host)) return;
    if (http) {
      throw new UnsafeProbeUrlException(
          "baseURL 은 https 만 쓸 수 있습니다. 사내 모델 서버는 운영자에게 허용 등록을 요청하세요.");
    }
    if (host.equals("localhost") || host.endsWith(".localhost")) {
      throw internal();
    }
    InetAddress[] addresses;
    try {
      addresses = resolver.resolve(host);
    } catch (UnknownHostException e) {
      throw new UnsafeProbeUrlException("baseURL 호스트를 확인할 수 없습니다.");
    }
    for (InetAddress a : addresses) {
      if (InternalAddresses.isInternal(a)) throw internal();
    }
  }

  private static UnsafeProbeUrlException internal() {
    return new UnsafeProbeUrlException("내부망 주소로는 모델 서버에 접속할 수 없습니다.");
  }
}

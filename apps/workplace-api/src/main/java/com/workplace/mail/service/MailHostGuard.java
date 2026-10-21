package com.workplace.mail.service;

import com.workplace.global.net.InternalAddresses;
import java.net.InetAddress;
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
 * 메일 계정 IMAP/SMTP 호스트의 내부망 차단(WP-740 — SSRF). 연결 테스트·계정 저장은 서버가 사용자가 적은 호스트·포트로 직접 접속하고, 응답 문구
 * (「연결할 수 없습니다」 즉시 / 「시간 초과」 10초)로 열림·닫힘이 갈려 일반 구성원이 서버 자신·클러스터 내부망·클라우드 메타데이터를 두드려 볼 수 있었다.
 *
 * <p>규칙은 모델 서버 주소({@code ModelBaseUrlGuard}, WP-596)와 같다: localhost 이름은 바로 거절, 그 밖의 이름은 실제 IP 로 모두
 * 풀어 하나라도 내부 대역({@link InternalAddresses})이면 거절, 풀리지 않으면 접속하지 않는다. 예외는 우리 운영자만 바꾸는 설정 {@code
 * workplace.mail.allowed-internal-hosts}(환경 변수 MAIL_ALLOWED_INTERNAL_HOSTS, 기본 비어 있음)에 적힌 호스트뿐이다 —
 * 사내 메일 서버를 내부망에 둔 설치용.
 */
@Component
public class MailHostGuard {

  /** 내부 대역으로 풀린 호스트에 돌려주는 문구. */
  static final String INTERNAL_MESSAGE = "내부망 주소로는 접속할 수 없습니다 — 메일 서버 주소를 확인하세요";

  /** 이름이 풀리지 않을 때 문구 — 실제 접속 실패(UnknownHostException) 때와 같게 맞춘다. */
  static final String UNKNOWN_HOST_MESSAGE = "호스트를 찾을 수 없습니다 — 주소를 확인하세요";

  /** 호스트 이름 → 주소 목록. 테스트가 DNS 없이 결과를 정하도록 분리한다. */
  @FunctionalInterface
  interface HostResolver {
    InetAddress[] resolve(String host) throws UnknownHostException;
  }

  private final Set<String> allowedHosts;
  private final HostResolver resolver;

  @Autowired
  public MailHostGuard(
      @Value("${workplace.mail.allowed-internal-hosts:}") List<String> allowedHosts) {
    this(allowedHosts, InetAddress::getAllByName);
  }

  MailHostGuard(Collection<String> allowedHosts, HostResolver resolver) {
    this.allowedHosts =
        allowedHosts.stream()
            .map(h -> h.trim().toLowerCase(Locale.ROOT))
            .filter(h -> !h.isEmpty())
            .collect(Collectors.toUnmodifiableSet());
    this.resolver = resolver;
  }

  /** 접속해도 되는 호스트면 null, 아니면 사용자에게 보일 거절 문구. 접속 전에 IMAP·SMTP 호스트마다 따로 부른다. */
  public String check(String rawHost) {
    if (rawHost == null || rawHost.isBlank()) return UNKNOWN_HOST_MESSAGE;
    String host = rawHost.trim().replaceAll("^\\[|\\]$", "").toLowerCase(Locale.ROOT);
    // 운영자가 허용한 사내 메일 서버 — 내부 주소여도 통과.
    if (allowedHosts.contains(host)) return null;
    if (host.equals("localhost") || host.endsWith(".localhost")) return INTERNAL_MESSAGE;
    InetAddress[] addresses;
    try {
      addresses = resolver.resolve(host);
    } catch (UnknownHostException e) {
      return UNKNOWN_HOST_MESSAGE;
    }
    for (InetAddress a : addresses) {
      if (InternalAddresses.isInternal(a)) return INTERNAL_MESSAGE;
    }
    return null;
  }
}

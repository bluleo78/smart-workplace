package com.workplace.global.util;

import com.workplace.global.net.InternalAddresses;
import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.function.Predicate;
import java.util.regex.Pattern;
import org.springframework.security.web.util.matcher.IpAddressMatcher;

/**
 * 클라이언트 IP 판정 — 감사 로그({@link RequestInfo}·공개 링크 감사)와 공개 경로 속도 제한이 모두 이 한 규칙을 쓴다(WP-1317).
 *
 * <p>운영 요청은 앞단 LB → ingress-nginx → web nginx → api 를 거쳐, api 의 접속 주소는 늘 web nginx(클러스터 안) 이고
 * {@code X-Forwarded-For} 끝에는 프록시들이 붙인 내부 주소가 쌓인다. 그래서:
 *
 * <ol>
 *   <li>접속 주소가 믿는 프록시가 아니면(프록시 없이 바로 온 요청) 접속 주소를 쓴다 — 그 요청의 {@code X-Forwarded-For} 는 아무나 쓸 수 있다.
 *   <li>믿는 프록시에서 왔으면 {@code X-Forwarded-For} 를 <b>오른쪽부터</b> 걷어 믿는 프록시가 아닌 첫 주소를 쓴다. 그보다 왼쪽은 바깥에서 보낸
 *       값이라 보지 않는다(위조한 첫 값이 감사 로그에 남지 않게).
 *   <li>IP 가 아닌 값을 만나면 거기서 멈추고 마지막으로 믿은 주소를 쓴다. 모두 믿는 프록시면 가장 왼쪽 주소다(인프라가 실제 주소를 넘기기 전의 운영 — 노드
 *       주소).
 * </ol>
 *
 * <p>예전에는 감사 로그가 첫 값(위조 가능)을, 속도 제한이 마지막 값(web nginx 가 붙인 ingress 파드 주소 — 전 사용자 한 버킷)을 써 서로 달랐다.
 *
 * <p>믿는 프록시는 기본이 내부 대역({@link InternalAddresses} — 사설·CGNAT·루프백 등, 클러스터 파드·서비스 대역 포함)이고 {@code
 * app.client-ip.trusted-proxies}(CIDR 목록)로 좁힐 수 있다({@link #trustProxies}).
 */
public final class ClientIpExtractor {

  /**
   * IPv4 점 표기(칸마다 0~255) — 이 모양이 아닌 숫자 문자열을 {@link InetAddress#getByName} 에 넘기면 이름으로 보고 DNS 를 조회할 수
   * 있다.
   */
  private static final Pattern IPV4 =
      Pattern.compile(
          "((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)");

  /** IPv6 표기(16진수·콜론·점 — 끝에 IPv4 를 실은 꼴 포함). 콜론이 있으면 getByName 은 조회 없이 해석하거나 거절한다. */
  private static final Pattern IPV6 = Pattern.compile("[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*");

  private static final Predicate<InetAddress> INTERNAL = InternalAddresses::isInternal;

  /** 믿는 프록시 판정 — 기동 때 설정으로 한 번 바뀐다({@link #trustProxies}). */
  private static volatile Predicate<InetAddress> trustedProxy = INTERNAL;

  private ClientIpExtractor() {
    // 유틸 클래스 - 인스턴스 생성 금지
  }

  /**
   * 믿는 프록시 대역을 정한다 — 비면 기본(내부 대역). 잘못된 CIDR 은 기동을 막는다(IllegalArgumentException).
   *
   * @param cidrs {@code 10.244.0.0/16} 같은 CIDR 또는 단일 주소
   */
  public static void trustProxies(List<String> cidrs) {
    if (cidrs == null || cidrs.isEmpty()) {
      trustedProxy = INTERNAL;
      return;
    }
    List<IpAddressMatcher> matchers =
        cidrs.stream().map(String::trim).map(ClientIpExtractor::matcher).toList();
    trustedProxy = a -> matchers.stream().anyMatch(m -> m.matches(a.getHostAddress()));
  }

  private static IpAddressMatcher matcher(String cidr) {
    String host = cidr.contains("/") ? cidr.substring(0, cidr.indexOf('/')) : cidr;
    if (parse(host) == null) {
      throw new IllegalArgumentException("app.client-ip.trusted-proxies 의 값이 IP 대역이 아닙니다: " + cidr);
    }
    return new IpAddressMatcher(cidr);
  }

  /**
   * 요청의 클라이언트 IP. 규칙은 클래스 설명.
   *
   * @param request HTTP 요청 객체
   * @return 클라이언트 IP 문자열 (요청이 null이면 null)
   */
  public static String extract(HttpServletRequest request) {
    if (request == null) {
      return null;
    }
    String remote = request.getRemoteAddr();
    if (!isTrusted(parse(remote))) {
      return remote;
    }
    String forwarded = request.getHeader("X-Forwarded-For");
    if (forwarded == null || forwarded.isBlank()) {
      return remote;
    }
    String[] hops = forwarded.split(",");
    String client = remote;
    for (int i = hops.length - 1; i >= 0; i--) {
      String hop = hops[i].trim();
      InetAddress address = parse(hop);
      if (address == null) break; // IP 가 아닌 값 — 마지막으로 믿은 주소를 쓴다
      client = hop;
      if (!isTrusted(address)) break;
    }
    return client;
  }

  private static boolean isTrusted(InetAddress a) {
    return a != null && trustedProxy.test(a);
  }

  /** IP 표기면 주소, 아니면 null — 이름은 받지 않는다(DNS 조회 없음). */
  private static InetAddress parse(String s) {
    if (s == null || !(IPV4.matcher(s).matches() || IPV6.matcher(s).matches())) {
      return null;
    }
    try {
      return InetAddress.getByName(s);
    } catch (UnknownHostException e) {
      return null;
    }
  }

  /** audit_log.ip_address 열 길이. */
  public static final int AUDIT_IP_MAX = 45;

  /**
   * 감사 로그에 넣을 IP — 열 길이({@link #AUDIT_IP_MAX})로 자른다. 판정 결과는 늘 IP 라 넘지 않지만, 호출자가 다른 값을 넘겨도 INSERT 가
   * 실패하지 않게 둔다. null 은 그대로.
   */
  public static String forAudit(String ip) {
    return ip == null || ip.length() <= AUDIT_IP_MAX ? ip : ip.substring(0, AUDIT_IP_MAX);
  }
}

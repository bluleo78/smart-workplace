package com.workplace.notify.push;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import org.springframework.stereotype.Component;

/**
 * 푸시 endpoint 검증. 서버가 이 URL 로 직접 HTTP 요청을 보내므로(SSRF 경로) https + 공인 주소만 허용한다. 푸시 서비스 호스트는 브라우저마다 달라
 * 허용 목록 대신 내부 대역 차단 방식을 쓴다. 등록 시와 발송 직전에 모두 호출한다(DNS 재바인딩 완화).
 */
@Component
public class EndpointValidator {

  static final int MAX_LENGTH = 2048;

  /**
   * 검증 결과 3가지 — DNS 조회 실패(UnknownHostException, 타임아웃 등)를 "내부 주소로 확인됨"과 구분하기 위해 둔다. 호출부(PushSender)가
   * 이 둘을 다르게 처리한다: BLOCKED 는 영구 폐기 대상, UNRESOLVED 는 일시적일 수 있어 일반 발송 실패로만 집계한다.
   */
  public enum Outcome {
    /** https + 공인 주소로 확인됨. */
    ALLOWED,
    /** 형식 오류·https 아님·내부/사설 대역으로 확인됨 — 영구 차단. */
    BLOCKED,
    /** DNS 조회 자체가 실패(호스트 미해석·타임아웃) — 일시적일 수 있어 차단과 구분. */
    UNRESOLVED,
  }

  /** 허용 여부만 필요한 호출부(등록 API)용 — BLOCKED·UNRESOLVED 모두 false(등록 단계는 검증 불가를 허용으로 취급하지 않는다). */
  public boolean isAllowed(String endpoint) {
    return check(endpoint) == Outcome.ALLOWED;
  }

  /** 3가지 결과로 구분한 검증. */
  public Outcome check(String endpoint) {
    if (endpoint == null || endpoint.length() > MAX_LENGTH) return Outcome.BLOCKED;
    URI u;
    try {
      u = URI.create(endpoint);
    } catch (IllegalArgumentException e) {
      return Outcome.BLOCKED; // 파싱 불가
    }
    if (!"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null) return Outcome.BLOCKED;
    String host = u.getHost();
    if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
    InetAddress[] addresses;
    try {
      addresses = InetAddress.getAllByName(host);
    } catch (UnknownHostException e) {
      return Outcome.UNRESOLVED; // 호스트 미해석·조회 실패(네트워크 문제 포함) — 내부 주소로 단정하지 않는다
    }
    for (InetAddress a : addresses) {
      if (isInternal(a)) return Outcome.BLOCKED;
    }
    return Outcome.ALLOWED;
  }

  /**
   * 루프백·사설·링크로컬·미지정·멀티캐스트·CGNAT(100.64/10)·IPv6 ULA(fc00::/7)·NAT64 well-known prefix
   * (64:ff9b::/96).
   */
  static boolean isInternal(InetAddress a) {
    if (a.isLoopbackAddress()
        || a.isSiteLocalAddress()
        || a.isLinkLocalAddress()
        || a.isAnyLocalAddress()
        || a.isMulticastAddress()) return true;
    byte[] b = a.getAddress();
    if (a instanceof Inet4Address) {
      return (b[0] & 0xff) == 100 && (b[1] & 0xc0) == 64;
    }
    if (a instanceof Inet6Address) {
      if ((b[0] & 0xfe) == 0xfc) return true;
      // NAT64 well-known prefix — 뒤 32비트에 임의 IPv4(예: 루프백)를 실어 내부망을 우회할 수 있어 전체 /96 차단
      return b[0] == 0x00
          && b[1] == 0x64
          && b[2] == (byte) 0xff
          && b[3] == (byte) 0x9b
          && b[4] == 0
          && b[5] == 0
          && b[6] == 0
          && b[7] == 0
          && b[8] == 0
          && b[9] == 0
          && b[10] == 0
          && b[11] == 0;
    }
    return false;
  }
}

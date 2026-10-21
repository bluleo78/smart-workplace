package com.workplace.global.net;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;

/**
 * 서버가 사용자가 적은 주소로 대신 접속하는 경로(SSRF)에서 쓰는 내부 대역 판정. 웹 푸시 endpoint(EndpointValidator)와 모델 서버
 * 주소(ModelBaseUrlGuard, WP-596)가 같은 기준을 쓰도록 한 곳에 둔다.
 */
public final class InternalAddresses {

  private InternalAddresses() {}

  /**
   * 루프백·사설·링크로컬(클라우드 메타데이터 169.254.x 포함)·미지정·멀티캐스트·CGNAT(100.64/10)·IPv6 ULA(fc00::/7)·NAT64
   * well-known prefix(64:ff9b::/96).
   */
  public static boolean isInternal(InetAddress a) {
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

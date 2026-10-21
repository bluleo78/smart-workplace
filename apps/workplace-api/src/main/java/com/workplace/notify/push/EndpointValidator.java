package com.workplace.notify.push;

import com.workplace.global.net.InternalAddresses;
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

  /** 내부 대역 판정 — 모델 서버 주소 검사(WP-596)와 같은 기준을 쓰도록 global 로 옮겼다. */
  static boolean isInternal(InetAddress a) {
    return InternalAddresses.isInternal(a);
  }
}

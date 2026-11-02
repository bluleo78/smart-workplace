package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * ClientIpExtractor 단위 테스트(이슈 #147, WP-1317) — 믿는 프록시에서 온 요청이면 X-Forwarded-For 를 오른쪽부터 걷어 믿는 프록시가
 * 아닌 첫 주소를 쓰고, 아니면 접속 주소를 쓴다.
 */
class ClientIpExtractorTest {

  @AfterEach
  void resetTrust() {
    ClientIpExtractor.trustProxies(List.of());
  }

  private static String extract(String remote, String forwardedFor) {
    MockHttpServletRequest req = new MockHttpServletRequest();
    req.setRemoteAddr(remote);
    if (forwardedFor != null) req.addHeader("X-Forwarded-For", forwardedFor);
    return ClientIpExtractor.extract(req);
  }

  /** 운영 경로(ingress → web nginx → api) — 노드 주소·ingress 파드 주소를 걷어 실제 클라이언트를 쓴다. */
  @Test
  void 내부_프록시를_오른쪽부터_걷어_바깥_첫_주소를_쓴다() {
    assertThat(extract("10.244.4.80", "203.0.113.7, 10.244.3.206, 10.244.4.57"))
        .isEqualTo("203.0.113.7");
    assertThat(extract("10.0.0.1", "  203.0.113.5  ,  10.0.0.1  ")).isEqualTo("203.0.113.5");
    assertThat(extract("10.0.0.1", "203.0.113.5")).isEqualTo("203.0.113.5");
  }

  /** 바깥에서 위조한 첫 값은 쓰지 않는다 — 믿는 프록시가 붙인 바로 그 주소에서 멈춘다. */
  @Test
  void 위조한_첫_값은_무시한다() {
    assertThat(extract("10.244.4.80", "1.2.3.4, 203.0.113.7, 10.244.4.57"))
        .isEqualTo("203.0.113.7");
  }

  /** 프록시를 거치지 않은 바깥 접속이면 X-Forwarded-For 를 보지 않는다(누구나 쓸 수 있다). */
  @Test
  void 바깥_접속이면_접속_주소를_쓴다() {
    assertThat(extract("198.51.100.20", "1.2.3.4")).isEqualTo("198.51.100.20");
    assertThat(extract("198.51.100.20", null)).isEqualTo("198.51.100.20");
  }

  /** 모두 믿는 프록시면 가장 왼쪽 — 인프라가 실제 주소를 넘기기 전 운영(노드 주소). 헤더가 없거나 비면 접속 주소. */
  @Test
  void 모두_내부면_가장_왼쪽_헤더가_없으면_접속_주소() {
    assertThat(extract("10.244.4.80", "10.244.3.206, 10.244.4.57")).isEqualTo("10.244.3.206");
    assertThat(extract("192.168.1.42", null)).isEqualTo("192.168.1.42");
    assertThat(extract("192.168.1.42", "   ")).isEqualTo("192.168.1.42");
  }

  /** IP 가 아닌 값(이름·긴 문자열·포트 붙은 값)을 만나면 멈추고 마지막으로 믿은 주소를 쓴다 — 조회하지 않고 감사 열을 넘지 않는다. */
  @Test
  void IP_가_아닌_값에서는_마지막으로_믿은_주소를_쓴다() {
    assertThat(extract("127.0.0.1", "1".repeat(60) + ", 10.0.0.1")).isEqualTo("10.0.0.1");
    assertThat(extract("127.0.0.1", "evil.example.com")).isEqualTo("127.0.0.1");
    assertThat(extract("127.0.0.1", "999.1.1.1")).isEqualTo("127.0.0.1");
    assertThat(extract("127.0.0.1", "203.0.113.5:443, 10.0.0.1")).isEqualTo("10.0.0.1");
  }

  /** IPv6 클라이언트도 같은 규칙. */
  @Test
  void IPv6_도_같은_규칙() {
    assertThat(extract("10.0.0.1", "2001:db8::7, fd00::1")).isEqualTo("2001:db8::7");
  }

  /** 믿는 대역을 좁히면 그 밖의 사설 주소는 클라이언트로 본다. 잘못된 CIDR 은 거절한다. */
  @Test
  void 믿는_대역을_설정으로_좁힌다() {
    ClientIpExtractor.trustProxies(List.of("10.244.0.0/16"));
    assertThat(extract("10.244.4.80", "192.168.0.9, 10.244.4.57")).isEqualTo("192.168.0.9");
    // 접속 주소가 믿는 대역 밖이면 헤더를 보지 않는다.
    assertThat(extract("192.168.0.9", "203.0.113.7")).isEqualTo("192.168.0.9");
    assertThatThrownBy(() -> ClientIpExtractor.trustProxies(List.of("not-a-cidr")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("not-a-cidr");
  }

  /** request 자체가 null이면 null을 반환한다 (방어적 처리) */
  @Test
  void extract_whenRequestNull_returnsNull() {
    assertThat(ClientIpExtractor.extract(null)).isNull();
  }
}

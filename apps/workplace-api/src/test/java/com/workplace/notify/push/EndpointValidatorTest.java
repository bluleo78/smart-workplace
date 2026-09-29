package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 푸시 endpoint SSRF 방지 — https + 공인 주소만 허용. 대부분은 IP 리터럴만 써서 DNS 없이 결정적으로 검증하지만, BLOCKED/UNRESOLVED
 * 구분 검증 1건은 RFC 2606 예약 TLD(.invalid)로 실제 DNS 조회 실패를 재현한다.
 */
class EndpointValidatorTest {

  final EndpointValidator v = new EndpointValidator();

  @ParameterizedTest
  @ValueSource(
      strings = {
        "https://203.0.113.10/push/abc",
        "https://[2001:db8::1]/push/abc",
      })
  void allowsPublicHttps(String ep) {
    assertThat(v.isAllowed(ep)).isTrue();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "http://203.0.113.10/push/abc", // https 아님
        "https://127.0.0.1/x",
        "https://10.0.0.5/x",
        "https://172.16.0.1/x",
        "https://192.168.1.1/x",
        "https://169.254.169.254/latest/meta-data", // 클라우드 메타데이터
        "https://100.64.0.1/x", // CGNAT
        "https://0.0.0.0/x",
        "https://[::1]/x",
        "https://[fd00::1]/x", // ULA
        "https:///nohost",
        "not a url",
        "https://[64:ff9b::7f00:1]/x", // NAT64 well-known prefix — 내장 IPv4(127.0.0.1) 로 SSRF 우회 가능
      })
  void rejectsInternalOrMalformed(String ep) {
    assertThat(v.isAllowed(ep)).isFalse();
  }

  @org.junit.jupiter.api.Test
  void rejectsTooLong() {
    assertThat(v.isAllowed("https://203.0.113.10/" + "a".repeat(2100))).isFalse();
  }

  @org.junit.jupiter.api.Test
  void check_distinguishesBlockedFromUnresolved() {
    // 내부 대역 — 영구 차단(BLOCKED).
    assertThat(v.check("https://127.0.0.1/x")).isEqualTo(EndpointValidator.Outcome.BLOCKED);
    // DNS 조회 자체가 실패 — 일시적일 수 있어 차단과 구분(UNRESOLVED). RFC 2606 예약 TLD 라 결코 실제로 등록되지 않는다.
    assertThat(v.check("https://this-host-never-resolves.invalid/push"))
        .isEqualTo(EndpointValidator.Outcome.UNRESOLVED);
    // isAllowed() 는 등록 API 용 — BLOCKED·UNRESOLVED 모두 false 로 뭉뚱그린다(등록 시점은 구분하지 않음).
    assertThat(v.isAllowed("https://this-host-never-resolves.invalid/push")).isFalse();
    assertThat(v.check("https://203.0.113.10/push/abc"))
        .isEqualTo(EndpointValidator.Outcome.ALLOWED);
  }
}

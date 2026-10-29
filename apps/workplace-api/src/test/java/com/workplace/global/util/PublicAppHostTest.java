package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** 공개 웹 주소의 호스트 정규화(WP-1165) — 서버 OG 제외와 웹 앱 카드 판정이 같은 값을 쓴다. 상태 없는 정적 함수라 스프링 없이 본다. */
class PublicAppHostTest {

  @ParameterizedTest
  @CsvSource(
      nullValues = "NULL",
      value = {
        "https://works.example.com, works.example.com",
        "HTTPS://Works.Example.COM:443/, works.example.com",
        "http://localhost:6173, localhost",
        "  https://works.example.com/app/  , works.example.com",
        "'', NULL",
        "NULL, NULL",
        "ftp://works.example.com, NULL",
        "works.example.com, NULL",
        "https://user:pw@works.example.com/, works.example.com",
        "https://예시.한국, xn--vv4b11d.xn--3e0b707e",
      })
  void 호스트만_소문자로_남기고_포트는_버리며_읽을_수_없으면_null(String base, String host) {
    assertThat(PublicAppHost.of(base)).isEqualTo(host);
  }
}

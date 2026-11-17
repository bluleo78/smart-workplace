package com.workplace.auth.oauth.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * redirect_uri 규칙(WP-1685) 순수 함수 테스트 — 등록 검사(1~10개·2000자·프래그먼트 없음·https 또는 루프백 http)와 비교(정확히 같음,
 * 루프백 http 만 포트 무시 — RFC 8252 §7.3).
 */
class RedirectUrisTest {

  @Test
  void 비교는_문자열이_정확히_같아야_한다() {
    String registered = "https://a.example/cb";
    assertThat(RedirectUris.matches(registered, "https://a.example/cb")).isTrue();
    assertThat(RedirectUris.matches(registered, "https://a.example/cb/")).isFalse();
    assertThat(RedirectUris.matches(registered, "https://A.example/cb")).isFalse();
    assertThat(RedirectUris.matches(registered, "https://a.example/cb?x=1")).isFalse();
    assertThat(RedirectUris.matches(registered, "https://a.example:8443/cb")).isFalse();
  }

  @Test
  void 루프백_http_는_포트만_무시한다() {
    assertThat(RedirectUris.matches("http://localhost:1234/cb", "http://localhost:5678/cb"))
        .isTrue();
    assertThat(RedirectUris.matches("http://127.0.0.1:1/cb", "http://127.0.0.1:2/cb")).isTrue();
    assertThat(RedirectUris.matches("http://[::1]:1/cb", "http://[::1]:2/cb")).isTrue();
    // 등록 때 포트가 없어도 요청의 임의 포트를 받는다
    assertThat(RedirectUris.matches("http://localhost/cb", "http://localhost:9/cb")).isTrue();
    // 포트 밖(경로·호스트·쿼리)은 정확히 같아야 한다
    assertThat(RedirectUris.matches("http://localhost:1/cb", "http://localhost:1/other")).isFalse();
    assertThat(RedirectUris.matches("http://localhost:1/cb", "http://127.0.0.1:1/cb")).isFalse();
    assertThat(RedirectUris.matches("http://localhost:1/cb", "http://localhost:1/cb?x=1"))
        .isFalse();
    // 루프백 http 가 아닌 https 루프백은 포트를 무시하지 않는다
    assertThat(RedirectUris.matches("https://localhost:1/cb", "https://localhost:2/cb")).isFalse();
    // 사용자 정보로 호스트를 속인 요청은 루프백으로 보지 않는다
    assertThat(RedirectUris.matches("http://localhost:1/cb", "http://localhost:1@evil.example/cb"))
        .isFalse();
  }

  @Test
  void 비교에_null_이_있으면_같지_않다() {
    assertThat(RedirectUris.matches("https://a.example/cb", null)).isFalse();
    assertThat(RedirectUris.matches(null, "https://a.example/cb")).isFalse();
  }

  @Test
  void 등록_검사는_문제가_있으면_이유를_돌려준다() {
    assertThat(RedirectUris.validateForRegistration(null)).isPresent();
    assertThat(RedirectUris.validateForRegistration(List.of())).isPresent();
    assertThat(
            RedirectUris.validateForRegistration(Collections.nCopies(11, "https://a.example/cb")))
        .isPresent();
    assertThat(RedirectUris.validateForRegistration(List.of("http://evil.example/cb"))).isPresent();
    assertThat(RedirectUris.validateForRegistration(List.of("https://a/cb#frag"))).isPresent();
    assertThat(
            RedirectUris.validateForRegistration(
                List.of("https://a.example/" + "x".repeat(2001 - "https://a.example/".length()))))
        .isPresent();
    // 루프백 이름을 앞에 붙인 바깥 호스트·사용자 정보로 속인 호스트
    assertThat(RedirectUris.validateForRegistration(List.of("http://localhost.evil.example/cb")))
        .isPresent();
    assertThat(RedirectUris.validateForRegistration(List.of("http://localhost@evil.example/cb")))
        .isPresent();
    assertThat(RedirectUris.validateForRegistration(List.of("javascript:alert(1)"))).isPresent();
    assertThat(RedirectUris.validateForRegistration(List.of("not a url"))).isPresent();
    assertThat(RedirectUris.validateForRegistration(java.util.Arrays.asList((String) null)))
        .isPresent();
  }

  @Test
  void 등록_검사는_https_와_루프백_http_를_받는다() {
    assertThat(RedirectUris.validateForRegistration(List.of("https://a.example/cb"))).isEmpty();
    assertThat(RedirectUris.validateForRegistration(List.of("http://[::1]:9/cb"))).isEmpty();
    assertThat(
            RedirectUris.validateForRegistration(
                List.of("http://localhost:33418/callback", "http://127.0.0.1/cb")))
        .isEmpty();
    assertThat(
            RedirectUris.validateForRegistration(Collections.nCopies(10, "https://a.example/cb")))
        .isEmpty();
    // 정확히 2000자는 받는다
    assertThat(
            RedirectUris.validateForRegistration(
                List.of("https://a.example/" + "x".repeat(2000 - "https://a.example/".length()))))
        .isEmpty();
  }
}

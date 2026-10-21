package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.UnsafeProbeUrlException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 모델 서버 주소 SSRF 가드(WP-596) — DNS 대신 고정 결과를 주는 resolver 로 규칙만 검증한다. */
class ModelBaseUrlGuardTest {

  /** 이름별 가짜 DNS 결과. 없는 이름은 UnknownHostException. IP 리터럴은 그대로 푼다. */
  private static ModelBaseUrlGuard guard(List<String> allowed, Map<String, String> dns) {
    return new ModelBaseUrlGuard(
        allowed,
        host -> {
          String ip = dns.get(host);
          if (ip != null) return new InetAddress[] {InetAddress.getByName(ip)};
          if (host.matches("[0-9.]+") || host.contains(":")) {
            return new InetAddress[] {InetAddress.getByName(host)};
          }
          throw new UnknownHostException(host);
        });
  }

  private static final ModelBaseUrlGuard DEFAULT =
      guard(
          List.of(),
          Map.of(
              "api.openai.com", "104.18.6.192",
              "rebind.evil.test", "169.254.169.254",
              "intra.corp.test", "10.1.2.3"));

  @Test
  void 공인_https_는_통과() {
    assertThatCode(() -> DEFAULT.validate("https://api.openai.com/v1")).doesNotThrowAnyException();
  }

  @Test
  void 메타데이터_루프백_사설_리터럴은_https_여도_거절() {
    for (String url :
        List.of(
            "https://169.254.169.254/latest/meta-data",
            "https://127.0.0.1:6060/v1",
            "https://10.0.0.5/v1",
            "https://192.168.1.10/v1",
            "https://[::1]/v1",
            "https://[::ffff:127.0.0.1]/v1",
            "https://0.0.0.0/v1",
            "https://localhost/v1",
            "https://api.localhost/v1")) {
      assertThatThrownBy(() -> DEFAULT.validate(url))
          .as(url)
          .isInstanceOf(UnsafeProbeUrlException.class)
          .hasMessageContaining("내부망");
    }
  }

  @Test
  void 이름이_내부_주소로_풀리면_거절() {
    assertThatThrownBy(() -> DEFAULT.validate("https://rebind.evil.test/v1"))
        .hasMessageContaining("내부망");
    assertThatThrownBy(() -> DEFAULT.validate("https://intra.corp.test/v1"))
        .hasMessageContaining("내부망");
  }

  @Test
  void 풀리지_않는_이름은_거절() {
    assertThatThrownBy(() -> DEFAULT.validate("https://no-such-host.test/v1"))
        .isInstanceOf(UnsafeProbeUrlException.class)
        .hasMessageContaining("확인할 수 없습니다");
  }

  @Test
  void 허용목록_밖의_http_는_사설망이어도_거절() {
    assertThatThrownBy(() -> DEFAULT.validate("http://api.openai.com/v1"))
        .hasMessageContaining("https");
    assertThatThrownBy(() -> DEFAULT.validate("http://192.168.1.10:8080/v1"))
        .hasMessageContaining("https");
  }

  @Test
  void 형식이_틀리거나_다른_스킴이면_거절() {
    for (String url : List.of("not a url", "ftp://api.openai.com/", "file:///etc/passwd", "//x")) {
      assertThatThrownBy(() -> DEFAULT.validate(url))
          .as(url)
          .isInstanceOf(UnsafeProbeUrlException.class);
    }
  }

  @Test
  void 운영자_허용목록_호스트는_사설주소_http_도_통과() {
    var g =
        guard(List.of(" LLM.Corp.Internal ", "10.0.0.5"), Map.of("llm.corp.internal", "10.9.9.9"));
    assertThatCode(() -> g.validate("http://llm.corp.internal:11434/v1"))
        .doesNotThrowAnyException();
    assertThatCode(() -> g.validate("https://10.0.0.5/v1")).doesNotThrowAnyException();
    // 목록에 없는 다른 사설 주소는 여전히 거절
    assertThatThrownBy(() -> g.validate("https://10.0.0.6/v1")).hasMessageContaining("내부망");
  }
}

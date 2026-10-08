package com.workplace.global.outbound;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * 평문 HTTP 내부 서비스(ai-agent·워커·노트 동기화 서버) 호출용 HTTP 클라이언트 공용 생성 지점(WP-305).
 *
 * <p>왜: JDK HttpClient 기본 버전(HTTP/2)은 평문 http 요청에 {@code Connection: Upgrade, HTTP2-Settings} /
 * {@code Upgrade: h2c} 를 붙인다. 상대가 Node(WebSocket upgrade 리스너)·uvicorn(h11)·프록시면 이를 업그레이드 요청으로 오인해
 * 404/400 으로 거절한다(WP-172 동기화 서버 404, 워커 400 사례). 내부 호출에 HTTP/2 이득도 없으므로 모든 내부 클라이언트를 여기서 만들어
 * HTTP/1.1 로 고정한다 — 클라이언트마다 따로 고정하면 새 클라이언트가 빠뜨린다({@code InternalHttpArchTest} 가 직접 생성을 막는다).
 *
 * <p>외부 HTTPS(웹 푸시·M365·Graph)는 대상이 아니다 — h2c 는 평문에서만 쓰이고, HTTPS 는 ALPN 으로 HTTP/2 를 협상하는 편이 낫다.
 */
public final class InternalHttp {

  private InternalHttp() {}

  /**
   * HTTP/1.1 고정 JDK HttpClient 빌더 — SSE 스트림처럼 HttpClient 를 직접 쓰는 클라이언트용. 호출자가 연결 타임아웃 등을 더 얹어 build
   * 한다.
   */
  public static HttpClient.Builder httpClientBuilder() {
    // 리다이렉트 미추종은 JDK 기본(NEVER)이지만 requestFactory 와 같은 정책임을 명시한다.
    return HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .followRedirects(HttpClient.Redirect.NEVER);
  }

  /**
   * HTTP/1.1 고정 JDK 요청 팩토리 — RestClient 용. 이 classpath 에서 {@code
   * ClientHttpRequestFactoryBuilder.detect()} 도 JDK 를 고르지만 버전을 지정할 수 없어 {@code jdk()} 에 커스터마이저로
   * 고정한다.
   *
   * <p>리다이렉트는 따라가지 않는다 — 내부 서비스는 3xx 를 내지 않으므로 3xx 는 오설정 신호다. 조용히 따라가면(303 은 POST 를 GET 으로 바꾼다) 엉뚱한
   * 요청이 성공처럼 보이므로 그대로 드러내는 편이 낫다.
   *
   * @param connectTimeout 연결 타임아웃(null 이면 무제한 — JDK 기본)
   * @param readTimeout 요청별 응답 타임아웃(null 이면 무제한 — JDK 기본)
   */
  public static ClientHttpRequestFactory requestFactory(
      Duration connectTimeout, Duration readTimeout) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(connectTimeout)
            .withReadTimeout(readTimeout)
            .withRedirects(ClientHttpRequestFactorySettings.Redirects.DONT_FOLLOW);
    return ClientHttpRequestFactoryBuilder.jdk()
        .withHttpClientCustomizer(b -> b.version(HttpClient.Version.HTTP_1_1))
        .build(settings);
  }

  /** 타임아웃 없는(JDK 기본) HTTP/1.1 고정 요청 팩토리 — 기존에 팩토리를 지정하지 않던 호출 지점용. */
  public static ClientHttpRequestFactory requestFactory() {
    return requestFactory(null, null);
  }

  /**
   * HTTP/1.1 고정 요청 팩토리를 단 RestClient 빌더 — 내부 클라이언트 설정이 RestClient 를 만드는 유일한 경로(직접 {@code
   * RestClient.builder()} 는 {@code InternalHttpArchTest} 가 막는다).
   */
  public static RestClient.Builder restClient(
      String baseUrl, Duration connectTimeout, Duration readTimeout) {
    return RestClient.builder()
        .baseUrl(baseUrl)
        .requestFactory(requestFactory(connectTimeout, readTimeout));
  }

  /** 타임아웃 없는(JDK 기본) {@link #restClient(String, Duration, Duration)} — 기존에 팩토리를 지정하지 않던 호출 지점용. */
  public static RestClient.Builder restClient(String baseUrl) {
    return RestClient.builder().baseUrl(baseUrl).requestFactory(requestFactory());
  }
}

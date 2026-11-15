package com.workplace.global.outbound;

import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.client.RestClient;

/**
 * 정적 {@code RestClient.builder()} 로 만드는 외부·내부 호출 클라이언트가 JSON 을 Jackson 2 로 읽고 쓰게 고정한다(WP-1608).
 *
 * <p>왜: 정적 빌더는 Boot 의 변환기 설정({@code spring.http.converters.preferred-json-mapper})을 거치지 않고
 * classpath 에 Jackson 3 이 있으면 그것을 먼저 고른다. Flyway 12 가 Jackson 3({@code
 * tools.jackson.core:jackson-databind})을 필수 의존으로 끌어와 classpath 에서 Jackson 3 을 뺄 수 없게 됐다(WP-1588 의
 * 제외 삭제). 그러면 응답을 Jackson 3 기본값(null → 기본형 실패 등)으로 읽어 조용히 예외가 되므로(OutboundJsonMapperTest),
 * classpath 가 아니라 변환기를 직접 지정해 Jackson 2 로 고정한다. Jackson 3 으로 전환(WP-1609)할 때 이 클래스와 호출 지점을 함께 지운다.
 */
public final class OutboundJson {

  private OutboundJson() {}

  /**
   * Jackson 2 JSON 변환기가 이미 지정된 새 RestClient 빌더 — 정적 아웃바운드 클라이언트는 {@code RestClient.builder()} 대신
   * 이것으로 시작한다(고정이 생성 시점에 보장된다. {@code InternalHttpArchTest} 가 직접 호출을 막는다). 나머지 변환기는 기본값 유지.
   */
  @SuppressWarnings("removal")
  public static RestClient.Builder restClientBuilder() {
    return RestClient.builder()
        .configureMessageConverters(
            converters -> converters.withJsonConverter(new MappingJackson2HttpMessageConverter()));
  }
}

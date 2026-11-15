package com.workplace.global.outbound;

import com.workplace.global.json.JsonMappers;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * 정적 {@code RestClient.builder()} 로 만드는 외부·내부 호출 클라이언트가 JSON 을 Jackson 2 기본값의 Jackson 3 매퍼로 읽고 쓰게
 * 고정한다(WP-1608 에서 도입, WP-1609 에서 Jackson 3 으로 전환).
 *
 * <p>왜: 정적 RestClient 는 Boot 매퍼 설정({@code spring.jackson.use-jackson2-defaults} 등)을 거치지 않고 Jackson
 * 3 기본값의 매퍼를 스스로 만든다. 그러면 외부 응답을 Jackson 3 기본값(null → 기본형 실패, 뒤따르는 토큰 실패 등)으로 읽어 조용히 예외가 되고 요청 본문의
 * 속성 순서·날짜 모양도 바뀌므로(OutboundJsonMapperTest), Jackson 2 때와 같은 기본값·크기 한도({@link
 * JsonMappers#jackson2Builder()})의 Jackson 3 매퍼로 변환기를 직접 지정해 고정한다. 새 호출 지점이 이 고정을 건너뛰지 않도록 {@code
 * InternalHttpArchTest} 가 정적 빌더 직접 호출을 막는다.
 */
public final class OutboundJson {

  /**
   * 아웃바운드 응답을 읽고 요청을 쓰는 매퍼 — WP-1609 전 {@code new MappingJackson2HttpMessageConverter()} 가 쓰던 매퍼와
   * 같게 맞춘다. 그 변환기는 {@code Jackson2ObjectMapperBuilder} 로 매퍼를 만들어 (1) 모르는 속성을 무시하고({@code
   * FAIL_ON_UNKNOWN_PROPERTIES} 끔 — 외부 응답에 새 필드가 생겨도 실패하지 않는다) (2) ParameterNamesModule 을 등록해 생성자
   * 인자 이름으로 역직렬화했고 (3) {@code DEFAULT_VIEW_INCLUSION} 을 껐다. 그래서 Jackson 2 기본값·크기 한도({@link
   * JsonMappers#jackson2Builder()})에서 시작해 {@code FAIL_ON_UNKNOWN_PROPERTIES} 를 끄고, {@code
   * MapperFeature.DETECT_PARAMETER_NAMES} 를 켜고(Jackson 3 에서 ParameterNamesModule 에 해당, {@code
   * configureForJackson2} 가 끈다), {@code MapperFeature.DEFAULT_VIEW_INCLUSION} 을 끈다. 설정이 끝난 뒤 바뀌지
   * 않으므로 공유한다(패키지 공개는 OutboundJsonMapperTest 가 설정을 확인하기 위해서다).
   */
  static final JsonMapper MAPPER =
      JsonMappers.jackson2Builder()
          .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(MapperFeature.DETECT_PARAMETER_NAMES)
          .disable(MapperFeature.DEFAULT_VIEW_INCLUSION)
          .build();

  private OutboundJson() {}

  /**
   * Jackson 2 기본값의 Jackson 3 JSON 변환기가 이미 지정된 새 RestClient 빌더 — 정적 아웃바운드 클라이언트는 {@code
   * RestClient.builder()} 대신 이것으로 시작한다(고정이 생성 시점에 보장된다. {@code InternalHttpArchTest} 가 직접 호출을 막는다).
   * 나머지 변환기는 기본값 유지.
   */
  public static RestClient.Builder restClientBuilder() {
    return RestClient.builder()
        .configureMessageConverters(
            converters ->
                converters.withJsonConverter(new JacksonJsonHttpMessageConverter(MAPPER)));
  }
}

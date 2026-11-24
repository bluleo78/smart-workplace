package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.JdkClientHttpRequestFactoryBuilder;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.cfg.DateTimeFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * Spring Boot 4 로 올리며(WP-1588) 설정 키 이름·기본값이 바뀌어 "오류 없이 조용히" 동작이 달라질 수 있는 HTTP 기본 구성을 고정한다.
 *
 * <p>- 외부 호출 HTTP 구현: {@code spring.http.clients.imperative.factory=jdk}(옛 이름 {@code
 * spring.http.client.factory}). 옛 키는 deprecated 로 표시만 되고 값이 새 키로 옮겨지지 않아, 옛 키를 쓰면 기동은 성공한 채 구현만
 * HttpClient5 로 바뀌어 다른 테스트로는 드러나지 않는다.
 *
 * <p>- 서버 JSON 변환기: Boot 기본 Jackson 3 {@code JacksonJsonHttpMessageConverter} 가 Boot 의 {@code
 * JsonMapper} 빈(우리 {@code @JacksonComponent}·{@code spring.jackson.use-jackson2-defaults} 가 적용된 것)을
 * 쓴다(WP-1609). 다른 매퍼를 쓰는 변환기가 끼면 그 설정이 HTTP 경로에서 빠져 응답·400 문구가 바뀐다.
 *
 * <p>정적 {@code RestClient.builder()} 로 만드는 호출 클라이언트 쪽은 {@code OutboundJsonMapperTest} 가 본다.
 */
class HttpBootDefaultsIntegrationTest extends IntegrationTestBase {

  @Autowired private ClientHttpRequestFactoryBuilder<?> factoryBuilder;
  @Autowired private RequestMappingHandlerAdapter handlerAdapter;
  @Autowired private JsonMapper jsonMapper;

  @Test
  void 자동_구성_HTTP_클라이언트_구현은_JDK_다() {
    assertThat(factoryBuilder).isInstanceOf(JdkClientHttpRequestFactoryBuilder.class);
  }

  @Test
  void 서버_JSON_변환기는_Boot_의_Jackson3_JsonMapper_를_쓴다() {
    List<HttpMessageConverter<?>> converters = handlerAdapter.getMessageConverters();
    // Jackson 2 변환기가 남아 있으면 그쪽이 먼저 골라질 수 있으므로 아예 없어야 한다.
    assertThat(converters)
        .noneMatch(c -> c.getClass().getName().endsWith("MappingJackson2HttpMessageConverter"));
    // Jackson 3 변환기가 컨텍스트의 JsonMapper 빈(우리 설정·@JacksonComponent 가 적용된 것)을 그대로 써야 한다.
    assertThat(converters)
        .filteredOn(JacksonJsonHttpMessageConverter.class::isInstance)
        .map(c -> ((JacksonJsonHttpMessageConverter) c).getMapper())
        .containsOnly(jsonMapper)
        .isNotEmpty();
  }

  /**
   * Boot 매퍼가 Jackson 2 때(Boot 의 Jackson 2 자동 구성)와 같은 기본값인지 — Jackson 3 기본값(속성 알파벳 정렬, null → 기본형
   * 실패)이면 응답 속성 순서·요청 해석이 조용히 바뀐다(WP-1609).
   */
  @Test
  void Boot_JsonMapper_는_Jackson2_때_기본값이다() {
    assertThat(jsonMapper.isEnabled(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY)).isFalse();
    assertThat(jsonMapper.isEnabled(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)).isFalse();
    assertThat(jsonMapper.isEnabled(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)).isFalse();
    assertThat(jsonMapper.isEnabled(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)).isFalse();
    // Boot 3(Jackson 2) 때 ParameterNamesModule 처럼 생성자 파라미터 이름을 읽는다.
    assertThat(jsonMapper.isEnabled(MapperFeature.DETECT_PARAMETER_NAMES)).isTrue();
    // 날짜·시각은 Jackson 2 때 Boot 기본처럼 ISO 문자열로 쓴다.
    assertThat(jsonMapper.isEnabled(DateTimeFeature.WRITE_DATES_AS_TIMESTAMPS)).isFalse();
    // 읽기·쓰기 한도도 Jackson 2 기본값(문자열 20,000,000자·중첩 1000 단계) — use-jackson2-defaults 가 바꾸지 않아
    // application.yml 로 맞춘다.
    var read = jsonMapper.tokenStreamFactory().streamReadConstraints();
    assertThat(read.getMaxStringLength()).isEqualTo(20_000_000);
    assertThat(read.getMaxNestingDepth()).isEqualTo(1000);
    assertThat(jsonMapper.tokenStreamFactory().streamWriteConstraints().getMaxNestingDepth())
        .isEqualTo(1000);
  }

  /** SSE 직렬화 견본 — 날짜·시각·기간 타입을 모두 담는다. */
  record SseDateSample(
      Instant instant,
      LocalDateTime localDateTime,
      LocalDate localDate,
      OffsetDateTime offsetDateTime,
      Duration duration) {}

  /**
   * WP-2046: SSE payload 직렬화({@link SseRegistry#toJson}, 정적 매퍼)가 날짜·시각·기간을 REST(Boot 매퍼)와 같은 모양으로
   * 쓴다. 두 매퍼가 따로 설정돼 있어, 한쪽만 바뀌면 SSE 로 받은 시각을 웹이 읽지 못해 화면이 깨진다(채널 메시지 createdAt 이 epoch 숫자로 나갔던
   * 결함). 특정 이벤트가 아니라 타입 견본으로 모든 SSE 이벤트의 형식 어긋남을 잡는다.
   */
  @Test
  void SSE_직렬화는_날짜_시각_기간을_Boot_매퍼와_같게_쓴다() {
    SseDateSample sample =
        new SseDateSample(
            Instant.parse("2026-11-24T11:00:04.246320Z"),
            LocalDateTime.parse("2026-11-24T20:00:04.246"),
            LocalDate.parse("2026-11-24"),
            OffsetDateTime.parse("2026-11-24T20:00:04+09:00"),
            Duration.ofSeconds(5));
    assertThat(SseRegistry.toJson(sample)).isEqualTo(jsonMapper.writeValueAsString(sample));
  }
}

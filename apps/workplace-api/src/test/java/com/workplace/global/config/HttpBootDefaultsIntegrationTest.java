package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.JdkClientHttpRequestFactoryBuilder;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter;

/**
 * Spring Boot 4 로 올리며(WP-1588) 설정 키 이름·기본값이 바뀌어 "오류 없이 조용히" 동작이 달라질 수 있는 HTTP 기본 구성을 고정한다.
 *
 * <p>- 외부 호출 HTTP 구현: {@code spring.http.clients.imperative.factory=jdk}(옛 이름 {@code
 * spring.http.client.factory}). 옛 키는 deprecated 로 표시만 되고 값이 새 키로 옮겨지지 않아, 옛 키를 쓰면 기동은 성공한 채 구현만
 * HttpClient5 로 바뀌어 다른 테스트로는 드러나지 않는다.
 *
 * <p>- 서버 JSON 변환기: {@code spring.http.converters.preferred-json-mapper=jackson2}. Boot 4 기본은
 * Jackson 3 이라, 빠지면 우리 Jackson 2 ObjectMapper 설정·@JsonComponent 가 HTTP 경로에서 빠진다.
 *
 * <p>정적 {@code RestClient.builder()} 로 만드는 호출 클라이언트 쪽은 {@code OutboundJsonMapperTest} 가 본다.
 */
class HttpBootDefaultsIntegrationTest extends IntegrationTestBase {

  @Autowired private ClientHttpRequestFactoryBuilder<?> factoryBuilder;
  @Autowired private RequestMappingHandlerAdapter handlerAdapter;
  @Autowired private ObjectMapper objectMapper;

  @Test
  void 자동_구성_HTTP_클라이언트_구현은_JDK_다() {
    assertThat(factoryBuilder).isInstanceOf(JdkClientHttpRequestFactoryBuilder.class);
  }

  @Test
  @SuppressWarnings("removal")
  void 서버_JSON_변환기는_앱의_Jackson2_ObjectMapper_를_쓴다() {
    List<HttpMessageConverter<?>> converters = handlerAdapter.getMessageConverters();
    // Jackson 3 변환기(tools.jackson 기반)가 끼어 있으면 Jackson 2 변환기보다 먼저 골라질 수 있으므로 아예 없어야 한다.
    assertThat(converters)
        .noneMatch(c -> c.getClass().getName().endsWith("JacksonJsonHttpMessageConverter"));
    // Jackson 2 변환기가 컨텍스트의 ObjectMapper 빈(우리 설정·@JsonComponent 가 적용된 것)을 그대로 써야 한다.
    assertThat(converters)
        .filteredOn(MappingJackson2HttpMessageConverter.class::isInstance)
        .map(c -> ((MappingJackson2HttpMessageConverter) c).getObjectMapper())
        .containsOnly(objectMapper)
        .isNotEmpty();
  }
}

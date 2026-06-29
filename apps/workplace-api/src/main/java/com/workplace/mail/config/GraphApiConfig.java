package com.workplace.mail.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphCalendarClient;
import java.net.http.HttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Graph API 관련 스프링 빈 구성.
 *
 * <p>{@link GraphApiClient} 는 {@code java.net.http.HttpClient} 를 사용하므로 Spring의 RestClient 대신 JDK 내장
 * 클라이언트를 직접 구성한다.
 */
@Configuration
public class GraphApiConfig {

  /**
   * Microsoft Graph API / AAD 토큰 엔드포인트 HTTP 클라이언트 빈.
   *
   * <p>HttpClient 기본 설정(커넥션풀, HTTP/2 지원)으로 생성한다. 테스트에서는 {@code @MockBean GraphApiClient} 로 대체된다.
   */
  @Bean
  public GraphApiClient graphApiClient(ObjectMapper objectMapper, M365GraphProperties props) {
    HttpClient httpClient = HttpClient.newHttpClient();
    return new GraphApiClient(httpClient, objectMapper, props);
  }

  /**
   * Graph 캘린더 읽기/쓰기 클라이언트 빈.
   *
   * <p>{@link GraphApiClient} 와 {@link ObjectMapper} 를 주입받아 /me/calendars·/calendarView 조회 및 일정
   * 생성·수정·삭제를 담당한다.
   */
  @Bean
  public GraphCalendarClient graphCalendarClient(
      GraphApiClient graphApiClient, ObjectMapper objectMapper) {
    return new GraphCalendarClient(graphApiClient, objectMapper);
  }
}

package com.workplace.wiki.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.wiki.exception.CollabRequestRejectedException;
import com.workplace.wiki.exception.CollabUnavailableException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import java.io.IOException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * CollabClient 의 동기화 서버 응답 → API 예외 매핑. 페이지가 없어진 것(404·410)은 일시 장애(503)가 아니라 not-found(404) 여야 호출자가
 * 재시도하지 않고, 우리 요청이 틀린 4xx 는 서버 버그라 500 이어야 한다. 503 은 연결 실패·타임아웃·5xx 에만 남긴다.
 */
class CollabClientTest {
  private static final String URL = "http://collab.test/internal/docs/7/apply-markdown";

  private MockRestServiceServer server;
  private CollabClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://collab.test");
    // CollabClient 생성자가 build() 하므로 목 서버를 먼저 묶는다.
    server = MockRestServiceServer.bindTo(builder).build();
    client = new CollabClient(builder, "tok");
  }

  private void apply() {
    client.applyMarkdown(1L, 7L, "본문", 3L, "협업자", false);
  }

  @Test
  void 성공_응답을_파싱한다() {
    server
        .expect(requestTo(URL))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess("{\"version\":4,\"body\":\"본문\"}", MediaType.APPLICATION_JSON));
    var res = client.applyMarkdown(1L, 7L, "본문", 3L, "협업자", false);
    assertThat(res.version()).isEqualTo(4);
    server.verify();
  }

  @Test
  void 동기화_서버_404는_페이지_없음이다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.NOT_FOUND));
    assertThatThrownBy(this::apply).isInstanceOf(WikiPageNotFoundException.class);
  }

  @Test
  void 동기화_서버_410도_페이지_없음이다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.GONE));
    assertThatThrownBy(this::apply).isInstanceOf(WikiPageNotFoundException.class);
  }

  @Test
  void 그_밖의_4xx는_일시_장애가_아니라_요청_거부다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.BAD_REQUEST));
    assertThatThrownBy(this::apply)
        .isInstanceOf(CollabRequestRejectedException.class)
        .isNotInstanceOf(CollabUnavailableException.class);
  }

  @Test
  void 서버_5xx는_일시_장애_503이다() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
    assertThatThrownBy(this::apply).isInstanceOf(CollabUnavailableException.class);
  }

  @Test
  void 연결_실패는_일시_장애_503이다() {
    server.expect(requestTo(URL)).andRespond(withException(new IOException("connection refused")));
    assertThatThrownBy(this::apply).isInstanceOf(CollabUnavailableException.class);
  }
}

package com.workplace.mail.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.mail.config.M365GraphProperties;
import com.workplace.mail.exception.MailSendException;
import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;

/** GraphApiClient 쓰기 메서드(post/delete) 단위 테스트 — HttpClient 를 모킹해 상태코드 처리를 검증한다. */
class GraphApiClientWriteTest {

  // M365GraphProperties 는 record — 테스트에서는 null 필드로 인스턴스 생성(네트워크 미호출이므로 무방)
  private final M365GraphProperties props = new M365GraphProperties(null, null, null, null);

  /** 지정 상태코드·바디를 반환하는 HttpResponse 스텁. */
  @SuppressWarnings("unchecked")
  private HttpClient clientReturning(int status, String body) throws Exception {
    HttpResponse<String> resp = mock(HttpResponse.class);
    doReturn(status).when(resp).statusCode();
    doReturn(body).when(resp).body();
    HttpClient http = mock(HttpClient.class);
    // send() 는 제네릭 반환형이라 타입 추론을 위해 doReturn 사용
    doReturn(resp).when(http).send(any(), any());
    return http;
  }

  record CreatedId(String id) {}

  @Test
  void post_parses_2xx_body() throws Exception {
    HttpClient http = clientReturning(201, "{\"id\":\"AAA123\"}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);
    CreatedId out = api.post("tok", "/me/calendars/c1/events", "{}", CreatedId.class);
    assertThat(out.id()).isEqualTo("AAA123");
  }

  @Test
  void post_throws_on_non_2xx() throws Exception {
    HttpClient http = clientReturning(400, "{\"error\":{\"code\":\"ErrorInvalidIdMalformed\"}}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);
    assertThatThrownBy(() -> api.post("tok", "/me/calendars/c1/events", "{}", CreatedId.class))
        .isInstanceOf(MailSendException.class);
  }

  @Test
  void delete_treats_404_as_success() throws Exception {
    HttpClient http = clientReturning(404, "{\"error\":{\"code\":\"ErrorItemNotFound\"}}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);
    api.delete("tok", "/me/events/gone"); // 예외 없이 통과해야 함
  }

  @Test
  void delete_throws_on_500() throws Exception {
    HttpClient http = clientReturning(500, "{}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);
    assertThatThrownBy(() -> api.delete("tok", "/me/events/x"))
        .isInstanceOf(MailSendException.class);
  }
}

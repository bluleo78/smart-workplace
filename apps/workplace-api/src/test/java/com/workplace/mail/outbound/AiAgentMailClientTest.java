package com.workplace.mail.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.MailAiMessages.ClassifyRequest;
import com.workplace.mail.outbound.MailAiMessages.ClassifyResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class AiAgentMailClientTest {

  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private AiAgentMailClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new AiAgentMailClient(builder, "tok-123");
  }

  @Test
  void 분류_정상_역직렬화() {
    server
        .expect(requestTo("http://ai-agent.test/mail/classify"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andRespond(
            withSuccess("{\"category\":\"업무\",\"needsReply\":true}", MediaType.APPLICATION_JSON));

    ClassifyResult r = client.classify(new ClassifyRequest("s", "a@b", "x", 5L, "m", 1, 60000));
    assertThat(r.category()).isEqualTo("업무");
    assertThat(r.needsReply()).isTrue();
    server.verify();
  }

  @Test
  void 서버오류_무재시도_MailAiException() {
    server.expect(requestTo("http://ai-agent.test/mail/classify")).andRespond(withServerError());
    assertThatThrownBy(
            () -> client.classify(new ClassifyRequest("s", "a@b", "x", 5L, "m", 1, 60000)))
        .isInstanceOf(MailAiException.class);
    server.verify();
  }

  @Test
  void _503_은_MailAiUnavailableException() {
    server
        .expect(requestTo("http://ai-agent.test/mail/classify"))
        .andRespond(
            withStatus(HttpStatus.SERVICE_UNAVAILABLE)
                .body("{}")
                .contentType(MediaType.APPLICATION_JSON));
    assertThatThrownBy(
            () -> client.classify(new ClassifyRequest("s", "a@b", "x", 5L, "m", 1, 60000)))
        .isInstanceOf(MailAiUnavailableException.class);
    server.verify();
  }
}

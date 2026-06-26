package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.mail.config.M365GraphProperties;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** GraphApiClient 쓰기 경로(sendMail/patch) 단위 테스트 — 실제 HTTP 미호출(HttpClient mock). */
class GraphApiClientWriteTest {

  private final M365GraphProperties props =
      new M365GraphProperties("client", "tenant", "secret", "https://cb");

  @Test
  void sendMail_postsBase64MimeAsTextPlain() throws Exception {
    HttpClient http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(202);
    doReturn(resp).when(http).send(any(), any());
    GraphApiClient client = new GraphApiClient(http, new ObjectMapper(), props);

    client.sendMail("TOKEN", "QkFTRTY0TUlNRQ==");

    ArgumentCaptor<HttpRequest> cap = ArgumentCaptor.forClass(HttpRequest.class);
    org.mockito.Mockito.verify(http).send(cap.capture(), any());
    HttpRequest req = cap.getValue();
    assertThat(req.uri().toString()).endsWith("/me/sendMail");
    assertThat(req.method()).isEqualTo("POST");
    assertThat(req.headers().firstValue("Content-Type")).hasValue("text/plain");
    assertThat(req.headers().firstValue("Authorization")).hasValue("Bearer TOKEN");
  }

  @Test
  void sendMail_throwsOnNon2xx() throws Exception {
    HttpClient http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(403);
    when(resp.body()).thenReturn("{\"error\":{\"code\":\"ErrorAccessDenied\"}}");
    doReturn(resp).when(http).send(any(), any());
    GraphApiClient client = new GraphApiClient(http, new ObjectMapper(), props);

    assertThatThrownBy(() -> client.sendMail("TOKEN", "x")).isInstanceOf(MailSendException.class);
  }

  @Test
  void patch_sendsJsonBody() throws Exception {
    HttpClient http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(200);
    doReturn(resp).when(http).send(any(), any());
    GraphApiClient client = new GraphApiClient(http, new ObjectMapper(), props);

    client.patch("TOKEN", "/me/messages/AAA", "{\"isRead\":true}");

    ArgumentCaptor<HttpRequest> cap = ArgumentCaptor.forClass(HttpRequest.class);
    org.mockito.Mockito.verify(http).send(cap.capture(), any());
    HttpRequest req = cap.getValue();
    assertThat(req.uri().toString()).endsWith("/me/messages/AAA");
    assertThat(req.method()).isEqualTo("PATCH");
    assertThat(req.headers().firstValue("Content-Type")).hasValue("application/json");
  }

  @Test
  void scope_includesMailSend() {
    assertThat(M365GraphProperties.SCOPE).contains("Mail.Send");
  }
}

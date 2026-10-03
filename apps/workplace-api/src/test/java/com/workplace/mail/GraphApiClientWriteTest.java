package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.mail.config.M365GraphProperties;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** GraphApiClient 쓰기 경로(sendMail/patch/batch) 단위 테스트 — 실제 HTTP 미호출(HttpClient mock). */
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

  /** WP-187: $batch 요청은 requests[].id/method/url/headers/body 로 직렬화되고, 응답은 순서가 섞여도 id 로 짝지어진다. */
  @Test
  void batch_serializesRequests_andMapsResponsesById() throws Exception {
    HttpClient http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(200);
    when(resp.body())
        .thenReturn(
            "{\"responses\":[{\"id\":\"22\",\"status\":429,\"headers\":{\"Retry-After\":\"5\"}},"
                + "{\"id\":\"11\",\"status\":200,\"body\":{}}]}");
    doReturn(resp).when(http).send(any(), any());
    ObjectMapper mapper = new ObjectMapper();
    GraphApiClient client = new GraphApiClient(http, mapper, props);

    List<GraphBatchResponse> out =
        client.batch(
            "TOKEN",
            List.of(
                new GraphBatchRequest("11", "PATCH", "/me/messages/A", Map.of("isRead", true)),
                new GraphBatchRequest("22", "PATCH", "/me/messages/B", Map.of("isRead", false))));

    ArgumentCaptor<HttpRequest> cap = ArgumentCaptor.forClass(HttpRequest.class);
    org.mockito.Mockito.verify(http).send(cap.capture(), any());
    HttpRequest req = cap.getValue();
    assertThat(req.uri().toString()).endsWith("/v1.0/$batch");
    assertThat(req.method()).isEqualTo("POST");
    assertThat(req.headers().firstValue("Content-Type")).hasValue("application/json");
    JsonNode reqs = mapper.readTree(bodyOf(req)).path("requests");
    assertThat(reqs).hasSize(2);
    JsonNode first = reqs.get(0);
    assertThat(first.path("id").asText()).isEqualTo("11");
    assertThat(first.path("method").asText()).isEqualTo("PATCH");
    assertThat(first.path("url").asText()).isEqualTo("/me/messages/A");
    assertThat(first.path("headers").path("Content-Type").asText()).isEqualTo("application/json");
    assertThat(first.path("body").path("isRead").asBoolean()).isTrue();
    assertThat(reqs.get(1).path("body").path("isRead").asBoolean()).isFalse();
    assertThat(out)
        .containsExactlyInAnyOrder(
            new GraphBatchResponse("11", 200), new GraphBatchResponse("22", 429));
  }

  /** WP-187: $batch 최상위 응답이 2xx 가 아니면 예외 — 호출 측이 대기 표시를 유지한다. */
  @Test
  void batch_throwsOnNon2xx() throws Exception {
    HttpClient http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(503);
    when(resp.body()).thenReturn("{}");
    doReturn(resp).when(http).send(any(), any());
    GraphApiClient client = new GraphApiClient(http, new ObjectMapper(), props);

    assertThatThrownBy(
            () ->
                client.batch(
                    "TOKEN",
                    List.of(
                        new GraphBatchRequest(
                            "1", "PATCH", "/me/messages/A", Map.of("isRead", true)))))
        .isInstanceOf(MailSendException.class);
  }

  /** HttpRequest 의 본문 publisher 를 구독해 UTF-8 문자열로 모은다(JDK HttpRequest 는 본문 getter 가 없다). */
  private static String bodyOf(HttpRequest req) throws Exception {
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    CompletableFuture<String> done = new CompletableFuture<>();
    req.bodyPublisher()
        .orElseThrow()
        .subscribe(
            new Flow.Subscriber<ByteBuffer>() {
              @Override
              public void onSubscribe(Flow.Subscription s) {
                s.request(Long.MAX_VALUE);
              }

              @Override
              public void onNext(ByteBuffer b) {
                byte[] bytes = new byte[b.remaining()];
                b.get(bytes);
                buf.writeBytes(bytes);
              }

              @Override
              public void onError(Throwable t) {
                done.completeExceptionally(t);
              }

              @Override
              public void onComplete() {
                done.complete(buf.toString(StandardCharsets.UTF_8));
              }
            });
    return done.get(5, TimeUnit.SECONDS);
  }

  @Test
  void scope_includesMailSend() {
    assertThat(M365GraphProperties.SCOPE).contains("Mail.Send");
  }
}

package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

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
    GraphApiClient client =
        new GraphApiClient(http, JsonMapper.builderWithJackson2Defaults().build(), props);

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
    GraphApiClient client =
        new GraphApiClient(http, JsonMapper.builderWithJackson2Defaults().build(), props);

    assertThatThrownBy(() -> client.sendMail("TOKEN", "x")).isInstanceOf(MailSendException.class);
  }

  @Test
  void patch_sendsJsonBody() throws Exception {
    HttpClient http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(200);
    doReturn(resp).when(http).send(any(), any());
    GraphApiClient client =
        new GraphApiClient(http, JsonMapper.builderWithJackson2Defaults().build(), props);

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
    ObjectMapper mapper = JsonMapper.builderWithJackson2Defaults().build();
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
    assertThat(first.path("id").asString()).isEqualTo("11");
    assertThat(first.path("method").asString()).isEqualTo("PATCH");
    assertThat(first.path("url").asString()).isEqualTo("/me/messages/A");
    assertThat(first.path("headers").path("Content-Type").asString()).isEqualTo("application/json");
    assertThat(first.path("body").path("isRead").asBoolean()).isTrue();
    assertThat(reqs.get(1).path("body").path("isRead").asBoolean()).isFalse();
    assertThat(out)
        .extracting(GraphBatchResponse::id, GraphBatchResponse::status)
        .containsExactlyInAnyOrder(
            org.assertj.core.groups.Tuple.tuple("11", 200),
            org.assertj.core.groups.Tuple.tuple("22", 429));
    // WP-962: 항목 본문이 있으면 싣고(옮기기의 새 id), 없으면 null
    assertThat(out)
        .filteredOn(r -> r.id().equals("11"))
        .singleElement()
        .satisfies(r -> assertThat(r.body()).isNotNull());
    assertThat(out)
        .filteredOn(r -> r.id().equals("22"))
        .singleElement()
        .satisfies(r -> assertThat(r.body()).isNull());
  }

  /**
   * WP-1682: 항목 응답의 {@code headers} 에서 Retry-After 를 이름 대소문자와 상관없이 정수 초로 읽는다 — 휴지통 비우기가 429 항목을 그만큼
   * 기다려 다시 보낸다. 숫자가 아니거나 헤더가 없으면 null(호출 측이 기본 대기를 쓴다).
   */
  @Test
  void batch_readsItemRetryAfter() throws Exception {
    HttpClient http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(200);
    when(resp.body())
        .thenReturn(
            "{\"responses\":["
                + "{\"id\":\"1\",\"status\":429,\"headers\":{\"Retry-After\":\"7\"}},"
                + "{\"id\":\"2\",\"status\":429,\"headers\":{\"retry-after\":\"x\"}},"
                + "{\"id\":\"3\",\"status\":204},"
                + "{\"id\":\"4\",\"status\":503,\"headers\":{\"RETRY-AFTER\":\"12\"}}]}");
    doReturn(resp).when(http).send(any(), any());
    GraphApiClient client =
        new GraphApiClient(http, JsonMapper.builderWithJackson2Defaults().build(), props);

    List<GraphBatchResponse> out =
        client.batch(
            "TOKEN",
            List.of(
                new GraphBatchRequest("1", "POST", "/me/messages/A/permanentDelete", Map.of())));

    assertThat(out)
        .extracting(GraphBatchResponse::id, GraphBatchResponse::retryAfterSeconds)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple("1", 7),
            org.assertj.core.groups.Tuple.tuple("2", null),
            org.assertj.core.groups.Tuple.tuple("3", null),
            org.assertj.core.groups.Tuple.tuple("4", 12));
    // 기존 2·3인자 생성자는 Retry-After 없음
    assertThat(new GraphBatchResponse("9", 200).retryAfterSeconds()).isNull();
    assertThat(new GraphBatchResponse("9", 200, null).retryAfterSeconds()).isNull();
  }

  /**
   * WP-1682: 본문이 null 인 요청(휴지통 메일 위치 확인 GET)은 body·Content-Type 없이 싣고, 본문이 있는 요청은 그대로 둘 다 싣는다 — GET
   * 에 본문을 붙여 보내지 않게.
   */
  @Test
  void batch_omitsBodyAndContentType_whenBodyIsNull() throws Exception {
    HttpClient http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(200);
    when(resp.body()).thenReturn("{\"responses\":[]}");
    doReturn(resp).when(http).send(any(), any());
    ObjectMapper mapper = JsonMapper.builderWithJackson2Defaults().build();
    GraphApiClient client = new GraphApiClient(http, mapper, props);

    client.batch(
        "TOKEN",
        List.of(
            new GraphBatchRequest("1", "GET", "/me/messages/A?$select=id,parentFolderId", null),
            new GraphBatchRequest("2", "POST", "/me/messages/B/permanentDelete", Map.of())));

    ArgumentCaptor<HttpRequest> cap = ArgumentCaptor.forClass(HttpRequest.class);
    org.mockito.Mockito.verify(http).send(cap.capture(), any());
    JsonNode reqs = mapper.readTree(bodyOf(cap.getValue())).path("requests");
    assertThat(reqs.get(0).path("method").asString()).isEqualTo("GET");
    assertThat(reqs.get(0).has("body")).isFalse();
    assertThat(reqs.get(0).has("headers")).isFalse();
    assertThat(reqs.get(1).has("body")).isTrue();
    assertThat(reqs.get(1).path("headers").path("Content-Type").asString())
        .isEqualTo("application/json");
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
    GraphApiClient client =
        new GraphApiClient(http, JsonMapper.builderWithJackson2Defaults().build(), props);

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

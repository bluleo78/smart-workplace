package com.workplace.mail.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.mail.config.M365GraphProperties;
import com.workplace.mail.exception.MailSendException;
import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

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

  // ---- WP-574: 큰 메일 경로(초안·첨부·업로드 세션·send) HTTP 요청 모양 ----

  /** 보낸 요청 1건을 캡처한다. */
  private static HttpRequest captured(HttpClient http) throws Exception {
    ArgumentCaptor<HttpRequest> cap = ArgumentCaptor.forClass(HttpRequest.class);
    verify(http).send(cap.capture(), any());
    return cap.getValue();
  }

  /** BodyPublisher 를 구독해 요청 본문 바이트를 모은다. */
  private static byte[] bodyOf(HttpRequest req) throws Exception {
    HttpRequest.BodyPublisher pub = req.bodyPublisher().orElseThrow();
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    CompletableFuture<Void> done = new CompletableFuture<>();
    pub.subscribe(
        new Flow.Subscriber<ByteBuffer>() {
          @Override
          public void onSubscribe(Flow.Subscription s) {
            s.request(Long.MAX_VALUE);
          }

          @Override
          public void onNext(ByteBuffer item) {
            byte[] b = new byte[item.remaining()];
            item.get(b);
            out.writeBytes(b);
          }

          @Override
          public void onError(Throwable t) {
            done.completeExceptionally(t);
          }

          @Override
          public void onComplete() {
            done.complete(null);
          }
        });
    done.get(5, TimeUnit.SECONDS);
    return out.toByteArray();
  }

  @Test
  void createDraftFromMime_postsBase64MimeAsTextPlain_andReturnsId() throws Exception {
    HttpClient http =
        clientReturning(
            201,
            "{\"id\":\"DRAFT-1\",\"isDraft\":true,\"internetMessageId\":\"<x@prod.outlook.com>\"}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);

    GraphApiClient.DraftRef draft = api.createDraftFromMime("tok", "TUlNRQ==");

    assertThat(draft.id()).isEqualTo("DRAFT-1");
    assertThat(draft.internetMessageId()).isEqualTo("<x@prod.outlook.com>");
    HttpRequest req = captured(http);
    assertThat(req.method()).isEqualTo("POST");
    assertThat(req.uri().toString()).isEqualTo("https://graph.microsoft.com/v1.0/me/messages");
    assertThat(req.headers().firstValue("Content-Type")).hasValue("text/plain");
    assertThat(req.headers().firstValue("Authorization")).hasValue("Bearer tok");
    assertThat(new String(bodyOf(req), StandardCharsets.UTF_8)).isEqualTo("TUlNRQ==");
  }

  @Test
  void createDraftFromMime_missingId_throws() throws Exception {
    HttpClient http = clientReturning(201, "{}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);
    assertThatThrownBy(() -> api.createDraftFromMime("tok", "x"))
        .isInstanceOf(MailSendException.class);
  }

  @Test
  void addFileAttachment_postsFileAttachmentJson() throws Exception {
    HttpClient http = clientReturning(201, "{\"id\":\"A1\"}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);
    byte[] content = {1, 2, 3, (byte) 0xFF};

    api.addFileAttachment("tok", "D1", "한글.pdf", "application/pdf", content);

    HttpRequest req = captured(http);
    assertThat(req.method()).isEqualTo("POST");
    assertThat(req.uri().getPath()).isEqualTo("/v1.0/me/messages/D1/attachments");
    JsonNode body = new ObjectMapper().readTree(bodyOf(req));
    assertThat(body.path("@odata.type").asText()).isEqualTo("#microsoft.graph.fileAttachment");
    assertThat(body.path("name").asText()).isEqualTo("한글.pdf");
    assertThat(body.path("contentType").asText()).isEqualTo("application/pdf");
    assertThat(Base64.getDecoder().decode(body.path("contentBytes").asText())).isEqualTo(content);
  }

  @Test
  void createAttachmentUploadSession_postsAttachmentItem_andReturnsUploadUrl() throws Exception {
    HttpClient http = clientReturning(201, "{\"uploadUrl\":\"https://outlook.office.com/up/1\"}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);

    String url = api.createAttachmentUploadSession("tok", "D1", "big.mp4", "video/mp4", 7_000_000L);

    assertThat(url).isEqualTo("https://outlook.office.com/up/1");
    HttpRequest req = captured(http);
    assertThat(req.uri().getPath())
        .isEqualTo("/v1.0/me/messages/D1/attachments/createUploadSession");
    JsonNode item = new ObjectMapper().readTree(bodyOf(req)).path("AttachmentItem");
    assertThat(item.path("attachmentType").asText()).isEqualTo("file");
    assertThat(item.path("name").asText()).isEqualTo("big.mp4");
    assertThat(item.path("size").asLong()).isEqualTo(7_000_000L);
    assertThat(item.path("contentType").asText()).isEqualTo("video/mp4");
  }

  /** 조각 PUT — 사전 인증 URL 이라 Authorization 없음, Content-Range 는 끝 포함 표기, 본문은 그 조각만. */
  @Test
  void uploadAttachmentChunk_putsRangeWithoutAuthorization() throws Exception {
    HttpClient http = clientReturning(200, "{\"nextExpectedRanges\":[\"4-\"]}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);
    byte[] content = {10, 11, 12, 13, 14, 15, 16, 17, 18, 19};

    api.uploadAttachmentChunk("https://outlook.office.com/up/1", content, 4, 8);

    HttpRequest req = captured(http);
    assertThat(req.method()).isEqualTo("PUT");
    assertThat(req.uri().toString()).isEqualTo("https://outlook.office.com/up/1");
    assertThat(req.headers().firstValue("Authorization")).isEmpty();
    assertThat(req.headers().firstValue("Content-Range")).hasValue("bytes 4-7/10");
    assertThat(bodyOf(req)).containsExactly(14, 15, 16, 17);
  }

  @Test
  void uploadAttachmentChunk_throwsOnNon2xx() throws Exception {
    HttpClient http = clientReturning(416, "{}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);
    assertThatThrownBy(() -> api.uploadAttachmentChunk("https://u/1", new byte[4], 0, 4))
        .isInstanceOf(MailSendException.class);
  }

  @Test
  void sendDraft_postsToSendEndpoint() throws Exception {
    HttpClient http = clientReturning(202, "");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);

    api.sendDraft("tok", "D1");

    HttpRequest req = captured(http);
    assertThat(req.method()).isEqualTo("POST");
    assertThat(req.uri().getPath()).isEqualTo("/v1.0/me/messages/D1/send");
    assertThat(req.headers().firstValue("Authorization")).hasValue("Bearer tok");
  }

  /** 초안의 실제 internetMessageId 조회 — $select 로 그 필드만 읽는다(WP-574). */
  @Test
  void getInternetMessageId_selectsField() throws Exception {
    HttpClient http = clientReturning(200, "{\"internetMessageId\":\"<y@prod.outlook.com>\"}");
    GraphApiClient api = new GraphApiClient(http, new ObjectMapper(), props);

    assertThat(api.getInternetMessageId("tok", "D1")).isEqualTo("<y@prod.outlook.com>");
    HttpRequest req = captured(http);
    assertThat(req.method()).isEqualTo("GET");
    assertThat(req.uri().getPath()).isEqualTo("/v1.0/me/messages/D1");
    assertThat(req.uri().getQuery()).isEqualTo("$select=internetMessageId");
  }
}

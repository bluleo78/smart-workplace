package com.workplace.fileai.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.workplace.fileai.exception.AttachmentViewException;
import com.workplace.fileai.outbound.WorkerRenderClient.RenderResult;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * WorkerRenderClient 단위 테스트(WP-250) — 로컬 HttpServer 로 워커 /render 를 흉내 내 요청 헤더·본문과 응답·오류 매핑을 검증한다.
 *
 * <p>Spring 컨텍스트·DB 없이 돈다. 오류 매핑이 핵심이다: 워커의 사용자 쪽 4xx 코드는 그대로 전하고, 워커 장애·서버 쪽 결함은 모두 503
 * WORKER_UNAVAILABLE 로 모은다(모델에게 "다시 올려 달라" 같은 잘못된 안내가 가지 않게).
 */
class WorkerRenderClientTest {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private HttpServer server;
  private final AtomicReference<String> body = new AtomicReference<>();
  private final AtomicReference<String> auth = new AtomicReference<>();
  private final AtomicInteger hits = new AtomicInteger();

  /** 다음 응답 — 상태·Content-Type·X-Page-Count·본문. 테스트마다 바꾼다. */
  private volatile Stub stub;

  private record Stub(int status, String contentType, String pageCount, byte[] body) {}

  @BeforeEach
  void setUp() throws Exception {
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/render",
        ex -> {
          hits.incrementAndGet();
          body.set(new String(ex.getRequestBody().readAllBytes()));
          auth.set(ex.getRequestHeaders().getFirst("Authorization"));
          Stub s = stub;
          ex.getResponseHeaders().add("Content-Type", s.contentType());
          if (s.pageCount() != null) ex.getResponseHeaders().add("X-Page-Count", s.pageCount());
          ex.sendResponseHeaders(s.status(), s.body().length);
          ex.getResponseBody().write(s.body());
          ex.close();
        });
    server.start();
  }

  @AfterEach
  void tearDown() {
    server.stop(0);
  }

  private WorkerRenderClient client(boolean enabled) {
    var props =
        new WorkerProperties(
            "http://127.0.0.1:" + server.getAddress().getPort(),
            "tok",
            enabled,
            null,
            new WorkerProperties.Render(1568, 5));
    return new WorkerRenderClient(props);
  }

  private void json(int status, String json) {
    stub = new Stub(status, "application/json", null, json.getBytes());
  }

  @Test
  void 성공이면_바이트_형식_페이지수를_돌려주고_인증헤더와_본문을_보낸다() throws Exception {
    byte[] png = {(byte) 0x89, 'P', 'N', 'G', 1, 2, 3};
    stub = new Stub(200, "image/png", "3", png);

    RenderResult r = client(true).render("t/1/a.pdf", "application/pdf", 2, 1568);

    assertThat(r.data()).isEqualTo(png);
    assertThat(r.contentType()).isEqualTo("image/png");
    assertThat(r.pageCount()).isEqualTo(3);
    assertThat(auth.get()).isEqualTo("Internal tok");
    JsonNode sent = MAPPER.readTree(body.get());
    assertThat(sent.get("storageKey").asText()).isEqualTo("t/1/a.pdf");
    assertThat(sent.get("mime").asText()).isEqualTo("application/pdf");
    assertThat(sent.get("page").asInt()).isEqualTo(2);
    assertThat(sent.get("maxEdge").asInt()).isEqualTo(1568);
  }

  @Test
  void 이미지는_page_를_null_로_보내고_페이지수_없이_jpeg_를_받는다() throws Exception {
    // Content-Type 파라미터는 떼어 낸다.
    stub = new Stub(200, "image/jpeg; q=85", null, new byte[] {1, 2});

    RenderResult r = client(true).render("t/1/a.heic", "image/heic", null, 1568);

    assertThat(r.contentType()).isEqualTo("image/jpeg");
    assertThat(r.pageCount()).isNull();
    JsonNode sent = MAPPER.readTree(body.get());
    assertThat(sent.has("page")).isTrue();
    assertThat(sent.get("page").isNull()).isTrue();
  }

  /** 형식은 정확히 image/png · image/jpeg 로 맞춘다 — 캐시 적중(확장자로 정함)과 새로 그린 응답이 같은 값을 내게. */
  @Test
  void 응답_형식은_png_jpeg_둘로_정규화하고_그밖은_503() {
    stub = new Stub(200, "IMAGE/JPG", null, new byte[] {1});
    assertThat(client(true).render("k", "image/heic", null, 1568).contentType())
        .isEqualTo("image/jpeg");

    stub = new Stub(200, "Image/PNG;foo=bar", "2", new byte[] {1});
    assertThat(client(true).render("k", "application/pdf", 1, 1568).contentType())
        .isEqualTo("image/png");

    stub = new Stub(200, "image/webp", null, new byte[] {1});
    assertWorkerUnavailable(() -> client(true).render("k", "image/webp", null, 1568));
  }

  @Test
  void 페이지_범위_밖이면_400_과_페이지수를_싣는다() {
    json(400, "{\"detail\":{\"code\":\"PAGE_OUT_OF_RANGE\",\"pageCount\":3}}");

    assertThatThrownBy(() -> client(true).render("k", "application/pdf", 9, 1568))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(400);
              assertThat(e.code()).isEqualTo("PAGE_OUT_OF_RANGE");
              assertThat(e.pageCount()).isEqualTo(3);
              assertThat(e.getMessage()).contains("3쪽").contains("1~3");
            });
  }

  @Test
  void 워커_사용자쪽_오류코드는_상태와_함께_그대로_전한다() {
    json(422, "{\"detail\":{\"code\":\"UNREADABLE\"}}");
    assertThatThrownBy(() -> client(true).render("k", "application/pdf", 1, 1568))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(422);
              assertThat(e.code()).isEqualTo("UNREADABLE");
            });

    json(404, "{\"detail\":{\"code\":\"NOT_FOUND\"}}");
    assertThatThrownBy(() -> client(true).render("k", "application/pdf", 1, 1568))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(404);
              assertThat(e.code()).isEqualTo("NOT_FOUND");
              assertThat(e.getMessage()).isEqualTo("원본 파일을 찾을 수 없습니다.");
            });

    json(413, "{\"detail\":{\"code\":\"TOO_LARGE\"}}");
    assertThatThrownBy(() -> client(true).render("k", "image/png", null, 1568))
        .isInstanceOfSatisfying(
            AttachmentViewException.class, e -> assertThat(e.status()).isEqualTo(413));
  }

  @Test
  void 워커_5xx_는_503_WORKER_UNAVAILABLE() {
    json(500, "{\"detail\":\"boom\"}");
    assertWorkerUnavailable(() -> client(true).render("k", "application/pdf", 1, 1568));
  }

  @Test
  void 서버쪽_결함인_BAD_KEY_나_검증실패_목록은_503_으로_모은다() {
    // BAD_KEY 는 API 가 만든 저장 경로 문제, FastAPI 검증 실패(목록형 detail)는 API 가 보낸 요청 문제 — 사용자·모델이 고칠 수 없다.
    json(400, "{\"detail\":{\"code\":\"BAD_KEY\"}}");
    assertWorkerUnavailable(() -> client(true).render("../k", "application/pdf", 1, 1568));

    json(422, "{\"detail\":[{\"loc\":[\"body\",\"maxEdge\"],\"msg\":\"bad\"}]}");
    assertWorkerUnavailable(() -> client(true).render("k", "application/pdf", 1, 99999));

    json(401, "{\"detail\":\"unauthorized\"}");
    assertWorkerUnavailable(() -> client(true).render("k", "application/pdf", 1, 1568));
  }

  @Test
  void 워커가_꺼져_있으면_요청_없이_503() {
    stub = new Stub(200, "image/png", null, new byte[] {1});
    assertWorkerUnavailable(() -> client(false).render("k", "application/pdf", 1, 1568));
    assertThat(hits.get()).isZero();
  }

  @Test
  void 연결이_안_되면_503() {
    WorkerRenderClient c = client(true);
    server.stop(0);
    assertWorkerUnavailable(() -> c.render("k", "application/pdf", 1, 1568));
  }

  private static void assertWorkerUnavailable(
      org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
    assertThatThrownBy(call)
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(503);
              assertThat(e.code()).isEqualTo("WORKER_UNAVAILABLE");
              assertThat(e.getMessage()).isEqualTo("페이지 이미지를 만들지 못했습니다. 잠시 후 다시 시도하세요.");
            });
  }
}

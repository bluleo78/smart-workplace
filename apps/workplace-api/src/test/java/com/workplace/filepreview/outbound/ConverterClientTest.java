package com.workplace.filepreview.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import com.workplace.global.outbound.InternalHttp;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * ConverterClient 단위 테스트(WP-431) — 로컬 HttpServer 로 변환 서비스 {@code POST /convert/pdf} 를 흉내 내 요청 형태와
 * 응답·오류 매핑을 검증한다.
 *
 * <p>Spring 컨텍스트·DB 없이 돈다. 핵심은 일시/영구 구분이다: 입력 문제(415·413·422)는 영구 실패로, 인프라 문제(429·5xx·401·연결 실패·해석
 * 불가 응답)는 일시 실패로 나눠야 미리보기가 "다음 열람 때 다시"와 "다시 하지 않음"을 바르게 고른다.
 */
class ConverterClientTest {

  private HttpServer server;
  private final AtomicReference<String> uri = new AtomicReference<>();
  private final AtomicReference<String> auth = new AtomicReference<>();
  private final AtomicReference<String> reqContentType = new AtomicReference<>();
  private final AtomicReference<byte[]> reqBody = new AtomicReference<>();
  private final AtomicInteger hits = new AtomicInteger();

  /** 차례로 내보낼 응답 — 마지막 하나는 이후 요청에 계속 쓴다. */
  private final ConcurrentLinkedQueue<Stub> stubs = new ConcurrentLinkedQueue<>();

  private volatile Stub last;

  @TempDir Path tmp;

  private record Stub(int status, String contentType, String pageCount, byte[] body) {}

  @BeforeEach
  void setUp() throws Exception {
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/convert/pdf",
        ex -> {
          hits.incrementAndGet();
          uri.set(ex.getRequestURI().toString());
          auth.set(ex.getRequestHeaders().getFirst("Authorization"));
          reqContentType.set(ex.getRequestHeaders().getFirst("Content-Type"));
          // 본문을 끝까지 읽어 둔다 — 안 읽고 응답하면 클라이언트 쪽 전송이 끊겨 테스트가 흔들릴 수 있다.
          reqBody.set(ex.getRequestBody().readAllBytes());
          Stub next = stubs.poll();
          Stub s = next != null ? next : last;
          if (next != null) last = next;
          ex.getResponseHeaders().add("Content-Type", s.contentType());
          if (s.pageCount() != null) ex.getResponseHeaders().add("X-Page-Count", s.pageCount());
          ex.sendResponseHeaders(s.status(), s.body().length == 0 ? -1 : s.body().length);
          if (s.body().length > 0) ex.getResponseBody().write(s.body());
          ex.close();
        });
    server.start();
  }

  @AfterEach
  void tearDown() {
    server.stop(0);
  }

  private ConverterProperties props(long maxBytes) {
    return new ConverterProperties(
        "http://127.0.0.1:" + server.getAddress().getPort(),
        "tok",
        true,
        5,
        maxBytes,
        2,
        10,
        new ConverterProperties.Preview("test-engine", Duration.ofMinutes(3), 3, 4, 1, null));
  }

  private ConverterClient client() {
    return client(104_857_600L);
  }

  private ConverterClient client(long maxBytes) {
    return new ConverterClient(
        props(maxBytes),
        InternalHttp.httpClientBuilder().connectTimeout(Duration.ofSeconds(2)).build());
  }

  private void enqueue(int status, String contentType, String pageCount, String body) {
    stubs.add(new Stub(status, contentType, pageCount, body.getBytes(StandardCharsets.UTF_8)));
  }

  private void error(int status, String code) {
    enqueue(status, "application/json", null, "{\"detail\":{\"code\":\"" + code + "\"}}");
  }

  private Path source(byte[] bytes) throws Exception {
    Path p = tmp.resolve("doc.hwp");
    Files.write(p, bytes);
    return p;
  }

  @Test
  void 성공이면_PDF_바이트와_쪽수를_준다() throws Exception {
    byte[] original = {'H', 'W', 'P', 0, 1, 2, 3};
    enqueue(200, "application/pdf", "7", "%PDF-1.7 fake");

    ConvertOutcome out = client().convertPdf(source(original), "application/x-hwp");

    assertThat(out).isInstanceOf(ConvertOutcome.Success.class);
    var ok = (ConvertOutcome.Success) out;
    assertThat(new String(ok.pdf(), StandardCharsets.UTF_8)).isEqualTo("%PDF-1.7 fake");
    assertThat(ok.pageCount()).isEqualTo(7);
    assertThat(uri.get()).isEqualTo("/convert/pdf?mime=application%2Fx-hwp");
    assertThat(auth.get()).isEqualTo("Internal tok");
    assertThat(reqContentType.get()).isEqualTo("application/octet-stream");
    assertThat(reqBody.get()).isEqualTo(original);
  }

  @Test
  void 쪽수_헤더가_없거나_숫자가_아니면_쪽수는_null() throws Exception {
    enqueue(200, "application/pdf", "abc", "%PDF");

    var ok =
        (ConvertOutcome.Success) client().convertPdf(source(new byte[] {1}), "application/msword");

    assertThat(ok.pageCount()).isNull();
  }

  @ParameterizedTest(name = "{0} {1} → ({2}, {3})")
  @CsvSource({
    "415, UNSUPPORTED, UNSUPPORTED, false",
    "413, TOO_LARGE, TOO_LARGE, false",
    "422, TOO_MANY_PAGES, TOO_MANY_PAGES, false",
    "422, CONVERT_FAILED, CONVERT_FAILED, false",
    "504, TIMEOUT, TIMEOUT, true",
    "503, UNAVAILABLE, UNAVAILABLE, true",
    "500, INTERNAL, UNAVAILABLE, true",
    "401, UNAUTHORIZED, UNAVAILABLE, true",
  })
  void 오류_코드를_일시_영구로_나눈다(int status, String code, String expectCode, boolean transientFailure)
      throws Exception {
    error(status, code);

    ConvertOutcome out = client().convertPdf(source(new byte[] {1}), "application/x-hwp");

    assertThat(out).isEqualTo(new ConvertOutcome.Failure(expectCode, transientFailure));
  }

  @Test
  void 본문이_JSON_이_아닌_422_는_UNAVAILABLE_일시_실패() throws Exception {
    enqueue(422, "text/html", null, "<html>bad gateway</html>");

    ConvertOutcome out = client().convertPdf(source(new byte[] {1}), "application/x-hwp");

    assertThat(out).isEqualTo(new ConvertOutcome.Failure("UNAVAILABLE", true));
  }

  @Test
  void 상태와_코드가_어긋나면_UNAVAILABLE_일시_실패() throws Exception {
    // 415 인데 코드가 TIMEOUT — 계약 밖 응답은 영구 실패로 굳히지 않는다.
    error(415, "TIMEOUT");

    ConvertOutcome out = client().convertPdf(source(new byte[] {1}), "application/x-hwp");

    assertThat(out).isEqualTo(new ConvertOutcome.Failure("UNAVAILABLE", true));
  }

  @Test
  void BUSY_면_두_번_더_시도하고_그래도_바쁘면_BUSY_일시_실패() throws Exception {
    error(429, "BUSY");

    ConvertOutcome out = client().convertPdf(source(new byte[] {1}), "application/x-hwp");

    assertThat(out).isEqualTo(new ConvertOutcome.Failure("BUSY", true));
    assertThat(hits.get()).isEqualTo(3);
  }

  @Test
  void BUSY_뒤_성공하면_성공() throws Exception {
    byte[] original = {9, 8, 7};
    error(429, "BUSY");
    enqueue(200, "application/pdf", "2", "%PDF");

    ConvertOutcome out = client().convertPdf(source(original), "application/x-hwp");

    assertThat(out).isInstanceOf(ConvertOutcome.Success.class);
    assertThat(hits.get()).isEqualTo(2);
    // 재시도도 원본 전체를 다시 보낸다(파일 publisher 를 새로 만든다).
    assertThat(reqBody.get()).isEqualTo(original);
  }

  @Test
  void 연결_거부면_UNAVAILABLE_일시_실패() throws Exception {
    ConverterClient c = client();
    server.stop(0);

    ConvertOutcome out = c.convertPdf(source(new byte[] {1}), "application/x-hwp");

    assertThat(out).isEqualTo(new ConvertOutcome.Failure("UNAVAILABLE", true));
  }

  @Test
  void 상한을_넘는_파일은_호출하지_않고_TOO_LARGE_영구_실패() throws Exception {
    ConvertOutcome out = client(3).convertPdf(source(new byte[] {1, 2, 3, 4}), "application/x-hwp");

    assertThat(out).isEqualTo(new ConvertOutcome.Failure("TOO_LARGE", false));
    assertThat(hits.get()).isZero();
  }

  @Test
  void 변환_시간과_BUSY_재시도_합이_리스_이상이면_기동_실패() {
    assertThatThrownBy(
            () ->
                new ConverterProperties(
                    "http://x",
                    "tok",
                    true,
                    75,
                    100,
                    2,
                    500,
                    new ConverterProperties.Preview("e", Duration.ofSeconds(77), 3, 4, 1, null)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void BUSY_재시도마다_타임아웃이_새로_쌓이는_최악_시간이_리스_이상이면_기동_실패() {
    // 재시도 5회·대기 2초: 6×75초 + 2초×15 = 480초 ≥ 3분. 예전 식(75초 + 5×2초×2 = 95초)으로는 통과해 놓쳤다.
    assertThatThrownBy(() -> props(75, 5, 2000, Duration.ofMinutes(3)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void 최악_시간_식은_요청_수만큼의_타임아웃과_BUSY_대기_합이다() {
    // 3×75초 + 500ms×(1+2) = 226.5초.
    assertThat(ConverterProperties.worstCaseMs(75, 2, 500)).isEqualTo(226_500L);
    assertThat(ConverterProperties.worstCaseMs(10, 0, 500)).isEqualTo(10_000L);
  }

  @Test
  void 기본_설정값은_리스_조건을_만족한다() {
    // application.yml 기본값(75초·재시도 2회·500ms·리스 4분)으로 기동이 실패하지 않아야 한다 — 최악 226.5초라 3분으로는 모자란다.
    assertThatCode(() -> props(75, 2, 500, Duration.ofMinutes(4))).doesNotThrowAnyException();
    assertThatThrownBy(() -> props(75, 2, 500, Duration.ofMinutes(3)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void 일시_실패_쿨다운은_미설정이면_10분() {
    assertThat(props(75, 2, 500, Duration.ofMinutes(4)).preview().transientCooldown())
        .isEqualTo(Duration.ofMinutes(10));
  }

  private static ConverterProperties props(
      int timeoutSeconds, int busyRetries, long busyBackoffMs, Duration lease) {
    return new ConverterProperties(
        "http://x",
        "tok",
        true,
        timeoutSeconds,
        104_857_600L,
        busyRetries,
        busyBackoffMs,
        new ConverterProperties.Preview("e", lease, 3, 4, 1, null));
  }
}

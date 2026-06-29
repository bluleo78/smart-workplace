package com.workplace.fileai.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/**
 * WorkerClient 단위 테스트 — 로컬 HttpServer 스텁으로 실제 HTTP 경로·본문 필드를 검증한다.
 *
 * <p>Spring 컨텍스트를 띄우지 않으므로 DB·워커 미기동 환경에서도 실행 가능하다.
 */
class WorkerClientTest {

  /** dispatchExtract 가 /tasks/extract 에 jobId·storageKey·mime·tenantId 를 포함한 본문을 POST 하는지 검증한다. */
  @Test
  void dispatchExtract_posts_to_tasks_extract_with_required_fields() throws Exception {
    var captured = new AtomicReference<String>();
    HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
    server.createContext(
        "/tasks/extract",
        ex -> {
          captured.set(new String(ex.getRequestBody().readAllBytes()));
          byte[] body = "{\"status\":\"accepted\"}".getBytes();
          ex.sendResponseHeaders(200, body.length);
          ex.getResponseBody().write(body);
          ex.close();
        });
    server.start();

    var props =
        new WorkerProperties(
            "http://localhost:" + server.getAddress().getPort(),
            "tok",
            true,
            new WorkerProperties.Embed("BAAI/bge-m3", 1024, 8000));
    var client = new WorkerClient(props);

    client.dispatchExtract(10L, "uploads/file.pdf", "application/pdf", 3L);

    server.stop(0);
    assertThat(captured.get())
        .contains("\"jobId\":10")
        .contains("\"storageKey\":\"uploads/file.pdf\"")
        .contains("\"mime\":\"application/pdf\"")
        .contains("\"tenantId\":3");
  }

  /** dispatchEmbed 가 /tasks/embed 에 jobId·text·tenantId 를 포함한 본문을 POST 하는지 검증한다. */
  @Test
  void dispatchEmbed_posts_to_tasks_embed_with_text_and_tenant() throws Exception {
    // com.sun.net.httpserver.HttpServer 스텁으로 워커 흉내 — 경로·본문 필드 검증.
    var captured = new AtomicReference<String>();
    HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
    server.createContext(
        "/tasks/embed",
        ex -> {
          captured.set(new String(ex.getRequestBody().readAllBytes()));
          byte[] body = "{\"status\":\"accepted\"}".getBytes();
          ex.sendResponseHeaders(200, body.length);
          ex.getResponseBody().write(body);
          ex.close();
        });
    server.start();
    var props =
        new WorkerProperties(
            "http://localhost:" + server.getAddress().getPort(),
            "tok",
            true,
            new WorkerProperties.Embed("BAAI/bge-m3", 1024, 8000));
    var client = new WorkerClient(props);

    client.dispatchEmbed(42L, "hello", 7L);

    server.stop(0);
    assertThat(captured.get())
        .contains("\"jobId\":42")
        .contains("\"text\":\"hello\"")
        .contains("\"tenantId\":7");
  }
}

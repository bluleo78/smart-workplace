package com.workplace.drive.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.sun.net.httpserver.HttpServer;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.global.outbound.AiAgentProperties;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** DriveOverviewStreamClient — X-AI-Run 헤더 부착과 호출 전 실패 기록을 로컬 HttpServer 로 검증한다 (WP-1829). */
class DriveOverviewStreamClientTest {

  private HttpServer server;
  private DriveOverviewStreamClient client;
  private final AiRunRecorder recorder = mock(AiRunRecorder.class);

  @BeforeEach
  void start() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
  }

  @AfterEach
  void stop() {
    server.stop(0);
  }

  // ---- WP-1829: X-AI-Run 헤더와 호출 전 실패 기록 ----

  /** 서버가 받은 X-AI-Run 헤더를 디코드한 JSON 필드. */
  private final java.util.concurrent.atomic.AtomicReference<String> seenAiRun =
      new java.util.concurrent.atomic.AtomicReference<>();

  /** 헤더를 캡처하는 스텁을 기동해 client 를 만든다. */
  private void bootCapturing(String body, int status) {
    server.createContext(
        "/drive/overview",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          seenAiRun.set(
              exchange.getRequestHeaders().getFirst(com.workplace.airun.context.AiRunHeader.NAME));
          exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(status, 0);
          try (OutputStream os = exchange.getResponseBody()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
          }
        });
    server.start();
    AiAgentProperties props =
        new AiAgentProperties(
            "http://127.0.0.1:" + server.getAddress().getPort(), "changeme-local", true);
    client = new DriveOverviewStreamClient(props, HttpClient.newHttpClient(), recorder);
  }

  private void callClient() throws Exception {
    client.stream("{}", t -> {}, () -> {});
  }

  @Test
  void aiRun_정상_스트림은_kind_헤더를_싣고_기록하지_않는다() throws Exception {
    bootCapturing("event: delta\ndata: {\"text\":\"a\"}\n\nevent: done\ndata: {}\n\n", 200);
    callClient();
    String json =
        new String(
            java.util.Base64.getUrlDecoder().decode(seenAiRun.get()), StandardCharsets.UTF_8);
    assertThat(json).contains("\"kind\":\"DRIVE_OVERVIEW\"").contains("\"runId\"");
    org.mockito.Mockito.verifyNoInteractions(recorder);
  }

  @Test
  void aiRun_상태_502면_기존_동작을_지키고_http_502_를_기록한다() throws Exception {
    bootCapturing("{}", 502);
    try {
      callClient();
    } catch (RuntimeException e) {
      assertThat(e.getMessage()).contains("502");
    }
    org.mockito.ArgumentCaptor<com.workplace.airun.dto.AiRunRecord> cap =
        org.mockito.ArgumentCaptor.forClass(com.workplace.airun.dto.AiRunRecord.class);
    org.mockito.Mockito.verify(recorder, org.mockito.Mockito.times(1)).upsert(cap.capture());
    assertThat(cap.getValue().errorReason()).isEqualTo("http_502");
    assertThat(cap.getValue().errorDetail()).isNull();
    assertThat(cap.getValue().kind()).isEqualTo("DRIVE_OVERVIEW");
    assertThat(cap.getValue().status()).isEqualTo("FAILED");
  }

  @Test
  void aiRun_상태_400은_기록하지_않는다() throws Exception {
    bootCapturing("{}", 400);
    try {
      callClient();
    } catch (RuntimeException e) {
      // 기존 동작 유지
    }
    org.mockito.Mockito.verifyNoInteractions(recorder);
  }

  @Test
  void aiRun_연결_거부는_agent_unreachable_로_기록하고_예외는_그대로다() throws Exception {
    int closedPort;
    try (java.net.ServerSocket s = new java.net.ServerSocket(0)) {
      closedPort = s.getLocalPort();
    }
    AiAgentProperties props =
        new AiAgentProperties("http://127.0.0.1:" + closedPort, "changeme-local", true);
    client = new DriveOverviewStreamClient(props, HttpClient.newHttpClient(), recorder);
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> client.stream("{}", t -> {}, () -> {}))
        .isInstanceOf(java.io.IOException.class);
    org.mockito.ArgumentCaptor<com.workplace.airun.dto.AiRunRecord> cap =
        org.mockito.ArgumentCaptor.forClass(com.workplace.airun.dto.AiRunRecord.class);
    org.mockito.Mockito.verify(recorder, org.mockito.Mockito.times(1)).upsert(cap.capture());
    assertThat(cap.getValue().errorReason()).isEqualTo("agent_unreachable");
  }

  @Test
  void aiRun_200_으로_시작한_뒤_끊겨도_기록하지_않는다() throws Exception {
    bootCapturing("event: delta\ndata: {\"text\":\"a\"}\n\n", 200);
    try {
      callClient();
    } catch (Exception e) {
      // 스트림 도중 종료 — 기존 동작
    }
    org.mockito.Mockito.verifyNoInteractions(recorder);
  }
}

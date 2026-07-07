package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sun.net.httpserver.HttpServer;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 로컬 HttpServer 스텁으로 SSE 를 실제 소켓에 흘려보내고, AiAgentChatClient(composeStream) 가
 * delta/done/error/progress/pending_action 을 올바르게 처리하는지 검증한다. WikiAiAgentStreamClientTest 와 동일한 패턴.
 */
class AiAgentChatClientTest {

  private HttpServer server;
  private AiAgentChatClient client;

  @BeforeEach
  void start() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
  }

  @AfterEach
  void stop() throws Exception {
    if (server != null) {
      server.stop(0);
    }
  }

  /** 스텁을 기동하고 baseUrl 을 가리키는 client 를 만든다. */
  private void boot(String sseBody, int status) {
    server.createContext(
        "/ai/chat",
        exchange -> {
          byte[] payload = sseBody.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(status, 0); // 0 → chunked
          try (OutputStream os = exchange.getResponseBody()) {
            os.write(payload);
            os.flush();
          }
        });
    server.start();
    int port = server.getAddress().getPort();
    AiAgentProperties props =
        new AiAgentProperties("http://127.0.0.1:" + port, "changeme-local", true);
    client = new AiAgentChatClient(props, HttpClient.newHttpClient());
  }

  private ChatRequest dummyReq() {
    // #376: userId 추가 — 요청자 ID(MCP 도구 컨텍스트 기준). #719: tenantId(nullable) 추가.
    return new ChatRequest("테스트", List.of(), 5L, 1L, null, "claude-sonnet-4-6", "NORMAL", 8, 60000);
  }

  @Test
  void delta_두개와_done_이벤트를_정상_처리() throws Exception {
    String body =
        "event: delta\ndata: {\"text\":\"안녕\"}\n\n"
            + "event: delta\ndata: {\"text\":\"하세요\"}\n\n"
            + "event: done\ndata: {\"fullText\":\"안녕하세요\",\"widgets\":[{\"type\":\"my_tasks\"}]}\n\n";
    boot(body, 200);

    List<String> deltas = new ArrayList<>();
    AtomicBoolean done = new AtomicBoolean(false);
    AtomicReference<String> fullText = new AtomicReference<>();

    client.composeStream(
        dummyReq(),
        deltas::add,
        (ft, widgets) -> {
          fullText.set(ft);
          done.set(true);
        },
        msg -> {
          throw new AssertionError("예상치 못한 오류: " + msg);
        },
        label -> {},
        node -> {},
        toolNode -> {});

    assertThat(deltas).containsExactly("안녕", "하세요");
    assertThat(done).isTrue();
    assertThat(fullText.get()).isEqualTo("안녕하세요");
  }

  @Test
  void error_이벤트는_onError_콜백으로_전달() throws Exception {
    String body = "event: error\ndata: {\"message\":\"chat_failed\"}\n\n";
    boot(body, 200);

    AtomicReference<String> errorMsg = new AtomicReference<>();
    client.composeStream(
        dummyReq(), delta -> {}, (ft, w) -> {}, errorMsg::set, label -> {}, node -> {}, tn -> {});

    assertThat(errorMsg.get()).contains("실패");
  }

  @Test
  void done_없이_EOF로_끝나면_onDone_미호출_onError_로_마감() throws Exception {
    // #347: delta 만 오고 done/error 없이 본문 스트림이 끝나는 비정상 종료(인터럽트 아님).
    // 빈 ASSISTANT 행 영속을 막기 위해 onDone 은 호출되지 않아야 하고, 살아있는 emitter 가
    // 타임아웃까지 매달리지 않도록 onError 로 마감되어야 한다.
    String body = "event: delta\ndata: {\"text\":\"진행 중\"}\n\n";
    boot(body, 200);

    List<String> deltas = new ArrayList<>();
    AtomicBoolean done = new AtomicBoolean(false);
    AtomicReference<String> errorMsg = new AtomicReference<>();

    client.composeStream(
        dummyReq(),
        deltas::add,
        (ft, w) -> done.set(true),
        errorMsg::set,
        label -> {},
        node -> {},
        tn -> {});

    assertThat(deltas).containsExactly("진행 중");
    assertThat(done).as("done 이벤트 없이 끝났으므로 onDone 미호출").isFalse();
    assertThat(errorMsg.get()).contains("완료되지 않");
  }

  @Test
  void 홈컴포저_미설정_503_은_onError_로_명확메시지_전달() throws Exception {
    // 503 home_composer_not_configured → 사용자에게 명확한 메시지 전달.
    boot("{\"error\":\"home_composer_not_configured\"}", 503);

    AtomicReference<String> errorMsg = new AtomicReference<>();
    client.composeStream(
        dummyReq(), delta -> {}, (ft, w) -> {}, errorMsg::set, label -> {}, node -> {}, tn -> {});

    assertThat(errorMsg.get()).contains("설정되지 않");
  }

  @Test
  void 비200_응답은_onError_콜백으로_전달() throws Exception {
    boot("{\"error\":\"invalid_payload\"}", 400);

    AtomicReference<String> errorMsg = new AtomicReference<>();
    client.composeStream(
        dummyReq(), delta -> {}, (ft, w) -> {}, errorMsg::set, label -> {}, node -> {}, tn -> {});

    assertThat(errorMsg.get()).isNotNull();
  }

  @Test
  void progress_이벤트는_onProgress_로_전달하고_스트림은_계속된다() throws Exception {
    String body =
        "event: progress\ndata: {\"label\":\"캘린더 전문가에게 위임 중\"}\n\n"
            + "event: delta\ndata: {\"text\":\"네\"}\n\n"
            + "event: done\ndata: {\"fullText\":\"네\",\"widgets\":null}\n\n";
    boot(body, 200);

    java.util.List<String> progress = new ArrayList<>();
    java.util.List<String> deltas = new ArrayList<>();
    AtomicBoolean done = new AtomicBoolean(false);
    client.composeStream(
        dummyReq(),
        deltas::add,
        (ft, w) -> done.set(true),
        msg -> {
          throw new AssertionError("예상치 못한 오류: " + msg);
        },
        progress::add,
        node -> {
          throw new AssertionError("예상치 못한 pending_action: " + node);
        },
        tn -> {});

    // progress 가 전달되고, 그 뒤 delta/done 까지 정상 소비(중간 이벤트가 루프를 끊지 않음).
    assertThat(progress).containsExactly("캘린더 전문가에게 위임 중");
    assertThat(deltas).containsExactly("네");
    assertThat(done).isTrue();
  }

  @Test
  void pending_action_이벤트는_raw_JsonNode_로_onPendingAction_에_전달() throws Exception {
    // #351 이전 단일 객체는 길이 1 배열로 래핑되어 전달됨.
    String body =
        "event: pending_action\ndata: {\"actionType\":\"calendar.create_event\",\"summary\":\"내일 10시 회의\",\"params\":{\"title\":\"회의\"}}\n\n"
            + "event: done\ndata: {\"fullText\":\"제안했어요\",\"widgets\":null}\n\n";
    boot(body, 200);

    AtomicReference<com.fasterxml.jackson.databind.JsonNode> pending = new AtomicReference<>();
    client.composeStream(
        dummyReq(), d -> {}, (ft, w) -> {}, msg -> {}, label -> {}, pending::set, tn -> {});

    assertThat(pending.get()).isNotNull();
    // 단일 객체는 길이 1 배열로 래핑됨.
    assertThat(pending.get().isArray()).isTrue();
    assertThat(pending.get().get(0).get("actionType").asText()).isEqualTo("calendar.create_event");
    assertThat(pending.get().get(0).get("summary").asText()).isEqualTo("내일 10시 회의");
    assertThat(pending.get().get(0).get("params").get("title").asText()).isEqualTo("회의");
  }

  @Test
  void pending_action_배열은_ArrayNode_로_onPendingAction_에_전달() throws Exception {
    // #351: ai-agent 가 멀티-액션 배열을 보내면 그대로 ArrayNode 로 전달돼야 한다.
    String body =
        "event: pending_action\ndata: [{\"actionType\":\"calendar.create_event\",\"summary\":\"내일 10시\",\"params\":{}},"
            + "{\"actionType\":\"mail.send\",\"summary\":\"메일 보내기\",\"params\":{}}]\n\n"
            + "event: done\ndata: {\"fullText\":\"제안했어요\",\"widgets\":null}\n\n";
    boot(body, 200);

    AtomicReference<com.fasterxml.jackson.databind.JsonNode> pending = new AtomicReference<>();
    client.composeStream(
        dummyReq(), d -> {}, (ft, w) -> {}, msg -> {}, label -> {}, pending::set, tn -> {});

    assertThat(pending.get()).isNotNull();
    assertThat(pending.get().isArray()).isTrue();
    assertThat(pending.get().size()).isEqualTo(2);
    assertThat(pending.get().get(0).get("actionType").asText()).isEqualTo("calendar.create_event");
    assertThat(pending.get().get(1).get("actionType").asText()).isEqualTo("mail.send");
  }

  @Test
  void tool_이벤트를_onTool_콜백으로_전달한다() throws Exception {
    // tool start + tool result + done 시퀀스 — tool 이벤트가 onTool 로 전달되고 스트림은 계속된다.
    String body =
        "event: tool\ndata: {\"seq\":1,\"phase\":\"start\",\"toolName\":\"get_issue_detail\",\"args\":{\"id\":42}}\n\n"
            + "event: tool\ndata: {\"seq\":1,\"phase\":\"result\",\"isError\":false}\n\n"
            + "event: done\ndata: {\"fullText\":\"이슈를 조회했어요\",\"widgets\":null}\n\n";
    boot(body, 200);

    List<com.fasterxml.jackson.databind.JsonNode> tools = new ArrayList<>();
    AtomicBoolean done = new AtomicBoolean(false);
    client.composeStream(
        dummyReq(),
        d -> {},
        (ft, w) -> done.set(true),
        msg -> {
          throw new AssertionError("예상치 못한 오류: " + msg);
        },
        label -> {},
        node -> {},
        tools::add);

    // tool 이벤트가 onTool 으로 전달됐는지 검증.
    assertThat(tools).hasSize(2);
    assertThat(tools.get(0).get("toolName").asText()).isEqualTo("get_issue_detail");
    assertThat(tools.get(0).get("phase").asText()).isEqualTo("start");
    assertThat(tools.get(1).get("phase").asText()).isEqualTo("result");
    assertThat(tools.get(1).get("isError").asBoolean()).isFalse();
    // tool 이벤트가 스트림을 끊지 않아 done 까지 소비되는지 검증.
    assertThat(done).isTrue();
  }

  /**
   * #593: 취소(Future.cancel(true))로 인한 인터럽트는 onError 로 뭉뚱그려지지 않고 그대로 재throw 되어야 한다 — 호출자
   * (HomeChatService)가 원인 체인을 검사해 cancelled:true 신호를 낼 수 있어야 하기 때문이다. 실제 소켓/스레드 인터럽트 대신, 테스트용
   * HttpClient 주입 생성자로 http.send(...) 가 인터럽트로 인한
   * 예외(UncheckedIOException(IOException(InterruptedException)))를 던지도록 목 처리해 결정적으로 재현한다.
   */
  @Test
  void 인터럽트로_인한_예외는_onError_로_흡수하지_않고_그대로_재throw() throws Exception {
    HttpClient mockHttp = mock(HttpClient.class);
    when(mockHttp.send(any(), any()))
        .thenThrow(new UncheckedIOException(new IOException(new InterruptedException())));

    AiAgentProperties props = new AiAgentProperties("http://127.0.0.1:1", "changeme-local", true);
    AiAgentChatClient interruptClient = new AiAgentChatClient(props, mockHttp);

    @SuppressWarnings("unchecked")
    Consumer<String> onError = mock(Consumer.class);

    assertThatThrownBy(
            () ->
                interruptClient.composeStream(
                    dummyReq(), d -> {}, (ft, w) -> {}, onError, label -> {}, node -> {}, tn -> {}))
        .isInstanceOf(UncheckedIOException.class);

    verify(onError, never()).accept(any());
  }
}

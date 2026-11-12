package com.workplace.agentaccount.genialogin;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Gen:iA 로그인 테스트용 가짜 서버(JDK HttpServer, 루프백 임의 포트). {@code /auth/login}·{@code /auth/login/token} 두
 * 경로에 경로별 응답 큐를 두고(비면 200 {}), 받은 요청(경로·Content-Type·본문)을 기록한다.
 */
final class FakeGeniaServer implements AutoCloseable {

  /** 받은 요청 한 건. */
  record Received(String path, String contentType, String body) {}

  /** 큐에 쌓아 두는 응답 한 건. */
  private record Reply(int status, String body) {}

  private final HttpServer server;
  final List<Received> requests = new CopyOnWriteArrayList<>();
  private final Map<String, ConcurrentLinkedQueue<Reply>> replies = new ConcurrentHashMap<>();

  FakeGeniaServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    for (String path : new String[] {"/auth/login", "/auth/login/token"}) {
      server.createContext(
          path,
          ex -> {
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            requests.add(new Received(path, ex.getRequestHeaders().getFirst("Content-Type"), body));
            Reply r = replies.computeIfAbsent(path, k -> new ConcurrentLinkedQueue<>()).poll();
            if (r == null) r = new Reply(200, "{}");
            byte[] out = r.body().getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(r.status(), out.length);
            ex.getResponseBody().write(out);
            ex.close();
          });
    }
    server.start();
  }

  /** 해당 경로의 다음 응답을 큐에 더한다. */
  void enqueue(String path, int status, String body) {
    replies.computeIfAbsent(path, k -> new ConcurrentLinkedQueue<>()).add(new Reply(status, body));
  }

  /** 서버 기준 주소(경로 없음). */
  String url() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @Override
  public void close() {
    server.stop(0);
  }
}

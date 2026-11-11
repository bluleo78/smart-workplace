package com.workplace.agentaccount.usage;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 사용량 조회 테스트용 가짜 HTTP 서버(WP-1487). 루프백 임의 포트의 원시 소켓으로 받아, 앞의 {@code dropFirst} 개 연결은 요청만 읽고 응답 없이
 * 끊는다 — 오래 쉬다 서버가 닫은 풀 연결을 다시 쓴 상황(응답 없음)을 재현한다. JDK HttpServer 는 응답 없이 끊기를 확실히 할 수 없어 소켓을 직접 다룬다.
 * 그 뒤 연결엔 정해 둔 상태·헤더·본문으로 응답하고 연결을 닫는다.
 */
final class FakeUsageServer implements AutoCloseable {

  private final ServerSocket socket;
  private final Thread acceptor;

  /** 받은 연결 수. */
  final AtomicInteger connections = new AtomicInteger();

  /** 응답 없이 끊을 앞쪽 연결 수. */
  volatile int dropFirst = 0;

  volatile int status = 200;

  /** 추가 응답 헤더 줄들(「이름: 값\r\n」 꼴). */
  volatile String extraHeaders = "";

  volatile String body = "{}";

  /** true 면 「Connection: close」 없이 응답하고 같은 연결로 다음 요청을 기다린다 — 클라이언트가 연결을 다시 쓰는지 본다. */
  volatile boolean keepAlive = false;

  /** 받은 요청 수(연결 하나에 여러 요청이 올 수 있다). */
  final AtomicInteger requests = new AtomicInteger();

  FakeUsageServer() throws IOException {
    socket = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    acceptor = new Thread(this::acceptLoop, "fake-usage-server");
    acceptor.setDaemon(true);
    acceptor.start();
  }

  /** base URL. */
  String baseUrl() {
    return "http://127.0.0.1:" + socket.getLocalPort();
  }

  /** 연결을 하나씩 받아 처리한다 — 서버 소켓이 닫히면 끝난다. */
  private void acceptLoop() {
    while (!socket.isClosed()) {
      try (Socket s = socket.accept()) {
        int n = connections.incrementAndGet();
        InputStream in = s.getInputStream();
        // keepAlive 면 클라이언트가 닫을 때까지 같은 연결로 요청을 계속 받는다.
        do {
          String head = readUntilBlankLine(in);
          if (head.isEmpty()) break; // 클라이언트가 연결을 닫음
          requests.incrementAndGet();
          int contentLength = contentLength(head);
          if (n <= dropFirst) {
            // 요청은 받았지만 응답 없이 끊는다.
            break;
          }
          if (contentLength >= 0) {
            in.readNBytes(contentLength);
          } else {
            readChunked(in);
          }
          respond(s.getOutputStream());
        } while (keepAlive);
      } catch (IOException e) {
        // 서버 종료(소켓 닫힘) 또는 클라이언트 쪽 끊김 — 다음 연결로.
      }
    }
  }

  /** 요청 헤더 문자열에서 Content-Length 를 꺼낸다(chunked 면 -1, 본문 없으면 0). */
  private static int contentLength(String head) {
    int contentLength = 0;
    for (String line : head.split("\r\n")) {
      String lower = line.toLowerCase(Locale.ROOT);
      if (lower.startsWith("content-length:")) {
        contentLength = Integer.parseInt(line.substring("content-length:".length()).trim());
      } else if (lower.startsWith("transfer-encoding:") && lower.contains("chunked")) {
        contentLength = -1;
      }
    }
    return contentLength;
  }

  /** CRLF CRLF(빈 줄)까지 읽은 문자열. */
  private static String readUntilBlankLine(InputStream in) throws IOException {
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    int b;
    int matched = 0;
    while ((b = in.read()) != -1) {
      buf.write(b);
      // \r\n\r\n 진행 상태 — 순서대로 맞으면 하나씩 늘고, 어긋나면 처음부터.
      matched = (b == (matched % 2 == 0 ? '\r' : '\n')) ? matched + 1 : (b == '\r' ? 1 : 0);
      if (matched == 4) break;
    }
    return buf.toString(StandardCharsets.ISO_8859_1);
  }

  /** chunked 본문을 마지막(크기 0) 청크와 트레일러까지 읽어 버린다. */
  private static void readChunked(InputStream in) throws IOException {
    while (true) {
      StringBuilder sizeLine = new StringBuilder();
      int b;
      while ((b = in.read()) != -1 && b != '\n') {
        if (b != '\r') sizeLine.append((char) b);
      }
      if (b == -1) return;
      int size = Integer.parseInt(sizeLine.toString().split(";")[0].trim(), 16);
      if (size == 0) {
        readUntilTrailerEnd(in);
        return;
      }
      in.readNBytes(size + 2); // 청크 본문 + CRLF
    }
  }

  /** 마지막 청크 뒤 트레일러(대개 빈 줄 하나)를 읽는다. */
  private static void readUntilTrailerEnd(InputStream in) throws IOException {
    int prev = -1;
    int b;
    while ((b = in.read()) != -1) {
      if (prev == '\r' && b == '\n') return; // 트레일러 없는 경우의 빈 줄
      prev = b;
    }
  }

  /** 정해 둔 응답을 쓰고 연결을 닫게 알린다. */
  private void respond(OutputStream out) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    String head =
        "HTTP/1.1 "
            + status
            + " X\r\n"
            + "Content-Type: application/json\r\n"
            + extraHeaders
            + "Content-Length: "
            + bytes.length
            + "\r\n"
            + (keepAlive ? "" : "Connection: close\r\n")
            + "\r\n";
    out.write(head.getBytes(StandardCharsets.ISO_8859_1));
    out.write(bytes);
    out.flush();
  }

  @Override
  public void close() throws IOException {
    socket.close();
  }
}

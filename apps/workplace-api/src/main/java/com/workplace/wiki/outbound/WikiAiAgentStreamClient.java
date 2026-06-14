package com.workplace.wiki.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.outbound.AiAgentProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * ai-agent {@code POST /wiki/compose} SSE 를 JDK {@link HttpClient} 로 스트리밍 소비한다 (S3 B3).
 * webflux/WebClient 미사용.
 *
 * <p>{@link HttpResponse.BodyHandlers#ofLines()} 는 {@code send()} 가 헤더 수신 즉시 반환하고 본문 {@code
 * Stream<String>} 을 lazy 하게 라인 단위로 흘려보낸다 → 토큰이 도착하는 즉시 콜백한다(버퍼링 없음).
 */
@Service
public class WikiAiAgentStreamClient {

  /** 요청 전체 타임아웃 — SseEmitter 타임아웃(120s)과 정렬. 취소가 안 먹는 블로킹 read 도 이 시각엔 강제 종료된다. */
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(120);

  /** 연결 타임아웃 — 에이전트가 떠 있지 않을 때 빠르게 실패. */
  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);

  private final HttpClient http;
  private final AiAgentProperties props;
  private final ObjectMapper mapper = new ObjectMapper();

  @Autowired
  public WikiAiAgentStreamClient(AiAgentProperties props) {
    this.props = props;
    this.http = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
  }

  /** 테스트용 — HttpClient 주입(로컬 HttpServer 스텁 대상). */
  WikiAiAgentStreamClient(AiAgentProperties props, HttpClient http) {
    this.props = props;
    this.http = http;
  }

  /**
   * 에이전트 SSE 를 소비한다. {@code event: delta} 의 text 토큰을 {@code onDelta} 로, 정상 종료를 {@code onDone} 으로
   * 전달한다. {@code event: error} 또는 비200 응답은 예외를 던진다(상위에서 completeWithError).
   *
   * <p>취소 지연 한계: 블로킹 {@code ofLines()} read 는 스레드 interrupt 에 즉시 반응하지 않으므로(에이전트 thinking 중엔 다음 토큰까지
   * 대기), {@code Future.cancel(true)} 의 실효는 다음 토큰 도착 또는 {@link #REQUEST_TIMEOUT}(120s) 중 빠른 쪽까지 지연될
   * 수 있다 — 요청 타임아웃으로 상한이 보장된다.
   *
   * @param requestBody 직렬화될 에이전트 요청 본문(AgentBody)
   */
  public void stream(Object requestBody, Consumer<String> onDelta, Runnable onDone)
      throws Exception {
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(props.baseUrl() + "/wiki/compose"))
            .timeout(REQUEST_TIMEOUT)
            .header("Authorization", "Internal " + props.internalToken())
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(requestBody)))
            .build();

    HttpResponse<Stream<String>> resp = http.send(req, HttpResponse.BodyHandlers.ofLines());
    if (resp.statusCode() != 200) {
      // 에러 본문을 SSE 로 오인 파싱하지 않도록 상태코드 먼저 검사.
      throw new RuntimeException("ai-agent /wiki/compose 비정상 상태: " + resp.statusCode());
    }

    // try-with-resources 로 본문 스트림(=커넥션)을 반드시 닫는다.
    try (Stream<String> lines = resp.body()) {
      String event = "message";
      for (String line : (Iterable<String>) lines::iterator) {
        // 취소(Future.cancel(true)) 시 인터럽트로 빠르게 빠져나간다.
        if (Thread.currentThread().isInterrupted()) {
          break;
        }
        if (line.isEmpty()) {
          event = "message"; // 빈 줄 = 이벤트 경계
          continue;
        }
        if (line.startsWith("event:")) {
          event = line.substring("event:".length()).trim();
        } else if (line.startsWith("data:")) {
          String data = line.substring("data:".length()).trim();
          if ("delta".equals(event)) {
            String t = parseDeltaText(data);
            if (t != null) {
              onDelta.accept(t);
            }
          } else if ("done".equals(event)) {
            onDone.run();
            return;
          } else if ("error".equals(event)) {
            throw new RuntimeException("ai-agent stream error: " + data);
          }
        }
      }
    }
    // done 이벤트 없이 스트림이 끝난 경우에도 정상 종료로 마감.
    onDone.run();
  }

  /** {@code {"text":"..."}} 에서 text 추출. 형식이 다르면 null. */
  private String parseDeltaText(String data) {
    try {
      JsonNode node = mapper.readTree(data);
      JsonNode text = node.get("text");
      return (text != null && text.isTextual()) ? text.asText() : null;
    } catch (Exception e) {
      return null; // 비JSON/파싱 실패는 무시
    }
  }
}

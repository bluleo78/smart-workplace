package com.workplace.home.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.home.exception.HomeComposeUnavailableException;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import java.util.stream.Stream;
import lombok.extern.slf4j.Slf4j;

/**
 * ai-agent {@code POST /home/compose} SSE 를 JDK {@link HttpClient} 로 스트리밍 소비한다 (B2).
 *
 * <p>WikiAiAgentStreamClient 와 동일한 패턴을 사용한다. webflux/WebClient 미사용.
 *
 * <p>{@link HttpResponse.BodyHandlers#ofLines()} 는 {@code send()} 가 헤더 수신 즉시 반환하고 본문 {@code
 * Stream<String>} 을 lazy 하게 라인 단위로 흘려보낸다 → 토큰이 도착하는 즉시 콜백한다(버퍼링 없음).
 *
 * <ul>
 *   <li>인증: Authorization: Internal {token}
 *   <li>503 home_composer_not_configured(운영 설정 누락) 는 HomeComposeUnavailableException(503, 명확 메시지)
 *       로, 그 외 실패(IO/4xx/5xx)는 RuntimeException(502 매핑) 으로 변환.
 * </ul>
 */
@Slf4j
public class AiAgentComposeClient {

  /** 요청 전체 타임아웃 — SseEmitter 타임아웃(300s)과 정렬. */
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(300);

  /** 연결 타임아웃 — 에이전트가 떠 있지 않을 때 빠르게 실패. */
  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);

  private final HttpClient http;
  private final AiAgentProperties props;
  private final ObjectMapper mapper = new ObjectMapper();

  /** 프로덕션 생성자 — props 에서 baseUrl/internalToken 을 읽는다. */
  public AiAgentComposeClient(AiAgentProperties props) {
    this.props = props;
    this.http = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
  }

  /** 테스트용 — HttpClient 주입(로컬 HttpServer 스텁 대상). */
  AiAgentComposeClient(AiAgentProperties props, HttpClient http) {
    this.props = props;
    this.http = http;
  }

  /**
   * ai-agent SSE 를 소비한다.
   *
   * <ul>
   *   <li>{@code event: delta} 의 text 토큰 → {@code onDelta}
   *   <li>{@code event: done} 의 fullText/widgets → {@code onDone}
   *   <li>{@code event: error} 또는 비200 응답 → {@code onError} 콜백 후 정상 반환(호출자가 SSE error 전송)
   * </ul>
   *
   * @param request 직렬화될 에이전트 요청 본문
   * @param onDelta delta 텍스트 토큰 콜백
   * @param onDone done 이벤트 콜백 — fullText, widgets(nullable JsonNode)
   * @param onError 오류 메시지 콜백
   */
  public void composeStream(
      ComposeRequest request,
      Consumer<String> onDelta,
      BiConsumer<String, JsonNode> onDone,
      Consumer<String> onError) {
    try {
      HttpRequest req =
          HttpRequest.newBuilder()
              .uri(URI.create(props.baseUrl() + "/home/compose"))
              .timeout(REQUEST_TIMEOUT)
              .header("Authorization", "Internal " + props.internalToken())
              .header("Content-Type", "application/json")
              .header("Accept", "text/event-stream")
              .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(request)))
              .build();

      HttpResponse<Stream<String>> resp = http.send(req, HttpResponse.BodyHandlers.ofLines());

      // 에러 본문을 SSE 로 오인 파싱하지 않도록 상태코드 먼저 검사.
      if (resp.statusCode() != 200) {
        // 503 home_composer_not_configured: 사용자에게 명확한 사유 메시지 제공.
        // 본문을 읽어야 하므로 라인 스트림을 한번만 소비한다.
        String body;
        try (Stream<String> lines = resp.body()) {
          body = lines.reduce("", (a, b) -> a + b);
        }
        if (resp.statusCode() == 503 && body.contains("home_composer_not_configured")) {
          log.error("ai-agent home composer 미설정: {}", body);
          // 스트림 시작 전이면 예외로 던져 GlobalExceptionHandler 가 503 으로 매핑하게 한다.
          // 스트림 시작 후라면 onError 로 흘린다 — 호출자가 구분 처리한다.
          onError.accept("AI 홈 컴포저가 아직 설정되지 않았어요. 관리자에게 문의해주세요.");
          return;
        }
        log.error("ai-agent compose 비정상 상태: {} body={}", resp.statusCode(), body);
        onError.accept("AI 구성 요청에 실패했어요. 잠시 후 다시 시도해주세요.");
        return;
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
              // done 이벤트: {fullText, widgets} 를 파싱해 콜백.
              String fullText = parseDoneFullText(data);
              JsonNode widgets = parseDoneWidgets(data);
              onDone.accept(fullText != null ? fullText : "", widgets);
              return;
            } else if ("error".equals(event)) {
              log.error("ai-agent home compose stream error: {}", data);
              onError.accept("AI 구성 요청에 실패했어요. 잠시 후 다시 시도해주세요.");
              return;
            }
          }
        }
      }
      // done 이벤트 없이 스트림이 끝난 경우에도 정상 종료로 마감.
      onDone.accept("", null);

    } catch (HomeComposeUnavailableException e) {
      throw e;
    } catch (Exception e) {
      log.error("ai-agent home compose 실패: {}", e.getMessage());
      onError.accept("AI 구성 요청에 실패했어요. 잠시 후 다시 시도해주세요.");
    }
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

  /** {@code {"fullText":"..."}} 에서 fullText 추출. 형식이 다르면 null. */
  private String parseDoneFullText(String data) {
    try {
      JsonNode node = mapper.readTree(data);
      JsonNode ft = node.get("fullText");
      return (ft != null && ft.isTextual()) ? ft.asText() : null;
    } catch (Exception e) {
      return null;
    }
  }

  /** {@code {"widgets":[...]}} 에서 widgets 추출. 없거나 파싱 실패 시 null. */
  private JsonNode parseDoneWidgets(String data) {
    try {
      JsonNode node = mapper.readTree(data);
      JsonNode w = node.get("widgets");
      return (w != null && !w.isNull()) ? w : null;
    } catch (Exception e) {
      return null;
    }
  }
}

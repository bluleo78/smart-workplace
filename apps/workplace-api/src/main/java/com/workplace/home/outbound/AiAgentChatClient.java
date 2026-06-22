package com.workplace.home.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.outbound.AiAgentProperties;
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
 * ai-agent {@code POST /ai/chat} SSE 를 JDK {@link HttpClient} 로 스트리밍 소비한다 (B2).
 *
 * <p>WikiAiAgentStreamClient 와 동일한 패턴을 사용한다. webflux/WebClient 미사용.
 *
 * <p>{@link HttpResponse.BodyHandlers#ofLines()} 는 {@code send()} 가 헤더 수신 즉시 반환하고 본문 {@code
 * Stream<String>} 을 lazy 하게 라인 단위로 흘려보낸다 → 토큰이 도착하는 즉시 콜백한다(버퍼링 없음).
 *
 * <ul>
 *   <li>인증: Authorization: Internal {token}
 *   <li>스트리밍 소비 메서드이므로 실패는 던지지 않고 모두 {@code onError} 콜백으로 흘린다(503 home_composer_not_configured·기타
 *       IO/4xx/5xx 동일). 호출자가 SSE error 이벤트로 변환한다.
 * </ul>
 */
@Slf4j
public class AiAgentChatClient {

  /** 요청 전체 타임아웃 — SseEmitter 타임아웃(300s)과 정렬. */
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(300);

  /** 연결 타임아웃 — 에이전트가 떠 있지 않을 때 빠르게 실패. */
  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);

  private final HttpClient http;
  private final AiAgentProperties props;
  private final ObjectMapper mapper = new ObjectMapper();

  /** 프로덕션 생성자 — props 에서 baseUrl/internalToken 을 읽는다. */
  public AiAgentChatClient(AiAgentProperties props) {
    this.props = props;
    this.http = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
  }

  /** 테스트용 — HttpClient 주입(로컬 HttpServer 스텁 대상). */
  AiAgentChatClient(AiAgentProperties props, HttpClient http) {
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
   *   <li>{@code event: progress} 의 label 문자열 → {@code onProgress} (중간 이벤트, 루프 계속)
   *   <li>{@code event: pending_action} 의 raw JSON → {@code onPendingAction} (중간 이벤트, 루프 계속)
   *   <li>{@code event: tool} 의 raw JSON → {@code onTool} (도구 호출 라이브 이벤트, 루프 계속)
   * </ul>
   *
   * @param request 직렬화될 에이전트 요청 본문
   * @param onDelta delta 텍스트 토큰 콜백
   * @param onDone done 이벤트 콜백 — fullText, widgets(nullable JsonNode)
   * @param onError 오류 메시지 콜백
   * @param onProgress 위임 진행 라벨 콜백 (#333 M2)
   * @param onPendingAction 확인 카드 제안 객체 콜백, raw JsonNode (#333 M2)
   * @param onTool 도구 호출 이벤트 콜백, raw JsonNode({seq, phase, toolName, args?, isError?})
   */
  public void composeStream(
      ComposeRequest request,
      Consumer<String> onDelta,
      BiConsumer<String, JsonNode> onDone,
      Consumer<String> onError,
      Consumer<String> onProgress,
      Consumer<JsonNode> onPendingAction,
      Consumer<JsonNode> onTool) {
    try {
      HttpRequest req =
          HttpRequest.newBuilder()
              .uri(URI.create(props.baseUrl() + "/ai/chat"))
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
          // 스트리밍 소비 경로이므로 예외를 던지지 않고 onError 로 흘린다 — 호출자가 SSE error 로 변환한다.
          onError.accept("AI 홈 컴포저가 아직 설정되지 않았어요. 관리자에게 문의해주세요.");
          return;
        }
        log.error("ai-agent chat 비정상 상태: {} body={}", resp.statusCode(), body);
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
            if ("progress".equals(event)) {
              // #333 M2: 위임 진행 라벨 — 중간 이벤트이므로 콜백 후 루프 계속(return X).
              String label = parseProgressLabel(data);
              if (label != null) {
                onProgress.accept(label);
              }
            } else if ("pending_action".equals(event)) {
              // #333 M2: 확인 카드용 제안 객체. 타입 계약은 confirm 엔드포인트가 소유하므로
              // 프록시는 raw JsonNode 로만 흘린다(widgets 와 동일 무계약 패스스루). 루프 계속.
              JsonNode node = parsePendingAction(data);
              if (node != null) {
                onPendingAction.accept(node);
              }
            } else if ("tool".equals(event)) {
              // 도구 호출 라이브 이벤트 — 상위로 패스스루(표시·누적용). 루프 계속.
              try {
                JsonNode node = mapper.readTree(data);
                if (node != null && onTool != null) {
                  onTool.accept(node);
                }
              } catch (Exception e) {
                // 파싱 실패는 무시(중간 이벤트이므로 스트림을 끊지 않음)
              }
            } else if ("delta".equals(event)) {
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
              log.error("ai-agent home chat stream error: {}", data);
              onError.accept("AI 구성 요청에 실패했어요. 잠시 후 다시 시도해주세요.");
              return;
            }
          }
        }
      }
      // 여기 도달 = done/error 이벤트 없이 본문 스트림이 끝난 경우. 두 트리거를 구분한다 (#347).
      // (1) 취소(SseEmitter 타임아웃·클라이언트 끊김 → Future.cancel(true) → 인터럽트로 루프 break):
      //     emitter 는 이미 정리됐으므로 콜백 없이 조용히 종료. onDone 을 부르면 닫힌 emitter 에
      //     쓰는 무의미한 동작일 뿐 아니라 빈 ASSISTANT 행을 세션에 영속시킨다.
      if (Thread.currentThread().isInterrupted()) {
        return;
      }
      // (2) 연결은 살아있는데 done 없이 EOF(에이전트 비정상 종료): ASSISTANT 영속 금지.
      //     onDone 을 부르지 않아 빈 행을 남기지 않고, onError 로 마감해 살아있는 emitter 가
      //     300s 타임아웃까지 매달리지 않게 한다.
      log.error("ai-agent home chat 스트림이 done 이벤트 없이 종료됨");
      onError.accept("AI 응답이 완료되지 않았어요. 잠시 후 다시 시도해주세요.");

    } catch (Exception e) {
      log.error("ai-agent home chat 실패: {}", e.getMessage());
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

  /** {@code {"label":"..."}} 에서 label 추출. 형식이 다르면 null. */
  private String parseProgressLabel(String data) {
    try {
      JsonNode node = mapper.readTree(data);
      JsonNode label = node.get("label");
      return (label != null && label.isTextual()) ? label.asText() : null;
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * #351: pending_action data 를 JsonNode 로 파싱. 단일 객체/배열 모두 허용.
   *
   * <ul>
   *   <li>배열: 비면 무시, 비지 않으면 ArrayNode 그대로 반환.
   *   <li>단일 객체(하위호환): actionType 필드가 있으면 길이 1 ArrayNode 로 래핑해 반환. 이후 프론트/실행기는 항상 배열 계약만 처리하면 된다.
   *   <li>파싱 실패 또는 알 수 없는 구조: null 반환.
   * </ul>
   */
  private JsonNode parsePendingAction(String data) {
    try {
      JsonNode node = mapper.readTree(data);
      if (node == null) return null;
      if (node.isArray()) {
        // 배열: 빈 배열은 무시. 원소 형태 검증은 프론트/실행기에 위임.
        return node.isEmpty() ? null : node;
      }
      // 하위호환: 단일 객체가 오면 길이 1 배열로 감싸 항상 배열 계약으로 중계.
      if (node.isObject() && node.has("actionType")) {
        return mapper.createArrayNode().add(node);
      }
      return null;
    } catch (Exception e) {
      return null;
    }
  }
}

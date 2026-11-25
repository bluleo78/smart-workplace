package com.workplace.airun.outbound;

import com.workplace.airun.context.AiRunHeader;
import com.workplace.airun.dto.AiRunRecord;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.global.json.JsonMappers;
import com.workplace.global.outbound.AgentOutageGuard;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Stream;
import javax.net.ssl.SSLSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * ai-agent 에 닿기 전(또는 5xx 로 끝난) 호출의 실패를 AI 처리 기록(FAILED)으로 남기는 공용 도우미 (WP-1829).
 *
 * <p>왜: 요청이 ai-agent 에 도달하지 못하면 ai-agent 가 기록할 수 없어 처리 이력에 구멍이 생긴다. API 쪽에서 같은 runId 로 FAILED 를 남겨
 * 메운다. 인터셉터와 스트림 클라이언트가 함께 쓴다.
 */
public final class AiRunFailures {

  private static final Logger log = LoggerFactory.getLogger(AiRunFailures.class);

  private AiRunFailures() {}

  /**
   * 실패를 FAILED 로 기록한다. kind 가 없으면(경로 표에 없음) 아무것도 하지 않는다. 기록 중 어떤 예외도 삼켜 호출 결과를 바꾸지 않는다.
   *
   * @param reason 실패 사유 코드(agent_unreachable·agent_timeout·http_5xx)
   * @param detail 사유 상세(예외 메시지). 없으면 null
   */
  public static void recordFailure(
      AiRunRecorder r, AiRunHeader.Call call, String reason, String detail) {
    if (call == null || call.kind() == null) {
      return;
    }
    try {
      r.upsert(
          AiRunRecord.terminal(
              call.runId(),
              call.tenantId(),
              call.kind(),
              call.ctx(),
              call.actorType(),
              call.actorId(),
              call.startedAt(),
              OffsetDateTime.now(),
              "FAILED",
              reason,
              detail));
    } catch (RuntimeException e) {
      // 기록 경로가 바뀌어도 호출 결과(예외·응답)를 지키는 마지막 방어선이다(WP-1829).
      log.warn("AI 처리 실패 기록 중 오류(무시): runId={}", call.runId(), e);
    }
  }

  /**
   * 5xx 응답을 FAILED 로 기록한다. 사유(error_reason)에는 {@code http_<코드>} 표지를 남기고 상세(error_detail)는 비운다.
   *
   * <p>왜: 표지를 사유에 두면 사유 없는 FAILED 를 막고, 상세는 ai-agent 의 늦은 보고가 채울 수 있다. 표지 사유는 keep-first 의 예외로 그 뒤
   * 온 실제 사유가 덮어쓴다 — 옛 구현은 사유를 비우고 상세에 {@code http_<코드>} 를 먼저 채워 ① ai-agent 가 보고한 실제 오류가 영구히 묻히고 ②
   * 5xx 로 끝나 사유 없는 FAILED 가 남았다(WP-1827 규칙 위반, WP-1829 리뷰 반영).
   */
  private static void recordServerError(
      AiRunRecorder r, AiRunHeader.Call call, int status, String body) {
    recordFailure(r, call, serverErrorReason(status, body), null);
  }

  /** 응답이 5xx 면 {@link #recordServerError} 로 기록한다(본문 없이 — 사유는 http_코드). 4xx·200 은 기록하지 않는다. */
  public static void recordIfServerError(AiRunRecorder r, AiRunHeader.Call call, int status) {
    recordIfServerError(r, call, status, null);
  }

  /** 응답이 5xx 면 기록한다. 본문 JSON 의 reason 이 알려진 원인 코드면 그 소문자 코드를 사유로 쓴다(WP-2106). */
  public static void recordIfServerError(
      AiRunRecorder r, AiRunHeader.Call call, int status, String body) {
    if (status >= 500) {
      recordServerError(r, call, status, body);
    }
  }

  /** ai-agent 5xx 본문 {@code {"reason":"PROVIDER_LIMIT"}} 의 reason 으로 인정하는 원인 코드(대문자). */
  private static final Set<String> KNOWN_REASONS =
      Set.of(
          "PROVIDER_LIMIT",
          "PROVIDER_AUTH",
          "PROVIDER_RATE",
          "PROVIDER_OVERLOADED",
          "PROVIDER_ERROR",
          "RUNNER_UNAVAILABLE");

  /**
   * 5xx 의 사유 코드. 본문 JSON 에 알려진 reason 이 있으면 소문자 코드(provider_limit 등), 없거나 본문이 JSON 이 아니면 {@code
   * http_<코드>}.
   *
   * <p>왜: ai-agent 가 503 으로 끝낸 원인(사용 한도 초과 등)을 API 쪽 실패 기록에도 남겨야 AI 현황이 한도 초과를 일반 실패와 가른다. 파싱 실패는
   * 어떤 경우에도 기록·응답을 막지 않는다.
   */
  public static String serverErrorReason(int status, String body) {
    if (body != null && !body.isBlank()) {
      try {
        Object reason = JsonMappers.JACKSON2.readValue(body, Map.class).get("reason");
        if (reason instanceof String s && KNOWN_REASONS.contains(s)) {
          return s.toLowerCase(Locale.ROOT);
        }
      } catch (RuntimeException e) {
        // JSON 이 아니거나 모양이 다르면 http_<코드> 로 둔다.
      }
    }
    return "http_" + status;
  }

  /**
   * SSE 요청 한 건을 보낸다 — 호출 정보 시작 → X-AI-Run 헤더 싣기 → 전송(I/O 오류는 FAILED 기록 뒤 같은 예외를 다시 던짐) → 5xx 기록을 한
   * 번에 한다. 스레드 인터럽트(취소)는 기록하지 않는다. 세 SSE 클라이언트(chat·wiki·drive)가 함께 쓴다.
   *
   * @param path ai-agent 경로(kind 를 정하는 키)
   * @param build 헤더 값을 받아 요청을 만드는 함수 — 호출마다 새 runId 의 헤더가 요청에 실려야 하므로 요청 생성을 이쪽에서 부른다
   */
  public static HttpResponse<Stream<String>> send(
      HttpClient http, AiRunRecorder r, String path, Function<String, HttpRequest> build)
      throws IOException, InterruptedException {
    AiRunHeader.Call call = AiRunHeader.begin(path);
    HttpRequest req = build.apply(AiRunHeader.encode(call));
    HttpResponse<Stream<String>> resp;
    try {
      resp = http.send(req, HttpResponse.BodyHandlers.ofLines());
    } catch (IOException e) {
      if (!isInterrupt(e)) {
        recordFailure(r, call, reasonFor(e), e.getMessage());
      }
      throw e;
    }
    if (resp.statusCode() < 500) {
      return resp;
    }
    // 5xx 는 본문의 reason 을 읽어야 하므로 줄을 모두 읽어 두고, 호출자에게는 같은 줄을 다시 주는 응답을 돌려준다(WP-2106).
    List<String> lines;
    try (Stream<String> body = resp.body()) {
      lines = body.toList();
    }
    recordIfServerError(r, call, resp.statusCode(), String.join("", lines));
    return new ReplayedResponse(resp, lines);
  }

  /** 본문을 미리 읽어 둔 응답 — 나머지는 원 응답에 위임하고 body() 만 읽어 둔 줄로 새 스트림을 만든다. */
  private record ReplayedResponse(HttpResponse<Stream<String>> delegate, List<String> lines)
      implements HttpResponse<Stream<String>> {
    @Override
    public int statusCode() {
      return delegate.statusCode();
    }

    @Override
    public HttpRequest request() {
      return delegate.request();
    }

    @Override
    public Optional<HttpResponse<Stream<String>>> previousResponse() {
      return delegate.previousResponse();
    }

    @Override
    public HttpHeaders headers() {
      return delegate.headers();
    }

    @Override
    public Stream<String> body() {
      return lines.stream();
    }

    @Override
    public Optional<SSLSession> sslSession() {
      return delegate.sslSession();
    }

    @Override
    public URI uri() {
      return delegate.uri();
    }

    @Override
    public HttpClient.Version version() {
      return delegate.version();
    }
  }

  /**
   * 사용자가 취소해 끊긴 인터럽트인지 — 원인 체인에 InterruptedException 이 있거나, 시간 초과가 아닌 InterruptedIOException 이다.
   *
   * <p>왜: Spring 의 JdkClientHttpRequest 는 인터럽트를 IOException("Request was interrupted") 로 감싼다. 취소는
   * ai-agent 장애가 아니므로 FAILED 로 기록하지 않는다.
   */
  public static boolean isInterrupt(IOException e) {
    return anyInCauseChain(
        e,
        t ->
            t instanceof InterruptedException
                || (t instanceof InterruptedIOException && !(t instanceof SocketTimeoutException)));
  }

  /**
   * I/O 예외의 사유 코드 — 읽기 시간 초과는 agent_timeout, 연결 단계 시간 초과와 그 밖엔 agent_unreachable.
   *
   * <p>왜: 연결 시간 초과(HttpConnectTimeoutException)는 HttpTimeoutException 의 하위라 구분이 필요하다 — {@link
   * AgentOutageGuard#isReadTimeout} 이 연결 시간 초과는 false, 읽기 시간 초과는 true 로 가려 준다. SYN 을 버리는 다운 상태가
   * 「느림」이 아니라 「닿지 못함」으로 보이게 한다(WP-1829).
   */
  public static String reasonFor(IOException e) {
    return AgentOutageGuard.isReadTimeout(e) ? "agent_timeout" : "agent_unreachable";
  }

  /** 원인 체인(자기 순환 방지)을 따라가며 조건에 맞는 예외가 하나라도 있는지 본다. */
  private static boolean anyInCauseChain(Throwable start, Predicate<Throwable> test) {
    for (Throwable t = start; t != null; t = t.getCause()) {
      if (test.test(t)) {
        return true;
      }
      if (t.getCause() == t) {
        break;
      }
    }
    return false;
  }
}

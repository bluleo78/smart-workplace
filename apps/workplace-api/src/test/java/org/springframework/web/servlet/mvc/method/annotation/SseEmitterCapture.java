package org.springframework.web.servlet.mvc.method.annotation;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;

/**
 * 테스트 전용 — {@link SseEmitter} 가 실제로 보낸 SSE 프레임을 그대로 읽는 캡처(WP-1973 두 파드 시뮬레이션).
 *
 * <p>{@link ResponseBodyEmitter#initialize(ResponseBodyEmitter.Handler)} 와 {@link
 * ResponseBodyEmitter.Handler} 는 스프링 내부(패키지 공개)라 중계 테스트 패키지에서 붙을 수 없다 — 같은 패키지에 헬퍼를 두어 붙인다(리플렉션 없이
 * 타입 안전).
 *
 * <p>{@code send(SseEventBuilder)} 한 번은 이벤트 조각들({@code LinkedHashSet} — SSE 작성 순서 그대로)로 오므로 이어 붙여 한
 * 프레임 문자열로 파싱한다. 코멘트 전용 프레임(연결 코멘트·하트비트)은 이벤트가 아니므로 받지 않는다.
 */
public final class SseEmitterCapture {

  private SseEmitterCapture() {}

  /**
   * emitter 에 캡처 핸들러를 붙인다 — 붙는 순간부터 보낸 프레임을 {@code received} 에 넣는다. 등록 직후의 「연결」 코멘트는 붙이기 전에 보낸 것이라
   * {@code earlySendAttempts} 로 남아 붙는 순간 같이 도착한다.
   */
  public static void attach(SseEmitter emitter, Consumer<ServerSentEvent<String>> received) {
    try {
      emitter.initialize(new CapturingHandler(received));
    } catch (IOException e) {
      throw new IllegalStateException("SSE 캡처 핸들러 부착에 실패했다", e);
    }
  }

  /** 보낸 값을 읽어 프레임 하나를 {@link ServerSentEvent} 로 바꿔 넣는 핸들러 — 스프링이 넘겨준 콜백은 그대로 실행해 연결 수명을 유지한다. */
  private static final class CapturingHandler implements ResponseBodyEmitter.Handler {

    private final Consumer<ServerSentEvent<String>> received;

    /**
     * 스프링이 {@code initialize} 에 넘겨준 콜백 — complete/error 가 오면 여기 있는 것을 실행한다(그래야 onCompletion 이 불린다).
     */
    private Runnable completion = () -> {};

    private Consumer<Throwable> error = t -> {};

    private CapturingHandler(Consumer<ServerSentEvent<String>> received) {
      this.received = received;
    }

    @Override
    public void send(Object payload, MediaType mediaType) {
      accept(parse(String.valueOf(payload)));
    }

    @Override
    public void send(Set<ResponseBodyEmitter.DataWithMediaType> data) {
      StringBuilder frame = new StringBuilder();
      for (ResponseBodyEmitter.DataWithMediaType piece : data) {
        frame.append(piece.getData());
      }
      accept(parse(frame.toString()));
    }

    @Override
    public void complete() {
      completion.run();
    }

    @Override
    public void completeWithError(Throwable t) {
      error.accept(t);
      completion.run();
    }

    @Override
    public void onTimeout(Runnable callback) {
      // 타임아웃 콜백은 서블릿 비동기 응답에서만 등록된다 — 캡처는 그 응답이 없어 무시해도 연결 수명에 영향이 없다.
    }

    @Override
    public void onError(Consumer<Throwable> callback) {
      this.error = callback;
    }

    @Override
    public void onCompletion(Runnable callback) {
      this.completion = callback;
    }

    /** 이벤트가 있는 프레임만 넣는다 — 코멘트만 있는 프레임(연결 코멘트·하트비트)은 null 로 걸러진다. */
    private void accept(ServerSentEvent<String> event) {
      if (event != null) received.accept(event);
    }

    /**
     * SSE 프레임 문자열 → {@link ServerSentEvent} — {@code event}·{@code data}·{@code id}·코멘트를 한 줄씩 읽는다.
     * 여러 data 줄은 SSE 규약대로 개행으로 이어 붙인다. 이벤트 이름도 data 도 없는(코멘트 전용) 프레임은 null.
     */
    private static ServerSentEvent<String> parse(String frame) {
      String event = null;
      String id = null;
      String comment = null;
      List<String> dataLines = new ArrayList<>();
      for (String line : frame.split("\n")) {
        if (line.isEmpty()) continue;
        if (line.startsWith(":")) {
          comment = line.substring(1);
          continue;
        }
        int colon = line.indexOf(':');
        String field = colon < 0 ? line : line.substring(0, colon);
        String value = colon < 0 ? "" : line.substring(colon + 1);
        if (value.startsWith(" ")) value = value.substring(1);
        switch (field) {
          case "event" -> event = value;
          case "data" -> dataLines.add(value);
          case "id" -> id = value;
          default -> {
            // retry 등 모르는 필드는 건너뛴다 — 테스트가 쓰지 않는다.
          }
        }
      }
      if (event == null && dataLines.isEmpty()) return null;
      ServerSentEvent.Builder<String> builder = ServerSentEvent.builder();
      if (event != null) builder.event(event);
      if (!dataLines.isEmpty()) builder.data(String.join("\n", dataLines));
      if (id != null) builder.id(id);
      if (comment != null) builder.comment(comment);
      return builder.build();
    }
  }
}

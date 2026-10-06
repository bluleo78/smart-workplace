package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.extern.slf4j.Slf4j;

/**
 * 홈 채팅 턴 1회의 이벤트 봉투와 종결 처리(WP-190).
 *
 * <p>모든 home.chat.* 이벤트에 correlationId·sessionId 를 실어 웹이 대화별 칸으로 라우팅하게 하고,
 * 종결(done·error·cancelled)은 정확히 한 번 "영속 → 슬롯 반납 → 종결 이벤트" 순서로 처리한다. 반납을 이벤트보다 먼저 하는 이유: 웹이 done 을
 * 받자마자 같은 대화로 다음 질문을 보내도 409(CHAT_SESSION_BUSY)에 막히지 않게 하기 위함이다.
 */
@Slf4j
final class HomeChatTurn {

  static final String STATUS_COMPLETE = "COMPLETE";
  static final String STATUS_STOPPED = "STOPPED";
  static final String STATUS_FAILED = "FAILED";

  private final long callerId;
  private final UUID sessionId;
  private final StreamingGenerationRegistry.Reservation reservation;
  private final HomeSessionService sessionService;
  private final SseRegistry sseRegistry;
  private final ObjectMapper objectMapper;
  private final AtomicBoolean finished = new AtomicBoolean(false);

  /** 위임 라벨 + 표시 가능 도구 호출(도착순) — 영속 시 home_message.tool_calls. 펌프 스레드에서 쓰고 종결 때 읽는다. */
  final List<Map<String, Object>> steps = new CopyOnWriteArrayList<>();

  /** 텍스트·도구 그룹·위젯의 도착 순서(WP-158) — 영속 시 home_message.content_blocks. */
  final ChatBlockRecorder blocks = new ChatBlockRecorder();

  HomeChatTurn(
      long callerId,
      UUID sessionId,
      StreamingGenerationRegistry.Reservation reservation,
      HomeSessionService sessionService,
      SseRegistry sseRegistry,
      ObjectMapper objectMapper) {
    this.callerId = callerId;
    this.sessionId = sessionId;
    this.reservation = reservation;
    this.sessionService = sessionService;
    this.sseRegistry = sseRegistry;
    this.objectMapper = objectMapper;
  }

  /** 이벤트 발행 — 봉투 공통 필드(correlationId·sessionId)를 덧붙인다. data 는 null 값을 가질 수 있다(done 의 widgets). */
  void emit(String event, Map<String, ?> data) {
    Map<String, Object> payload = new LinkedHashMap<>(data);
    payload.put("correlationId", reservation.correlationId());
    payload.put("sessionId", sessionId.toString());
    sseRegistry.fanOut(Set.of(callerId), event, payload);
  }

  /** 종결 이벤트가 이미 나갔는가 — 펌프가 "콜백 없이 끝난" 경우를 가려 마감할 때 쓴다(R8). */
  boolean isFinished() {
    return finished.get();
  }

  /** 정상 완료 — ASSISTANT(COMPLETE) 영속 → 반납 → home.chat.done → afterDone(누적 요약 예약 등). */
  void complete(String fullText, JsonNode widgets, Runnable afterDone) {
    if (!finished.compareAndSet(false, true)) return;
    String widgetsJson = widgets == null || widgets.isNull() ? null : toJson(widgets, "widgets");
    persist(
        fullText,
        widgetsJson,
        toJsonList(steps, "tool_calls"),
        toJsonList(blocks.finish(fullText), "content_blocks"),
        STATUS_COMPLETE);
    reservation.release();
    Map<String, Object> data = new HashMap<>();
    data.put("widgets", widgets);
    emit("home.chat.done", data);
    afterDone.run();
  }

  /** 오류 종결 — 누적분을 FAILED 로 남기고 반납 → home.chat.error{message}. */
  void fail(String message) {
    if (!finished.compareAndSet(false, true)) return;
    persistPartial(STATUS_FAILED);
    reservation.release();
    emit("home.chat.error", Map.of("message", message));
  }

  /** 취소 종결(사용자 ■·타임아웃) — 누적분을 STOPPED 로 남기고 반납 → home.chat.cancelled{reason} (+ 구 웹 호환 error). */
  void cancel() {
    if (!finished.compareAndSet(false, true)) return;
    persistPartial(STATUS_STOPPED);
    reservation.release();
    String reason =
        reservation.cancelReason() == StreamingGenerationRegistry.CancelReason.TIMEOUT
            ? "timeout"
            : "user";
    emit("home.chat.cancelled", Map.of("reason", reason));
    // 구 웹 호환(R6): 구 웹은 cancelled 를 모르고 error{cancelled:true} 로 타임아웃을 알아챈다. 신 웹은 이 이벤트를 무시한다.
    // 신 웹이 운영에 반영된 다음 배포에서 제거한다.
    emit("home.chat.error", Map.of("cancelled", true));
  }

  /** 부분 답변 저장 — 누적 텍스트가 비면 질문만 남긴다(현행 유지). 끝나지 않은 도구 단계는 error 로 닫는다(R10). */
  private void persistPartial(String status) {
    String text = blocks.streamedText();
    if (text.isBlank()) return;
    List<Map<String, Object>> settled = steps.stream().map(HomeChatTurn::settleRunning).toList();
    persist(
        text,
        null,
        toJsonList(settled, "tool_calls"),
        toJsonList(blocks.finish(text), "content_blocks"),
        status);
  }

  /** running 도구 단계를 error 로 — 복원 화면에서 영원히 "실행 중" 으로 돌지 않게. */
  private static Map<String, Object> settleRunning(Map<String, Object> step) {
    if (!"running".equals(step.get("status"))) return step;
    Map<String, Object> s = new LinkedHashMap<>(step);
    s.put("status", "error");
    return s;
  }

  /**
   * ASSISTANT 영속. 취소는 스레드 인터럽트로 오므로 플래그가 선 채 JDBC 를 타면 드라이버가 소켓 작업을 거부할 수 있다 — 플래그를 잠시 내리고 저장한 뒤
   * 되돌린다. 펌프 스레드엔 바깥 트랜잭션이 없어 appendMessage(@Transactional)가 곧 독립 트랜잭션이다(R7).
   */
  private void persist(
      String content, String widgetsJson, String toolCallsJson, String blocksJson, String status) {
    boolean interrupted = Thread.interrupted();
    try {
      sessionService.appendMessage(
          callerId,
          sessionId,
          "ASSISTANT",
          content,
          widgetsJson,
          toolCallsJson,
          blocksJson,
          status);
    } catch (Exception e) {
      // 영속 실패(예: 생성 중 대화 삭제)는 종결 이벤트를 막지 않는다 — 웹이 멈춘 채 남지 않게.
      log.error("ASSISTANT 메시지 영속 실패({}): {}", status, e.getMessage(), e);
    } finally {
      if (interrupted) Thread.currentThread().interrupt();
    }
  }

  /** 누적 목록 → JSON. null/빈 목록이면 null(미저장 컨벤션 — 웹은 폴백 렌더). */
  private String toJsonList(List<?> list, String column) {
    return list == null || list.isEmpty() ? null : toJson(list, column);
  }

  /** 직렬화 실패는 응답을 막을 만큼 치명적이지 않다 — 해당 컬럼 없이 메시지만 보존. */
  private String toJson(Object value, String column) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      log.warn("{} 직렬화 실패 — null 로 저장: {}", column, e.getMessage());
      return null;
    }
  }
}

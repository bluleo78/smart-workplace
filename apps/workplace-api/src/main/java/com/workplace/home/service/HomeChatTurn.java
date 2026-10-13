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
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
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
  private final ObjectMapper objectMapper;

  /** 이벤트 봉투(사용자·대화·correlationId) — 후속 질문처럼 턴이 끝난 뒤 발행하는 작업은 턴 대신 이것만 잡는다(WP-139). */
  private final HomeChatEnvelope envelope;

  private final AtomicBoolean finished = new AtomicBoolean(false);

  /** 위임 라벨 + 표시 가능 도구 호출(도착순) — 영속 시 home_message.tool_calls. 펌프 스레드에서 쓰고 종결 때 읽는다. */
  final List<Map<String, Object>> steps = new CopyOnWriteArrayList<>();

  /** 텍스트·도구 그룹·위젯의 도착 순서(WP-158) — 영속 시 home_message.content_blocks. */
  final ChatBlockRecorder blocks = new ChatBlockRecorder();

  /**
   * 이번 턴에 확인 카드(pending_action)가 나왔는가 — 후속 질문 대상에서 빼는 근거(WP-139). AiAgentChatClient.composeStream 이
   * 동기 send 후 줄 루프에서 콜백을 호출 스레드(펌프)로 부르므로, pending_action 콜백이 쓰고 같은 펌프 스레드의 afterDone 이 읽는다 — 스레드 간
   * 공유가 없어 volatile 이 필요 없다.
   */
  private boolean proposed;

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
    this.objectMapper = objectMapper;
    // correlationId 는 예약 시점에 발급돼 바뀌지 않으므로 봉투에 한 번 옮겨 둔다.
    this.envelope =
        new HomeChatEnvelope(callerId, sessionId, reservation.correlationId(), sseRegistry);
  }

  /** 이벤트 발행 — 봉투 공통 필드(correlationId·sessionId)를 덧붙인다. data 는 null 값을 가질 수 있다(done 의 widgets). */
  void emit(String event, Map<String, ?> data) {
    envelope.emit(event, data);
  }

  /** 이벤트 봉투 — 턴이 끝난 뒤에도 같은 대화로 발행해야 하는 작업(후속 질문)에 넘긴다(WP-139). */
  HomeChatEnvelope envelope() {
    return envelope;
  }

  /** 확인 카드 발행 표시(WP-139). */
  void markProposed() {
    proposed = true;
  }

  /** 이번 턴에 확인 카드가 나왔는가(WP-139). */
  boolean proposed() {
    return proposed;
  }

  /** 종결 이벤트가 이미 나갔는가 — 펌프가 "콜백 없이 끝난" 경우를 가려 마감할 때 쓴다(R8). */
  boolean isFinished() {
    return finished.get();
  }

  /**
   * 정상 완료 — ASSISTANT(COMPLETE) 영속 → 반납 → home.chat.done → afterDone(누적 요약·후속 질문 예약). afterDone 에는
   * 저장한 메시지 id(영속 실패면 null)를 넘긴다(WP-139). done 에는 widgets 와 저장한 메시지 id(WP-55)를 싣는다.
   */
  void complete(String fullText, JsonNode widgets, Consumer<Long> afterDone) {
    if (!finished.compareAndSet(false, true)) return;
    String widgetsJson = widgets == null || widgets.isNull() ? null : toJson(widgets, "widgets");
    Long messageId =
        persist(
            fullText,
            widgetsJson,
            toJsonList(steps, "tool_calls"),
            toJsonList(blocks.finish(fullText), "content_blocks"),
            STATUS_COMPLETE);
    reservation.release();
    emitTerminal("home.chat.done", "widgets", widgets, messageId);
    afterDone.accept(messageId);
  }

  /**
   * 오류 종결 — 누적분을 FAILED 로 남기고 반납 → home.chat.error{message, messageId}. messageId 는 저장한 부분 답변
   * id(저장하지 않았으면 null) — 그 턴의 메모리 결과 줄 되돌리기를 다시 열지 않아도 켜기 위해서다(WP-55).
   */
  void fail(String message) {
    if (!finished.compareAndSet(false, true)) return;
    Long messageId = persistPartial(STATUS_FAILED);
    reservation.release();
    emitTerminal("home.chat.error", "message", message, messageId);
  }

  /**
   * 취소 종결(사용자 ■·타임아웃) — 누적분을 STOPPED 로 남기고 반납 → home.chat.cancelled{reason, messageId}(fail 과 같은
   * 이유).
   */
  void cancel() {
    if (!finished.compareAndSet(false, true)) return;
    Long messageId = persistPartial(STATUS_STOPPED);
    reservation.release();
    String reason =
        reservation.cancelReason() == StreamingGenerationRegistry.CancelReason.TIMEOUT
            ? "timeout"
            : "user";
    emitTerminal("home.chat.cancelled", "reason", reason, messageId);
  }

  /**
   * 종결 이벤트 발행 — 종류별 필드 하나(widgets·message·reason)와 저장한 메시지 id(WP-55). messageId 는 웹이 라이브 답의 결과 줄
   * 되돌리기를 종결 직후 켜는 근거다(판정 8) — 저장하지 않았거나 영속에 실패하면 null 이라 Map.of(null 불가) 대신 HashMap 을 쓴다.
   */
  private void emitTerminal(String event, String key, Object value, Long messageId) {
    Map<String, Object> data = new HashMap<>();
    data.put(key, value);
    data.put("messageId", messageId);
    emit(event, data);
  }

  /**
   * 부분 답변 저장 — 누적 텍스트도 메모리 결과 줄도 없으면 질문만 남긴다(현행 유지). 끝나지 않은 도구 단계는 error 로 닫는다(R10).
   *
   * @return 저장한 메시지 id — 저장하지 않았거나 실패하면 null
   */
  private Long persistPartial(String status) {
    String text = blocks.streamedText();
    // WP-55: 텍스트가 없어도 메모리 결과 줄이 있으면 저장한다 — 메모리 변경은 이미 반영됐으므로 messageId 가 있어야 그 줄의 되돌리기가
    // 켜지고 다시 열어도 남는다(빈 본문 + memory 블록 — 웹은 결과 줄만 그린다).
    if (text.isBlank() && !blocks.hasMemory()) return null;
    List<Map<String, Object>> settled = steps.stream().map(HomeChatTurn::settleRunning).toList();
    // 공백뿐인 본문("\n"·"\t" 등)은 빈 문자열로 정규화해 저장한다 — 맥락 필터(빈 본문 STOPPED·FAILED 제외)와 웹의 content === ''
    // 판정이 모두 "빈 답" 으로 일관되게 보게. 표시 블록 오프셋은 스트리밍 원문(text) 기준이라 finish 에는 원문을 그대로 넘긴다.
    String content = text.isBlank() ? "" : text;
    return persist(
        content,
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
   *
   * @return 저장한 메시지 id — 영속 실패면 null(WP-139 후속 질문이 저장 대상 id 로 쓴다)
   */
  private Long persist(
      String content, String widgetsJson, String toolCallsJson, String blocksJson, String status) {
    boolean interrupted = Thread.interrupted();
    try {
      return sessionService.appendMessage(
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
      return null;
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

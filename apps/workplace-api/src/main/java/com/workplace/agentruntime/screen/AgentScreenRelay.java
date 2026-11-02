package com.workplace.agentruntime.screen;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.PingMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

/**
 * AI 작업 화면 중계 레지스트리(WP-1277) — 관리자 브라우저 소켓과 runner 소켓을 세션 id 로 짝지어 프레임을 넘긴다. API 한 대 전제로 메모리에만 둔다
 * (여러 대로 늘리면 두 소켓이 다른 파드에 붙을 수 있다 — docs/ops/multi-instance.md).
 *
 * <p>흐름: POST 가 {@link #reserve} 로 자리를 잡는다(표 만료까지 브라우저가 안 붙으면 닫힘) → 브라우저가 표로 붙으면 {@link
 * #attachBrowser} 가 그 위치의 runner 에게 SSE {@code agent-runtime.screen} 을 보낸다 → runner 가 15초 안에 {@link
 * #attachRunner} 로 붙지 않으면 닫힘 → 이후 프레임을 양쪽으로 넘긴다. 한쪽이 닫히면 다른 쪽도 닫고 세션 행에 닫힌 때·까닭을 남긴다.
 *
 * <p>열린 화면 수(AI 당 3개)와 「다른 관리자가 이미 입력 중」 판정은 이 메모리로 한다 — DB 의 열린 행으로 세면 재시작·쓰지 않은 표로 남은 행이 자리를 영영
 * 막는다. 두 판정은 이 객체의 잠금 아래에서 해 동시 요청이 함께 통과하지 않게 한다.
 *
 * <p>타이머(25초 핑, 1초 입력 기록 꺼내기, 만료·무활동 검사)는 파드 로컬 소켓을 다뤄 모든 파드에서 돌아야 하므로 {@code @Scheduled}·분산 잠금 대신
 * 전용 스케줄러 스레드 하나로 돈다.
 */
@Component
@Slf4j
public class AgentScreenRelay {

  /** SSE 이벤트 이름 — runner 가 이 이름으로 화면을 잇는다(계약: agent-runner-api.md). */
  public static final String SCREEN_EVENT = "agent-runtime.screen";

  static final Duration RUNNER_JOIN_TIMEOUT = Duration.ofSeconds(15);
  static final Duration IDLE_TIMEOUT = Duration.ofMinutes(30);
  static final Duration MAX_LIFETIME = Duration.ofHours(4);
  static final Duration PING_INTERVAL = Duration.ofSeconds(25);

  /** 소켓 쓰기 상한 — 한 번의 보내기가 이보다 오래 걸리거나 밀린 양이 넘치면 그 소켓을 끊는다(느린 쪽이 중계 스레드를 붙잡지 않게). */
  private static final int SEND_TIME_LIMIT_MS = 10_000;

  private static final int SEND_BUFFER_LIMIT = 1024 * 1024;

  static final String REASON_RUNNER_JOIN = "실행 환경에 연결하지 못했어요";
  static final String REASON_NOT_OPENED = "작업 화면을 열지 않았어요";
  static final String REASON_BROWSER_CLOSED = "관리자가 화면을 닫았어요";
  static final String REASON_RUNNER_CLOSED = "실행 환경과의 연결이 끊겼어요";
  static final String REASON_IDLE = "30분 동안 주고받은 것이 없어 닫았어요";
  static final String REASON_MAX = "4시간이 지나 닫았어요";
  static final String REASON_SHUTDOWN = "서버가 멈춰 닫았어요";
  static final String INPUT_TAKEN = "다른 관리자가 이미 입력 중이에요";

  /** 세션 하나의 중계 상태. 소켓은 동시 보내기에 안전하도록 {@link ConcurrentWebSocketSessionDecorator} 로 감싼 것이다. */
  static final class Pair {
    final UUID id;
    final long tenantId;
    final long agentUserId;
    final long locationId;
    final long openedBy;
    final Instant createdAt = Instant.now();
    final Instant ticketDeadline;
    final AtomicBoolean closed = new AtomicBoolean();
    final ScreenInputRecorder recorder = new ScreenInputRecorder();
    volatile WebSocketSession browser;
    volatile WebSocketSession runner;
    volatile Instant browserAttachedAt;
    volatile Instant lastActivity = Instant.now();
    // runner 가 입력을 켰다고 알린 뒤에만 참 — 이 동안에만 브라우저 키 입력을 넘긴다.
    volatile boolean inputEnabled;

    Pair(
        UUID id,
        long tenantId,
        long agentUserId,
        long locationId,
        long openedBy,
        Instant ticketDeadline) {
      this.id = id;
      this.tenantId = tenantId;
      this.agentUserId = agentUserId;
      this.locationId = locationId;
      this.openedBy = openedBy;
      this.ticketDeadline = ticketDeadline;
    }
  }

  private final Map<UUID, Pair> pairs = new ConcurrentHashMap<>();
  private final RunnerSseRegistry sseRegistry;
  private final AgentScreenTickets tickets;
  private final ObjectMapper objectMapper;
  private final ScheduledExecutorService timer;
  private volatile Instant lastPing = Instant.now();
  // 세션 행·입력 기록 쓰기 — 서비스가 생성 때 넣는다(서비스가 이 레지스트리를 쓰므로 생성자로 받으면 순환이 된다).
  private volatile AgentScreenService service;

  public AgentScreenRelay(
      RunnerSseRegistry sseRegistry, AgentScreenTickets tickets, ObjectMapper objectMapper) {
    this.sseRegistry = sseRegistry;
    this.tickets = tickets;
    this.objectMapper = objectMapper;
    this.timer =
        Executors.newSingleThreadScheduledExecutor(
            r -> {
              Thread t = new Thread(r, "agent-screen-timer");
              t.setDaemon(true);
              return t;
            });
    timer.scheduleWithFixedDelay(this::tick, 1, 1, TimeUnit.SECONDS);
  }

  void setService(AgentScreenService service) {
    this.service = service;
  }

  /** 서버가 멈출 때 열린 화면을 모두 닫고 타이머를 멈춘다(남은 입력 기록도 꺼내 쓴다). */
  @PreDestroy
  void shutdown() {
    pairs.values().forEach(p -> close(p, REASON_SHUTDOWN, true));
    timer.shutdownNow();
  }

  // ---------------------------------------------------------------- 자리·연결

  /** 화면 하나의 자리를 잡는다 — 이 AI 의 열린 화면(아직 안 붙은 것 포함)이 이미 3개면 false. */
  synchronized boolean reserve(
      UUID id,
      long tenantId,
      long agentUserId,
      long locationId,
      long openedBy,
      Instant ticketDeadline) {
    long open =
        pairs.values().stream()
            .filter(p -> p.tenantId == tenantId && p.agentUserId == agentUserId)
            .count();
    if (open >= AgentScreenService.MAX_SESSIONS_PER_AGENT) return false;
    pairs.put(id, new Pair(id, tenantId, agentUserId, locationId, openedBy, ticketDeadline));
    return true;
  }

  /** 기록에 실패한 자리를 돌려준다. */
  void release(UUID id) {
    pairs.remove(id);
    tickets.removeForSession(id);
  }

  /** 브라우저가 붙을 수 있는 세션인지 — 열려 있고 아직 브라우저가 없다. 핸드셰이크에서 본다. */
  boolean canAttachBrowser(UUID id, long tenantId) {
    Pair p = pairs.get(id);
    return p != null && !p.closed.get() && p.tenantId == tenantId && p.browser == null;
  }

  /**
   * runner 가 붙을 수 있는 세션인지 — 열려 있고, 브라우저가 붙어 있고, 아직 runner 가 없고, 세션의 테넌트·위치가 토큰의 것과 같다(다른 위치의 유효한
   * runner 토큰으로는 붙지 못한다).
   */
  boolean canAttachRunner(UUID id, long tenantId, long locationId) {
    Pair p = pairs.get(id);
    return p != null
        && !p.closed.get()
        && p.tenantId == tenantId
        && p.locationId == locationId
        && p.browser != null
        && p.runner == null;
  }

  /** 브라우저 소켓을 붙이고 그 위치의 runner 에게 화면을 이으라고 알린다. 그 사이 세션이 사라졌으면 소켓을 닫는다. */
  void attachBrowser(UUID id, WebSocketSession raw) {
    WebSocketSession s = decorate(raw);
    Pair p;
    synchronized (this) {
      p = pairs.get(id);
      if (p == null || p.closed.get() || p.browser != null) p = null;
      else {
        p.browser = s;
        p.browserAttachedAt = Instant.now();
        p.lastActivity = Instant.now();
      }
    }
    if (p == null) {
      closeQuietly(s, CloseStatus.POLICY_VIOLATION);
      return;
    }
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("sessionId", id.toString());
    data.put("agentUserId", p.agentUserId);
    sseRegistry.send(p.tenantId, p.locationId, SCREEN_EVENT, data);
  }

  /** runner 소켓을 붙인다. 이미 붙어 있거나 세션이 사라졌으면 새 소켓을 닫는다(세션당 runner 하나). */
  void attachRunner(UUID id, WebSocketSession raw) {
    WebSocketSession s = decorate(raw);
    boolean ok;
    synchronized (this) {
      Pair p = pairs.get(id);
      ok = p != null && !p.closed.get() && p.runner == null;
      if (ok) {
        p.runner = s;
        p.lastActivity = Instant.now();
      }
    }
    if (!ok) closeQuietly(s, CloseStatus.POLICY_VIOLATION);
  }

  private static WebSocketSession decorate(WebSocketSession raw) {
    return new ConcurrentWebSocketSessionDecorator(raw, SEND_TIME_LIMIT_MS, SEND_BUFFER_LIMIT);
  }

  // ---------------------------------------------------------------- 프레임

  /**
   * runner → 브라우저: 바이너리(터미널 출력)·텍스트(status·windows·input·error) 모두 그대로 넘긴다. 단 {@code input} 프레임은
   * 넘기기 전에 입력 상태를 맞춘다 — 입력은 runner 가 켰다고 알린 뒤에만 열린 것으로 본다(위치가 입력을 허용하지 않으면 runner 가 켜지 않는다).
   */
  void fromRunner(UUID id, WebSocketMessage<?> message) {
    Pair p = pairs.get(id);
    if (p == null || p.closed.get()) return;
    p.lastActivity = Instant.now();
    if (message instanceof TextMessage t && !runnerInput(p, t)) return;
    // 바이너리는 복사해 넘긴다 — 보내기가 밀려 버퍼에 쌓이면 컨테이너가 다시 쓰는 수신 버퍼를 나중에 읽게 된다.
    send(p, p.browser, message instanceof BinaryMessage b ? new BinaryMessage(copy(b)) : message);
  }

  /**
   * runner 의 {@code {"type":"input","enabled":…}} 를 반영한다. 켜짐이면 같은 AI 의 다른 화면이 이미 입력 중인지 다시 보고(동시에
   * 켜진 경우) 그렇다면 runner 에 끄기를 보내고 브라우저에 오류를 보낸 뒤 이 프레임은 넘기지 않는다(false). 처음 켜질 때만 세션 행·감사 로그에 남기고,
   * 기록에 실패하면 입력을 열지 않는다. 꺼짐이면 플래그를 내린다. input 이 아닌 프레임은 그대로 true.
   */
  private boolean runnerInput(Pair p, TextMessage message) {
    JsonNode node;
    try {
      node = objectMapper.readTree(message.getPayload());
    } catch (IOException e) {
      return true; // JSON 이 아니어도 runner 출력은 그대로 넘긴다
    }
    if (!"input".equals(node.path("type").asText()) || !node.path("enabled").isBoolean()) {
      return true;
    }
    if (!node.get("enabled").booleanValue()) {
      p.inputEnabled = false;
      return true;
    }
    if (p.inputEnabled) return true;
    if (rejectIfTaken(p)) return false;
    // 기록을 먼저 커밋한 뒤 입력을 연다 — 기록이 남기 전에 키가 넘어가거나, 기록에 실패했는데 키가 이미 넘어간 일이 없게.
    try {
      service.recordInputEnabled(p.tenantId, p.id, p.agentUserId, p.openedBy);
    } catch (RuntimeException e) {
      log.warn("작업 화면 입력 허용 기록 실패 — 입력을 열지 않음 session={}", p.id, e);
      sendJson(p, p.runner, Map.of("type", "input", "enabled", false));
      sendJson(p, p.browser, Map.of("type", "error", "message", "입력 허용을 기록하지 못했어요"));
      return false;
    }
    synchronized (this) {
      // 기록하는 동안 같은 AI 의 다른 화면이 먼저 켰을 수 있다 — 다시 본 뒤 연다.
      if (rejectIfTaken(p)) return false;
      p.inputEnabled = true;
    }
    return true;
  }

  /** 같은 AI 의 다른 화면이 이미 입력 중이면 runner 에 끄기, 브라우저에 오류를 보내고 true. */
  private synchronized boolean rejectIfTaken(Pair p) {
    if (!inputTakenByOther(p)) return false;
    sendJson(p, p.runner, Map.of("type", "input", "enabled", false));
    sendJson(p, p.browser, Map.of("type", "error", "message", INPUT_TAKEN));
    return true;
  }

  /** 같은 AI 의 다른 열린 화면이 runner 가 확인한 입력을 쥐고 있는지. 호출자가 이 객체의 잠금을 쥔다. */
  private boolean inputTakenByOther(Pair p) {
    return pairs.values().stream()
        .anyMatch(
            o ->
                o != p
                    && o.inputEnabled
                    && !o.closed.get()
                    && o.tenantId == p.tenantId
                    && o.agentUserId == p.agentUserId);
  }

  private static byte[] copy(BinaryMessage message) {
    ByteBuffer buf = message.getPayload().asReadOnlyBuffer();
    byte[] bytes = new byte[buf.remaining()];
    buf.get(bytes);
    return bytes;
  }

  /** 브라우저 → runner 텍스트: resize·window 는 그대로, input 은 허용 판정 뒤 넘기고, 모르는 종류는 버린다. */
  void fromBrowserText(UUID id, TextMessage message) {
    Pair p = pairs.get(id);
    if (p == null || p.closed.get()) return;
    p.lastActivity = Instant.now();
    JsonNode node;
    try {
      node = objectMapper.readTree(message.getPayload());
    } catch (IOException e) {
      return; // JSON 이 아니면 버린다
    }
    String type = node.path("type").asText("");
    switch (type) {
      case "resize", "window" -> send(p, p.runner, message);
      case "input" -> {
        JsonNode enabled = node.get("enabled");
        if (enabled == null || !enabled.isBoolean()) return;
        if (enabled.booleanValue()) requestInput(p, message);
        else {
          // 끄기는 runner 확인을 기다리지 않고 바로 키 입력 넘기기를 멈춘다(안전한 쪽).
          p.inputEnabled = false;
          send(p, p.runner, message);
        }
      }
      default -> {
        // 모르는 종류는 runner 로 넘기지 않는다 — 계약에 없는 명령이 터미널에 닿지 않게.
      }
    }
  }

  /**
   * 브라우저의 입력 켜기 요청 — 같은 AI 의 다른 화면이 이미 입력 중이면 막고 브라우저에 오류를 보낸다. 아니면 runner 로 넘길 뿐이다: 입력이 열렸다고 보는
   * 것·기록·감사는 runner 가 켜졌다고 알릴 때({@link #runnerInput})다.
   */
  private void requestInput(Pair p, TextMessage message) {
    synchronized (this) {
      if (inputTakenByOther(p)) {
        sendJson(p, p.browser, Map.of("type", "error", "message", INPUT_TAKEN));
        return;
      }
    }
    send(p, p.runner, message);
  }

  /** 브라우저 → runner 바이너리(키 입력): runner 가 입력을 켰다고 알린 동안에만 넘기고 기록 버퍼에 더한다. 아니면 버린다. */
  void fromBrowserBinary(UUID id, BinaryMessage message) {
    Pair p = pairs.get(id);
    if (p == null || p.closed.get()) return;
    p.lastActivity = Instant.now();
    if (!p.inputEnabled) return;
    byte[] bytes = copy(message);
    send(p, p.runner, new BinaryMessage(bytes));
    p.recorder.append(bytes);
  }

  // ---------------------------------------------------------------- 닫기

  /** 브라우저 소켓이 닫혔다. */
  void browserClosed(UUID id, WebSocketSession raw) {
    Pair p = pairs.get(id);
    if (p == null) return;
    // 그 소켓이 이 세션의 브라우저일 때만 — 거절돼 닫힌 두 번째 브라우저 소켓이 세션을 닫지 않게(runnerClosed 와 같다).
    WebSocketSession b = p.browser;
    if (b != null && b.getId().equals(raw.getId())) close(p, REASON_BROWSER_CLOSED, false);
  }

  /** runner 소켓이 닫혔다 — 그 소켓이 이 세션의 runner 일 때만(거절된 두 번째 runner 가 세션을 닫지 않게). */
  void runnerClosed(UUID id, WebSocketSession raw) {
    Pair p = pairs.get(id);
    if (p == null) return;
    WebSocketSession r = p.runner;
    if (r != null && r.getId().equals(raw.getId())) close(p, REASON_RUNNER_CLOSED, true);
  }

  /**
   * 세션을 한 번만 닫는다: 레지스트리·표에서 빼고, 남은 입력 기록을 쓰고, 브라우저에 끝남 상태를 알린 뒤(브라우저가 닫은 것이 아니면) 두 소켓을 닫고, 세션 행에 닫힌
   * 때·까닭을 남긴다. 한국어 까닭은 상태 프레임에 싣는다 — 닫기 프레임의 까닭은 123바이트까지라 짧은 영문만 쓴다.
   */
  void close(Pair p, String reason, boolean notifyBrowser) {
    if (!p.closed.compareAndSet(false, true)) return;
    pairs.remove(p.id);
    tickets.removeForSession(p.id);
    flushInput(p, true);
    if (notifyBrowser) {
      sendJson(p, p.browser, Map.of("type", "status", "state", "ended", "reason", reason));
    }
    closeQuietly(p.browser, CloseStatus.NORMAL.withReason("screen ended"));
    closeQuietly(p.runner, CloseStatus.NORMAL.withReason("screen ended"));
    try {
      service.recordClosed(p.tenantId, p.id, reason);
    } catch (RuntimeException e) {
      log.warn("작업 화면 닫힘 기록 실패 session={}", p.id, e);
    }
  }

  // ---------------------------------------------------------------- 타이머

  /** 1초마다: 입력 기록 꺼내 쓰기, 만료 표 치우기, 기한 검사, 25초마다 핑. 한 번의 실패가 타이머를 멈추지 않게 모두 잡는다. */
  void tick() {
    try {
      Instant now = Instant.now();
      tickets.removeExpired(now);
      for (Pair p : List.copyOf(pairs.values())) {
        flushInput(p, false);
        Optional<String> reason = expiry(p, now);
        reason.ifPresent(r -> close(p, r, true));
      }
      if (Duration.between(lastPing, now).compareTo(PING_INTERVAL) >= 0) {
        lastPing = now;
        pairs.values().forEach(this::ping);
      }
    } catch (RuntimeException e) {
      log.warn("작업 화면 타이머 실패", e);
    }
  }

  /** 세션이 닫혀야 할 까닭 — 표를 안 씀, runner 가 15초 안에 안 붙음, 30분 무활동, 4시간 지남. */
  static Optional<String> expiry(Pair p, Instant now) {
    if (p.browser == null) {
      return now.isBefore(p.ticketDeadline) ? Optional.empty() : Optional.of(REASON_NOT_OPENED);
    }
    if (p.runner == null
        && p.browserAttachedAt != null
        && !now.isBefore(p.browserAttachedAt.plus(RUNNER_JOIN_TIMEOUT))) {
      return Optional.of(REASON_RUNNER_JOIN);
    }
    if (!now.isBefore(p.createdAt.plus(MAX_LIFETIME))) return Optional.of(REASON_MAX);
    if (!now.isBefore(p.lastActivity.plus(IDLE_TIMEOUT))) return Optional.of(REASON_IDLE);
    return Optional.empty();
  }

  private void flushInput(Pair p, boolean finalFlush) {
    List<String> chunks = p.recorder.drain(finalFlush);
    if (chunks.isEmpty()) return;
    try {
      service.recordInput(p.tenantId, p.id, chunks);
    } catch (RuntimeException e) {
      log.warn("작업 화면 입력 기록 실패 session={}", p.id, e);
    }
  }

  private void ping(Pair p) {
    for (WebSocketSession s : new WebSocketSession[] {p.browser, p.runner}) {
      if (s == null || !s.isOpen()) continue;
      try {
        s.sendMessage(new PingMessage());
      } catch (IOException | RuntimeException e) {
        log.debug("작업 화면 핑 실패 session={}", p.id, e);
      }
    }
  }

  // ---------------------------------------------------------------- 보내기

  /** 한 소켓으로 보낸다. 실패하면 세션을 닫는다(느리거나 끊긴 쪽이 남지 않게). */
  private void send(Pair p, WebSocketSession target, WebSocketMessage<?> message) {
    if (target == null || !target.isOpen()) return;
    try {
      target.sendMessage(message);
    } catch (IOException | RuntimeException e) {
      log.debug("작업 화면 보내기 실패 session={}", p.id, e);
      close(p, target == p.browser ? REASON_BROWSER_CLOSED : REASON_RUNNER_CLOSED, true);
    }
  }

  private void sendJson(Pair p, WebSocketSession target, Map<String, ?> body) {
    if (target == null || !target.isOpen()) return;
    try {
      target.sendMessage(new TextMessage(objectMapper.writeValueAsString(body)));
    } catch (IOException | RuntimeException e) {
      log.debug("작업 화면 상태 보내기 실패 session={}", p.id, e);
    }
  }

  private static void closeQuietly(WebSocketSession s, CloseStatus status) {
    if (s == null || !s.isOpen()) return;
    try {
      s.close(status);
    } catch (IOException | RuntimeException e) {
      // 이미 끊긴 소켓 — 더 할 것이 없다.
    }
  }
}

package com.workplace.agentruntime.screen;

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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
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
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

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

  /**
   * 끝남 알림 보낸 뒤 소켓을 닫기 전에 데코레이터 버퍼가 비기를 기다리는 상한(WP-2015) — 보내는 중에 닫으면 남은 프레임이 버려진다. 기한이 지나면 그냥
   * 닫는다(핸들러 스레드에서 불리므로 오래 멈추지 않는다 — 타이머·종료 경로는 아래 {@link #browserCloser} 로 넘긴다).
   */
  private static final int ENDED_DRAIN_TIMEOUT_MS = 2_000;

  /**
   * 위 드레인 대기의 폴링 간격 — 프레임이 나가는 순간을 놓치지 않게 짧게 확인한다. 라이브러리는 쓰기 시작한 그 밀리초에 진행 중인 보내기를 0 으로 보여 줘 첫 관찰의
   * 유휴은 오판일 수 있어, 유휴를 두 번 관찰할 때까지 한 번은 반드시 이 간격만큼 기다린다 — 그래서 보내는 중이 아닌 닫기에도 이 간격 한 번(최소 한 폴링)이
   * 든다(WP-2015 리뷰 후속 ④ — 유휴 오판을 막는 값이라 줄이지 않는다).
   */
  private static final int ENDED_DRAIN_POLL_MS = 20;

  static final String REASON_RUNNER_JOIN = "실행 환경에 연결하지 못했어요";
  static final String REASON_NOT_OPENED = "작업 화면을 열지 않았어요";
  static final String REASON_BROWSER_CLOSED = "관리자가 화면을 닫았어요";
  static final String REASON_RUNNER_CLOSED = "실행 환경과의 연결이 끊겼어요";
  static final String REASON_IDLE = "30분 동안 주고받은 것이 없어 닫았어요";
  static final String REASON_MAX = "4시간이 지나 닫았어요";
  static final String REASON_SHUTDOWN = "서버가 멈춰 닫았어요";
  // 타이머 쓰기가 연속 이만큼(타이머 30번 — DB 호출이 늦으면 30초보다 길다) 실패하면 되돌려 모아 둔 덩어리 전부를 버린다 — 영구 실패 덩어리가 뒤 입력 전체를
  // 막고 닫을 때 세션 입력을 모두 잃는 것을 막는다.
  static final int MAX_FLUSH_RETRIES = 30;
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
    // 입력 기록 꺼내기·쓰기를 한 번에 하나만 — 타이머 꺼내기와 닫을 때의 마지막 꺼내기가 겹쳐 순서가 뒤바뀌지 않게.
    final Object flushLock = new Object();
    // 타이머 쓰기가 연속으로 실패한 횟수 — flushLock 아래에서만 읽고 쓴다. 성공하거나 포기하면 0.
    int flushFailures;
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

  /**
   * 브라우저 드레인 뒤 닫기를 맡는 별도 스레드들(WP-2015 리뷰 후속 ①) — 타이머는 단일 스레드라 거기서 드레인 대기(세션당 최대 2초)를 직접 하면 같은 스레드의
   * 핑·만료 확인과 뒤 세션의 닫기가 밀린다. 타이머·종료 경로에서 오는 닫기는 여기로 넘기고, 브라우저·runner 가 직접 닫힌 핸들러 경로는 그 스레드가 곧 닫힘이라
   * 그대로 기다린다. 세션마다 작업 하나씩 넣어 같이 돌리므로, 종료 때 기다리는 시간은 세션 수만큼 곱해지지 않고 가장 긴 드레인 하나(2초)만큼이다 — 붙여 놓으면 빠른
   * 세션의 끝남 프레임이 막힌 세션 뒤에서 기다리다 종료에 밀린다.
   */
  private final ExecutorService browserCloser;

  /** tick 안에서 오는 닫기 표시 — 그 안의 닫기만 드레인을 {@link #browserCloser} 로 넘긴다(수동 tick 도 같다). */
  private final ThreadLocal<Boolean> closingFromTimer = ThreadLocal.withInitial(() -> false);

  /** 서버 종료 중 표시 — 종료 경로의 닫기도 드레인을 직접 기다리지 않게 한다. */
  private volatile boolean shuttingDown;

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
    this.browserCloser =
        Executors.newCachedThreadPool(
            r -> {
              Thread t = new Thread(r, "agent-screen-closer");
              t.setDaemon(true);
              return t;
            });
    timer.scheduleWithFixedDelay(this::tick, 1, 1, TimeUnit.SECONDS);
  }

  void setService(AgentScreenService service) {
    this.service = service;
  }

  /** 1초 타이머를 멈춘다(테스트용 — 타이머가 끼어들어 결과가 흔들리지 않게 테스트가 tick 을 직접 부른다). */
  void stopTimerForTest() {
    timer.shutdownNow();
  }

  /** 세션 id 로 중계 상태를 찾는다(테스트용 접근자). */
  Pair pairOf(UUID id) {
    return pairs.get(id);
  }

  /**
   * 서버가 멈출 때 열린 화면을 모두 닫고 타이머를 멈춘다(남은 입력 기록도 꺼내 쓴다). 닫기 반복이 끊겨도 타이머는 멈춘다. 브라우저 드레인 뒤 닫기는 별도 스레드에 넘겨
   * 세션당 2초를 차례로 기다리지 않고(WP-2015 리뷰 후속 ①), 넘겨 둔 것이 끝날 시간만 상한을 두어 준다.
   */
  @PreDestroy
  void shutdown() {
    shuttingDown = true;
    try {
      pairs.values().forEach(p -> close(p, REASON_SHUTDOWN, true));
    } finally {
      timer.shutdownNow();
      browserCloser.shutdown();
      try {
        browserCloser.awaitTermination(3, TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
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
    } catch (JacksonException e) {
      return true; // JSON 이 아니어도 runner 출력은 그대로 넘긴다
    }
    if (!"input".equals(node.path("type").asString("")) || !node.path("enabled").isBoolean()) {
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
    // 기록하는 동안 같은 AI 의 다른 화면이 먼저 켰을 수 있다 — 다시 본 뒤 연다.
    if (!tryClaimInput(p)) {
      sendTakenRejection(p);
      return false;
    }
    return true;
  }

  /** 같은 AI 의 다른 화면이 입력을 쥐고 있지 않으면 이 화면의 입력을 켜고 true. 판단과 켜기를 한 잠금 안에서 해 동시에 켜는 두 화면 중 하나만 이긴다. */
  private synchronized boolean tryClaimInput(Pair p) {
    if (inputTakenByOther(p)) return false;
    p.inputEnabled = true;
    return true;
  }

  /**
   * 같은 AI 의 다른 화면이 이미 입력 중이면 runner 에 끄기, 브라우저에 오류를 보내고 true. 판단만 잠금 안에서 하고 보내기는 잠금을 놓은 뒤에 한다 — 느린
   * 소켓 보내기가 같은 잠금을 잡는 close·타이머·붙기를 보내기 상한만큼 붙들지 않게(WP-2013 리뷰 후속).
   */
  private boolean rejectIfTaken(Pair p) {
    if (!inputTakenByOther(p)) return false;
    sendTakenRejection(p);
    return true;
  }

  /** 입력 다툼 거절 알림 — runner 에 끄기, 브라우저에 오류. 잠금 밖에서 부른다. */
  private void sendTakenRejection(Pair p) {
    sendJson(p, p.runner, Map.of("type", "input", "enabled", false));
    sendJson(p, p.browser, Map.of("type", "error", "message", INPUT_TAKEN));
  }

  /**
   * 같은 AI 의 다른 열린 화면이 runner 가 확인한 입력을 쥐고 있는지. 이 객체의 잠금 안에서 본다 — 보내기는 이 판단 뒤 잠금 밖에서 한다(느린 소켓이
   * close·타이머·붙기를 붙들지 않게, WP-2013 리뷰 후속).
   */
  private synchronized boolean inputTakenByOther(Pair p) {
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
    } catch (JacksonException e) {
      return; // JSON 이 아니면 버린다
    }
    String type = node.path("type").asString("");
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
    // 오류 보내기는 잠금 밖에서 — 느린 브라우저 소켓이 close·타이머·붙기를 붙들지 않게(WP-2013 리뷰 후속).
    if (inputTakenByOther(p)) {
      sendJson(p, p.browser, Map.of("type", "error", "message", INPUT_TAKEN));
      return;
    }
    send(p, p.runner, message);
  }

  /**
   * 브라우저 → runner 바이너리(키 입력): runner 가 입력을 켰다고 알린 동안에만 처리한다. 기록 버퍼에 먼저 더하고, 받아들여졌을 때만 runner 로 넘긴다
   * — 닫는 중(마지막 꺼내기로 봉인된 뒤)에 들어온 키가 기록 없이 터미널에 닿지 않게. 아니면 버린다.
   */
  void fromBrowserBinary(UUID id, BinaryMessage message) {
    Pair p = pairs.get(id);
    if (p == null || p.closed.get()) return;
    p.lastActivity = Instant.now();
    if (!p.inputEnabled) return;
    byte[] bytes = copy(message);
    if (!p.recorder.append(bytes)) return;
    send(p, p.runner, new BinaryMessage(bytes));
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
   * 때·까닭을 남긴다. 한국어 까닭은 상태 프레임에 싣는다 — 닫기 프레임의 까닭은 123바이트까지라 짧은 영문만 쓴다. 한 단계가 실패해도 나머지 단계는 실행하고 단계
   * 실패는 던지지 않는다({@link #closeStep}).
   *
   * <p>closed 표시와 표 제거는 attach 와 같은 잠금 아래에서 한다. attach 가 그 잠금 아래에서 closed 를 보고 소켓 칸을 채우므로, 잠금을 놓은
   * 뒤에는 이미 붙은 소켓은 아래 단계가 읽어 닫고 늦게 온 attach 는 스스로 닫는다(WP-2013).
   */
  void close(Pair p, String reason, boolean notifyBrowser) {
    synchronized (this) {
      if (!p.closed.compareAndSet(false, true)) return;
      pairs.remove(p.id);
    }
    closeStep(p, "표 정리", () -> tickets.removeForSession(p.id));
    closeStep(p, "입력 기록", () -> flushInput(p, true));
    // 끝남 알림이 실제로 버퍼에 들어갔는지까지 본다 — 보내기가 거절되면(예: 데코레이터 한도 초과) 기다려도 나갈 프레임이 없다(WP-2015 리뷰 후속 ②).
    AtomicBoolean endedQueued = new AtomicBoolean();
    if (notifyBrowser) {
      closeStep(
          p,
          "끝남 알림",
          () ->
              endedQueued.set(
                  sendJson(
                      p, p.browser, Map.of("type", "status", "state", "ended", "reason", reason))));
    }
    // 끝남 알림이 아직 버퍼에 남아 있으면 바로 닫는 순간 그 프레임이 버려진다(WP-2015) — 나갈 때까지만 기다렸다가 닫는다.
    // 브라우저가 스스로 닫은 경로(notifyBrowser=false)에는 기다릴 프레임이 없으니 대기하지 않는다(WP-2015 리뷰 후속 ③).
    closeStep(p, "브라우저 닫기", () -> closeBrowser(p.browser, endedQueued.get()));
    closeStep(
        p,
        "runner 닫기",
        () -> closeQuietly(p.runner, CloseStatus.NORMAL.withReason("screen ended")));
    closeStep(p, "닫힘 기록", () -> service.recordClosed(p.tenantId, p.id, reason));
  }

  /**
   * 브라우저 소켓을 닫는다 — 끝남 알림이 버퍼에 들어갔으면 나갈 때까지만 기다렸다 닫고, 아니면 바로 닫는다. 타이머(단일 스레드)·종료 경로에서 온 닫기라면 기다리는 일을
   * 별도 스레드에 넘겨 그 스레드의 핑·만료 확인·다른 세션 닫기를 붙들지 않는다(WP-2015 리뷰 후속 ①).
   */
  private void closeBrowser(WebSocketSession browser, boolean endedQueued) {
    if (!endedQueued) {
      closeQuietly(browser, CloseStatus.NORMAL.withReason("screen ended"));
      return;
    }
    Runnable drainAndClose =
        () -> closeQuietlyAfterDrain(browser, CloseStatus.NORMAL.withReason("screen ended"));
    boolean defer = closingFromTimer.get() || shuttingDown;
    if (!defer) {
      drainAndClose.run();
      return;
    }
    try {
      browserCloser.execute(drainAndClose);
    } catch (RejectedExecutionException e) {
      // 종료로 실행기를 닫은 뒤 온 닫기 — 넘길 곳이 없어 기다리는 대신 그 자리에서 기다린다(유한 시간, 끊김이면 즉시 나감).
      drainAndClose.run();
    }
  }

  /**
   * close 의 한 단계를 실행하고 실패는 로그로만 남긴다. closed 를 이미 표시하고 세션을 레지스트리에서 뺀 뒤라 뒤에서 다시 시도할 기회가 없으므로, 뒤 단계(소켓
   * 닫기·닫힘 기록)가 건너뛰어지지 않게 Error 까지 잡는다. 로그에는 입력·화면 내용을 싣지 않고 단계 이름·세션 id·예외만 남긴다.
   */
  private void closeStep(Pair p, String step, Runnable work) {
    try {
      work.run();
    } catch (Throwable e) {
      log.warn("작업 화면 닫기 단계 실패 step={} session={}", step, p.id, e);
    }
  }

  // ---------------------------------------------------------------- 타이머

  /**
   * 1초마다: 만료 표 치우기, 기한 검사(지난 세션 닫기), 입력 기록 꺼내 쓰기, 25초마다 핑. 단계마다·세션마다 실패를 따로 잡아, 한 세션이나 한 단계의 실패가
   * 나머지(같은 세션의 다른 단계·다른 세션·핑)를 막지 않게 한다.
   */
  void tick() {
    // executor 는 작업이 어떤 Throwable 이든 던지면 다음 주기를 다시 돌리지 않는다. 그래서 Error 까지 잡는다. 또 한 세션이
    // 매번 실패해도 뒤의 세션과 핑이 굶지 않도록 단계·세션별로 나눠 잡는다(WP-2009).
    Instant now = Instant.now();
    try {
      tickets.removeExpired(now);
    } catch (Throwable e) {
      log.warn("작업 화면 만료 표 정리 실패", e);
    }
    for (Pair p : List.copyOf(pairs.values())) {
      // 만료·닫기를 입력 기록보다 먼저, 따로 잡는다 — 입력 기록이 매번 실패해도 기한이 지난 세션은 닫힌다.
      // 닫힌 세션은 close 가 마지막 입력 기록을 이미 했으므로 주기 기록을 건너뛴다.
      try {
        Optional<String> expired = expiry(p, now);
        if (expired.isPresent()) {
          // 이 닫기의 브라우저 드레인은 별도 스레드로 넘긴다 — 타이머는 단일 스레드라 세션당 최대 2초를 기다리면
          // 핑·만료 확인과 뒤 세션의 닫기가 밀린다(WP-2015 리뷰 후속 ①).
          closingFromTimer.set(true);
          try {
            close(p, expired.get(), true);
          } finally {
            closingFromTimer.remove();
          }
        }
      } catch (Throwable e) {
        log.warn("작업 화면 만료 검사 실패 session={}", p.id, e);
      }
      if (p.closed.get()) continue;
      try {
        flushInput(p, false);
      } catch (Throwable e) {
        log.warn("작업 화면 입력 기록 단계 실패 session={}", p.id, e);
      }
    }
    // 핑 단계도 다른 단계처럼 바깥에서 Error 까지 잡는다 — ping 안 catch 의 로그나 순회·시각 계산이 던져도 tick 밖으로 새어
    // executor 가 주기 작업을 취소하지 않게 한다. ping 은 소켓마다도 잡아 한 세션의 실패가 뒤 세션의 핑을 막지 않는다.
    try {
      if (Duration.between(lastPing, now).compareTo(PING_INTERVAL) >= 0) {
        lastPing = now;
        pairs.values().forEach(this::ping);
      }
    } catch (Throwable e) {
      log.warn("작업 화면 핑 단계 실패", e);
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

  /**
   * 입력 기록 버퍼를 꺼내 DB 에 쓴다. 타이머 꺼내기가 실패하면 {@link #retryLater} 가 덩어리를 되돌려 넣어 다음 꺼내기가 순서대로 다시 쓰게 한다.
   * 마지막 꺼내기(닫을 때)는 다시 기회가 없어 한 번 더 쓰고, 그래도 실패하면 유실을 ERROR 로 남긴다. 잠금은 꺼내기·쓰기만 감싼다(소켓 보내기는 잠금 밖).
   */
  private void flushInput(Pair p, boolean finalFlush) {
    synchronized (p.flushLock) {
      List<String> chunks = p.recorder.drain(finalFlush);
      if (chunks.isEmpty()) return;
      try {
        service.recordInput(p.tenantId, p.id, chunks);
        p.flushFailures = 0;
        return;
      } catch (RuntimeException e) {
        if (!finalFlush && retryLater(p, chunks, e)) return;
        log.warn("작업 화면 입력 기록 실패 — 다시 시도 session={}", p.id, e);
      }
      try {
        service.recordInput(p.tenantId, p.id, chunks);
        p.flushFailures = 0;
      } catch (RuntimeException e) {
        log.error(
            "작업 화면 입력 기록 유실 session={} chunks={} chars={}",
            p.id,
            chunks.size(),
            charCount(chunks),
            e);
      }
    }
  }

  /**
   * 타이머 쓰기 실패를 처리한다(flushLock 아래에서만 부름). 연속 실패가 상한에 닿으면 모아 둔 덩어리를 버리고 ERROR, 아니면 되돌려 넣는다.
   *
   * @return 처리했으면 true. 되돌려 넣기가 거절되면(봉인 — flushLock 아래에선 일어나지 않는 방어용) false 라 호출자가 바로 다시 쓴다.
   */
  private boolean retryLater(Pair p, List<String> chunks, RuntimeException e) {
    p.flushFailures++;
    if (p.flushFailures >= MAX_FLUSH_RETRIES) {
      // 상한을 넘기면 되돌리지 않고 버려 뒤 입력이 막히지 않게 한다.
      log.error(
          "작업 화면 입력 기록 유실(다시 시도 상한 {}회 넘음) session={} chunks={} chars={}",
          MAX_FLUSH_RETRIES,
          p.id,
          chunks.size(),
          charCount(chunks),
          e);
      p.flushFailures = 0;
      return true;
    }
    if (!p.recorder.requeue(chunks)) return false;
    // 연속 실패의 첫 번째만 스택과 함께 warn — DB 장애 동안 매초 찍히지 않게.
    if (p.flushFailures == 1) {
      log.warn("작업 화면 입력 기록 실패 — 다음 꺼내기에 다시 씀 session={}", p.id, e);
    } else {
      log.debug("작업 화면 입력 기록 계속 실패 session={} 연속={} 원인={}", p.id, p.flushFailures, e.toString());
    }
    return true;
  }

  /** 덩어리들의 글자 수 합 — 유실 로그용. */
  private static int charCount(List<String> chunks) {
    return chunks.stream().mapToInt(String::length).sum();
  }

  /** 한 세션의 두 소켓에 핑을 보낸다. 테스트가 spy 로 실패를 넣을 수 있게 패키지 공개다. */
  void ping(Pair p) {
    for (WebSocketSession s : new WebSocketSession[] {p.browser, p.runner}) {
      if (s == null) continue;
      // 소켓마다 Error 까지 잡는다 — 한 소켓의 실패가 같은 세션의 다른 소켓·뒤 세션의 핑을 막지 않게(WP-2009).
      try {
        if (s.isOpen()) s.sendMessage(new PingMessage());
      } catch (Throwable e) {
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

  /**
   * 상태 프레임 하나를 보낸다 — 실제로 소켓에 들어갔으면 true. 못 들어갔으면(소켓 없음·이미 닫힘·보내기 거절) false 이고, 닫기 는 기다릴 프레임이 없으니
   * 드레인을 건너뛴다(WP-2015 리뷰 후속 ②).
   */
  private boolean sendJson(Pair p, WebSocketSession target, Map<String, ?> body) {
    if (target == null || !target.isOpen()) return false;
    try {
      target.sendMessage(new TextMessage(objectMapper.writeValueAsString(body)));
      return true;
    } catch (IOException | RuntimeException e) {
      log.debug("작업 화면 상태 보내기 실패 session={}", p.id, e);
      return false;
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

  /** 끝남 알림이 데코레이터 버퍼에 남아 있는 동안 소켓을 닫으면 그 프레임이 사라진다(WP-2015) — 나갈 때까지만 기다리고, 기한이 지나면 그냥 닫는다. */
  private static void closeQuietlyAfterDrain(WebSocketSession s, CloseStatus status) {
    drainBeforeClose(s);
    closeQuietly(s, status);
  }

  /**
   * 닫기 전에 데코레이터에 남은 마지막 프레임이 나갈 때만 기다린다 — 느린 소켓을 무한히 기다리지 않는다. 보내는 중이 아닌 닫기에서도 유휴를 두 번 관찰할 때까지
   * {@link #ENDED_DRAIN_POLL_MS} 한 번은 기다린다(첫 관찰의 유휴가 오판일 수 있어 — 위 상수 설명, WP-2015 리뷰 후속 ④).
   */
  private static void drainBeforeClose(WebSocketSession s) {
    if (s == null || !s.isOpen()) return;
    if (!(s instanceof ConcurrentWebSocketSessionDecorator d)) return;
    long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ENDED_DRAIN_TIMEOUT_MS);
    // 버퍼가 비고 진행 중인 보내기가 끝날 때까지 기다린다 — 그 동안 앞선 보내기 스레드가 끝남 알림까지 밀어낸다.
    // 라이브러리는 쓰기 시작한 그 밀리초에 진행 중인 보내기를 0 으로 보여 줘 오판할 수 있으므로(WP-2015),
    // 한 번 유휴을 관찰한 뒤 ENDED_DRAIN_POLL_MS 가 지난 재확인에서도 유휴일 때만 나간다(오탐은 그 재확인에서 잡는다).
    boolean idleOnPreviousPoll = false;
    int previousBuffer = -1;
    while (System.nanoTime() < deadline) {
      int buffer = d.getBufferSize();
      long sinceSendStarted = d.getTimeSinceSendStarted();
      boolean idle = buffer == 0 && sinceSendStarted == 0;
      if (idle && idleOnPreviousPoll) return;
      idleOnPreviousPoll = idle;
      // 진행 중인 보내기는 없는데 버퍼만 남아 두 폴링 동안 줄지 않으면 — 그 버퍼를 비울 주체가 없어 기한을 채워도 프레임은 나가지 않는다.
      // 보내기 실패(한도 초과 등) 뒤에 닫히는 스레드가 2초를 헛대기하지 않게 한다(WP-2015 리뷰 후속 ②).
      if (!idle && sinceSendStarted == 0 && buffer > 0 && buffer == previousBuffer) return;
      previousBuffer = buffer;
      try {
        Thread.sleep(ENDED_DRAIN_POLL_MS);
      } catch (InterruptedException e) {
        // 대기 중 끊김 — 플래그를 되돌리고 닫기를 미루지 않는다.
        Thread.currentThread().interrupt();
        return;
      }
    }
    // 기한을 채워 나간다 — 끝남 프레임이 아직 나가지 못했을 수 있다(WP-2015): 유실 흔적을 남긴다.
    log.debug(
        "작업 화면 끝남 프레임 대기 초과 buffer={} timeSince={}",
        d.getBufferSize(),
        d.getTimeSinceSendStarted());
  }
}

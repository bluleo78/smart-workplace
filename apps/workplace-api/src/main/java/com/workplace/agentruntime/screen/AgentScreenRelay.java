package com.workplace.agentruntime.screen;

import static com.workplace.agentruntime.screen.ScreenSockets.closeQuietly;
import static com.workplace.agentruntime.screen.ScreenSockets.closeQuietlyAfterDrain;
import static com.workplace.agentruntime.screen.ScreenSockets.copy;
import static com.workplace.agentruntime.screen.ScreenSockets.decorate;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
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
 * AI 작업 화면 중계 레지스트리(WP-1277) — 관리자 브라우저 소켓과 runner 소켓을 세션 id 로 짝지어 프레임을 넘긴다. 짝(Pair)은 화면을 연 POST 를
 * 받은 「주인 파드」의 메모리에 있고, 여러 파드가 함께 봐야 하는 것(화면 수 상한·접속 표·입력 중 상태·주인 파드 주소)은 공유 경로 표({@link
 * AgentScreenRoutes}, WP-1978)에 둔다.
 *
 * <p>흐름: POST 가 {@link #reserve} 로 자리를 잡는다(표 만료까지 브라우저가 안 붙으면 닫힘) → 브라우저가 표로 붙으면 {@link
 * #attachBrowser} 가 그 위치의 runner 에게 SSE {@code agent-runtime.screen} 을 보낸다 → runner 가 15초 안에 {@link
 * #attachRunner} 로 붙지 않으면 닫힘 → 이후 프레임을 양쪽으로 넘긴다. 한쪽이 닫히면 다른 쪽도 닫고 세션 행에 닫힌 때·까닭을 남긴다.
 *
 * <p>열린 화면 수(AI 당 3개)와 「다른 관리자가 이미 입력 중」 판정은 공유 경로 표로 모든 파드를 합쳐 한다(WP-1978). 표의 행은 주인 파드가 30초마다 임대를
 * 늘리고 닫히면 지운다 — 파드가 죽어 남은 행은 임대(90초)가 지나면 어느 판정에도 세지 않는다. 동시 요청은 저장소가 AI 단위 잠금으로 직렬화한다. 저장소 호출(DB)은
 * 이 객체의 잠금 밖에서 한다 — 느린 DB 가 붙기·닫기·타이머를 붙들지 않게.
 *
 * <p>타이머(25초 핑, 1초 입력 기록 꺼내기, 만료·무활동 검사)는 파드 로컬 소켓을 다뤄 모든 파드에서 돌아야 하므로 {@code @Scheduled}·분산 잠금 대신
 * 전용 스케줄러 스레드 하나로 돈다. 30초 임대 갱신(DB)은 그 타이머와 따로 전용 스레드 하나({@link #renewer})에서 돈다 — DB 가 멈춰도 핑이 밀려 넘겨
 * 온 소켓의 퐁 제한이 거짓으로 지나지 않게(WP-1978 리뷰).
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

  /**
   * 파드 사이 다리의 퐁 제한(WP-1978) — 핑(25초) 두 번 남짓. 다른 파드가 넘겨 온 소켓(내부 경로)은 그 파드가 닫기 프레임 없이 사라지면 TCP 가 반쯤
   * 열린 채 남을 수 있어, 이 시간 동안 퐁이 없으면 화면을 닫는다. 넘기는 쪽({@link AgentScreenForwarder})도 같은 값을 쓴다.
   */
  static final Duration PONG_TIMEOUT = Duration.ofSeconds(60);

  /**
   * 핑을 보낸 뒤 퐁을 기다려 주는 최소 시간(WP-1978 리뷰 후속 ①) — 퐁 제한은 「마지막 퐁 뒤 {@link #PONG_TIMEOUT}」만으로 보지 않고, 그 퐁
   * 뒤에 핑을 실제로 보냈고 그 핑에도 이만큼 답이 없을 때만 끊긴 것으로 본다. 타이머 스레드가 DB 호출(닫기의 경로 정리·입력 기록)로 35초 넘게 묶여 핑을 못 보낸
   * 동안에는 상대가 답할 핑 자체가 없으므로 끊김으로 치지 않는다. 핑 주기(25초) 두 번 + 이 값 = {@link #PONG_TIMEOUT} 이라, 상대가 정말
   * 사라졌으면 예전과 같은 60초 안팎에 닫힌다.
   */
  static final Duration PONG_ANSWER_WAIT = PONG_TIMEOUT.minus(PING_INTERVAL.multipliedBy(2));

  /**
   * 표 만료 뒤 주인 파드가 기다려 주는 유예(WP-1978 리뷰) — 만료 직전의 표를 주인이 아닌 파드가 받으면 그 파드는 표를 쓴 뒤(DB 확인) 주인 파드에 이어
   * 붙이기까지 몇 초(최대 ~5초)가 더 걸린다. 그 사이 주인이 표 만료 시각에 맞춰 「열지 않음」으로 닫으면 표를 정상으로 쓴 브라우저가 닫힌 화면을 만난다. 그래서
   * 주인은 표 만료 뒤 이만큼 더 기다린 다음에야 닫는다(표 자체의 한 번·만료 판정은 공유 경로 표가 DB 시계로 따로 한다).
   */
  static final Duration FORWARD_GRACE = Duration.ofSeconds(10);

  /**
   * 공유 경로 표의 임대 갱신 주기 — 임대({@link AgentScreenRoutes#LEASE}, 90초)보다 충분히 짧게 해 DB 가 잠깐 끊겨도 만료되지 않게.
   */
  static final Duration RENEW_INTERVAL = Duration.ofSeconds(30);

  static final String REASON_RUNNER_JOIN = "실행 환경에 연결하지 못했어요";
  static final String REASON_NOT_OPENED = "작업 화면을 열지 않았어요";
  static final String REASON_BROWSER_CLOSED = "관리자가 화면을 닫았어요";
  static final String REASON_RUNNER_CLOSED = "실행 환경과의 연결이 끊겼어요";
  static final String REASON_IDLE = "30분 동안 주고받은 것이 없어 닫았어요";
  static final String REASON_MAX = "4시간이 지나 닫았어요";
  static final String REASON_SHUTDOWN = "서버가 멈춰 닫았어요";
  // 다른 파드가 넘겨 온 소켓의 퐁이 PONG_TIMEOUT 동안 없을 때 — 넘기던 파드가 사라졌다(WP-1978).
  static final String REASON_POD_LINK_LOST = "서버 사이 연결이 끊겨 닫았어요";
  // 임대 갱신에서 행이 사라졌음(DB 장애가 임대보다 길어 다른 파드가 지움 등)을 알았을 때 — 다시 넣으면 상한을 넘을 수 있어 닫는다(WP-1978).
  static final String REASON_ROUTE_LOST = "서버 사이 연결 정보를 잃어 닫았어요";
  // 타이머 쓰기가 연속 이만큼(타이머 30번 — DB 호출이 늦으면 30초보다 길다) 실패하면 되돌려 모아 둔 덩어리 전부를 버린다 — 영구 실패 덩어리가 뒤 입력 전체를
  // 막고 닫을 때 세션 입력을 모두 잃는 것을 막는다.
  static final int MAX_FLUSH_RETRIES = 30;
  static final String INPUT_TAKEN = "다른 관리자가 이미 입력 중이에요";
  static final String INPUT_CHECK_FAILED = "입력 상태를 확인하지 못했어요";

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
    // 다른 파드가 넘겨 온(내부 경로) 브라우저·runner 소켓의 마지막 퐁 — 넘겨 온 소켓만 값이 있고(붙은 때가 첫 퐁) 직접 붙은 소켓은 null 이라
    // 퐁 제한을 보지 않는다(WP-1978).
    volatile Instant browserPong;
    volatile Instant runnerPong;
    // 넘겨 온 브라우저·runner 소켓에 마지막으로 핑을 보내려 한 때 — 퐁 제한은 「이 소켓에 핑을 보낸 뒤에도 답이 없음」을 이 값으로 본다(보내기 실패도 시도로
    // 친다 — 쓰기가 계속 실패하는 소켓도 제한으로 닫히게). 첫 핑 회차 전에는 null 이라 판정하지 않는다(WP-1978 리뷰 후속 ①).
    volatile Instant browserPingAt;
    volatile Instant runnerPingAt;

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
  private final AgentScreenRoutes routes;
  private final AgentScreenPod pod;
  private final ObjectMapper objectMapper;
  private final ScheduledExecutorService timer;

  /**
   * 공유 경로 임대 갱신 전용 스레드(WP-1978 리뷰) — 갱신은 DB 호출이라 느려질 수 있다. 타이머 스레드에서 하면 DB 가 30초 넘게 멈출 때 25초 핑도 같이
   * 멈춰 넘겨 온 소켓의 퐁이 끊기고 {@link #expiry} 가 멀쩡한 화면을 「서버 사이 연결 끊김」으로 닫는다. 그래서 갱신만 이 스레드로 떼어 타이머가 DB 를
   * 기다리지 않게 한다.
   */
  private final ScheduledExecutorService renewer;

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
      RunnerSseRegistry sseRegistry,
      AgentScreenRoutes routes,
      AgentScreenPod pod,
      ObjectMapper objectMapper) {
    this.sseRegistry = sseRegistry;
    this.routes = routes;
    this.pod = pod;
    this.objectMapper = objectMapper;
    this.timer = ScreenSockets.daemonScheduler("agent-screen-timer");
    this.browserCloser = ScreenSockets.daemonCachedPool("agent-screen-closer");
    this.renewer = ScreenSockets.daemonScheduler("agent-screen-renew");
    timer.scheduleWithFixedDelay(this::tick, 1, 1, TimeUnit.SECONDS);
    long renewEvery = RENEW_INTERVAL.toSeconds();
    renewer.scheduleWithFixedDelay(this::renew, renewEvery, renewEvery, TimeUnit.SECONDS);
  }

  void setService(AgentScreenService service) {
    this.service = service;
  }

  /** 1초 타이머와 임대 갱신 스레드를 멈춘다(테스트용 — 끼어들어 결과가 흔들리지 않게 테스트가 tick·갱신을 직접 부른다). */
  void stopTimerForTest() {
    timer.shutdownNow();
    renewer.shutdownNow();
  }

  /** 세션 id 로 중계 상태를 찾는다(테스트용 접근자). */
  Pair pairOf(UUID id) {
    return pairs.get(id);
  }

  /**
   * 서버가 멈출 때 열린 화면을 모두 닫고, 이 파드의 공유 경로 행을 모두 지우고(닫기가 하나씩 지우지만 실패분까지 — 상한을 바로 비우게), 타이머를 멈춘다(남은 입력
   * 기록도 꺼내 쓴다). 닫기 반복이 끊겨도 행 지우기와 타이머 멈춤은 한다. 브라우저 드레인 뒤 닫기는 별도 스레드에 넘겨 세션당 2초를 차례로 기다리지 않고(WP-2015
   * 리뷰 후속 ①), 넘겨 둔 것이 끝날 시간만 상한을 두어 준다.
   */
  @PreDestroy
  void shutdown() {
    shuttingDown = true;
    try {
      pairs.values().forEach(p -> close(p, REASON_SHUTDOWN, true));
    } finally {
      try {
        routes.removeByPod(pod.id());
      } catch (Throwable e) {
        // 지우지 못한 행은 임대(90초)가 지나면 판정에서 빠진다 — 종료는 계속한다.
        log.warn("작업 화면 경로 일괄 정리 실패 pod={}", pod.id(), e);
      }
      timer.shutdownNow();
      renewer.shutdownNow();
      browserCloser.shutdown();
      try {
        browserCloser.awaitTermination(3, TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
  }

  // ---------------------------------------------------------------- 자리·연결

  /**
   * 화면 하나의 자리를 잡는다 — 모든 파드를 합친 이 AI 의 살아 있는 화면(아직 안 붙은 것 포함)이 이미 3개면 false. 공유 경로 표에 행(주인 = 이 파드,
   * 접속 표 해시)을 먼저 넣고 성공했을 때만 메모리 짝을 만든다. 표 넣기는 DB 호출이라 이 객체의 잠금 밖에서 한다(상한의 동시성은 저장소의 AI 단위 잠금이 지킨다).
   */
  boolean reserve(
      UUID id,
      long tenantId,
      long agentUserId,
      long locationId,
      long openedBy,
      Instant ticketDeadline,
      String ticketHash) {
    AgentScreenRoutes.Route route =
        new AgentScreenRoutes.Route(
            id, tenantId, agentUserId, locationId, openedBy, pod.id(), pod.address());
    // 공유 표의 표 만료는 DB 시계로 적는다(길이만 넘김) — 표를 쓰는 판정이 DB now() 와 비교하므로 앱 시계와 섞지 않게. 메모리 짝의 기한은 앱 시계(아래).
    if (!routes.reserve(
        route,
        ticketHash,
        Duration.ofSeconds(AgentScreenService.TICKET_TTL_SECONDS),
        AgentScreenService.MAX_SESSIONS_PER_AGENT)) {
      return false;
    }
    synchronized (this) {
      pairs.put(id, new Pair(id, tenantId, agentUserId, locationId, openedBy, ticketDeadline));
    }
    return true;
  }

  /** 경로 행의 주인이 이 파드인지 — 아니면 짝이 다른 파드 메모리에 있다. */
  boolean isOwner(AgentScreenRoutes.Route r) {
    return pod.id().equals(r.ownerPodId());
  }

  /** 기록에 실패한 자리를 돌려준다 — 메모리 짝과 공유 경로 행을 함께 지운다. */
  void release(UUID id) {
    pairs.remove(id);
    try {
      routes.remove(id);
    } catch (RuntimeException e) {
      // 호출자는 원래 실패를 던지는 중이다 — 이 실패로 덮지 않는다. 남은 행은 임대가 지나면 판정에서 빠진다.
      log.warn("작업 화면 경로 행 돌려주기 실패 session={}", id, e);
    }
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

  /**
   * 브라우저 소켓을 붙이고 그 위치의 runner 에게 화면을 이으라고 알린다. 그 사이 세션이 사라졌으면 소켓을 닫는다. viaPod 이면 다른 파드가 내부 경로로 넘겨 온
   * 소켓이라 퐁 제한({@link #PONG_TIMEOUT})을 본다(붙은 때를 첫 퐁으로 친다).
   */
  void attachBrowser(UUID id, WebSocketSession raw, boolean viaPod) {
    WebSocketSession s = decorate(raw);
    Pair p;
    synchronized (this) {
      p = pairs.get(id);
      if (p == null || p.closed.get() || p.browser != null) p = null;
      else {
        p.browser = s;
        p.browserAttachedAt = Instant.now();
        p.lastActivity = Instant.now();
        p.browserPong = viaPod ? Instant.now() : null;
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

  /**
   * runner 소켓을 붙인다. 이미 붙어 있거나 세션이 사라졌으면 새 소켓을 닫는다(세션당 runner 하나). viaPod 이면 다른 파드가 넘겨 온 소켓이라 퐁 제한을
   * 본다(붙은 때를 첫 퐁으로 친다).
   */
  void attachRunner(UUID id, WebSocketSession raw, boolean viaPod) {
    WebSocketSession s = decorate(raw);
    boolean ok;
    synchronized (this) {
      Pair p = pairs.get(id);
      ok = p != null && !p.closed.get() && p.runner == null;
      if (ok) {
        p.runner = s;
        p.lastActivity = Instant.now();
        p.runnerPong = viaPod ? Instant.now() : null;
      }
    }
    if (!ok) closeQuietly(s, CloseStatus.POLICY_VIOLATION);
  }

  /**
   * 넘겨 온 소켓에서 퐁을 받았다 — 그 소켓이 이 세션의 브라우저나 runner 이고 넘겨 온 것(퐁 시각이 있음)일 때만 시각을 늘린다(거절된 소켓·직접 붙은 소켓의 퐁은
   * 무시).
   */
  void pong(UUID id, WebSocketSession raw) {
    Pair p = pairs.get(id);
    if (p == null) return;
    Instant now = Instant.now();
    if (sameSocket(p.browser, raw)) {
      if (p.browserPong != null) p.browserPong = now;
    } else if (sameSocket(p.runner, raw)) {
      if (p.runnerPong != null) p.runnerPong = now;
    }
  }

  /** 짝에 붙은 소켓(데코레이터)이 받은 원래 소켓과 같은 것인지 — id 로 본다. */
  private static boolean sameSocket(WebSocketSession attached, WebSocketSession raw) {
    return attached != null && attached.getId().equals(raw.getId());
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
   * runner 의 {@code {"type":"input","enabled":…}} 를 반영한다. 켜짐이면 같은 AI 의 다른 화면(다른 파드 것 포함)이 이미 입력 중인지
   * 공유 경로 표로 다시 보고(동시에 켜진 경우) 그렇다면 runner 에 끄기를 보내고 브라우저에 오류를 보낸 뒤 이 프레임은 넘기지 않는다(false). 처음 켜질 때만
   * 세션 행·감사 로그에 남기고, 기록이나 표 확인·갱신에 실패하면 입력을 열지 않는다. 꺼짐이면 플래그를 내리고 표의 입력 중 표시도 끈다. input 이 아닌 프레임은
   * 그대로 true. 표 호출(DB)은 모두 이 객체의 잠금 밖에서 한다.
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
      releaseInput(p);
      return true;
    }
    if (p.inputEnabled) return true;
    if (rejected(p, checkInput(p, () -> inputTakenByOther(p), "작업 화면 입력 중 확인 실패 — 입력을 열지 않음"))) {
      return false;
    }
    // 기록을 먼저 커밋한 뒤 입력을 연다 — 기록이 남기 전에 키가 넘어가거나, 기록에 실패했는데 키가 이미 넘어간 일이 없게.
    try {
      service.recordInputEnabled(p.tenantId, p.id, p.agentUserId, p.openedBy);
    } catch (RuntimeException e) {
      log.warn("작업 화면 입력 허용 기록 실패 — 입력을 열지 않음 session={}", p.id, e);
      rejectInput(p, "입력 허용을 기록하지 못했어요");
      return false;
    }
    // 기록하는 동안 같은 AI 의 다른 화면(다른 파드 것 포함)이 먼저 켰을 수 있다 — 표에서 확인과 켜기를 한 번에 한 뒤 연다.
    return !rejected(p, checkInput(p, () -> !tryClaimInput(p), "작업 화면 입력 중 표시 실패 — 입력을 열지 않음"));
  }

  /** 입력 판정 결과 — 열어도 됨·다른 화면이 쥐고 있음·확인 실패(DB 오류). 거절이면 브라우저에 보낼 까닭을 함께 든다. */
  private enum InputCheck {
    OK(null),
    TAKEN(INPUT_TAKEN),
    ERROR(INPUT_CHECK_FAILED);

    final String rejection;

    InputCheck(String rejection) {
      this.rejection = rejection;
    }
  }

  /**
   * 공유 경로 표로 입력 판정 하나를 한다 — taken 이 참이면 TAKEN, 거짓이면 OK, 표 호출이 던지면 그 실패를 로그로 남기고 ERROR(입력을 열지 않는 쪽).
   * DB 호출이라 이 객체의 잠금 밖에서 부른다.
   */
  private InputCheck checkInput(Pair p, BooleanSupplier taken, String failureLog) {
    try {
      return taken.getAsBoolean() ? InputCheck.TAKEN : InputCheck.OK;
    } catch (RuntimeException e) {
      log.warn("{} session={}", failureLog, p.id, e);
      return InputCheck.ERROR;
    }
  }

  /** runner 가 켠 입력의 판정이 거절이면 거절 알림({@link #rejectInput})을 보내고 true. */
  private boolean rejected(Pair p, InputCheck check) {
    if (check == InputCheck.OK) return false;
    rejectInput(p, check.rejection);
    return true;
  }

  /**
   * 같은 AI 의 다른 화면이 입력을 쥐고 있지 않으면 공유 경로 표에 이 화면을 입력 중으로 적고 메모리 플래그를 켠 뒤 true. 확인과 적기는 저장소가 AI 단위 잠금
   * 아래 한 트랜잭션에서 해 여러 파드에서 동시에 켜는 두 화면 중 하나만 이긴다. 플래그는 표 갱신이 성공한 뒤에만 켠다. DB 오류는 던진다.
   */
  private boolean tryClaimInput(Pair p) {
    if (!routes.claimInput(p.id, p.tenantId, p.agentUserId)) return false;
    p.inputEnabled = true;
    return true;
  }

  /**
   * 입력 거절 알림 — runner 에 끄기, 브라우저에 오류(까닭). 이 객체의 잠금 밖에서 부른다(느린 소켓이 close·타이머·붙기를 붙들지 않게, WP-2013).
   */
  private void rejectInput(Pair p, String reason) {
    sendJson(p, p.runner, Map.of("type", "input", "enabled", false));
    sendJson(p, p.browser, Map.of("type", "error", "message", reason));
  }

  /**
   * 같은 AI 의 다른 열린 화면(모든 파드)이 runner 가 확인한 입력을 쥐고 있는지 — 공유 경로 표의 임대가 살아 있는 input_holder 행으로 본다. DB
   * 호출이라 잠금 밖에서 부르고, 오류는 던진다(호출자가 입력을 열지 않는다).
   */
  private boolean inputTakenByOther(Pair p) {
    return routes.inputTakenByOther(p.id, p.tenantId, p.agentUserId);
  }

  /** 공유 경로 표의 입력 중 표시를 끈다 — 실패는 로그만(메모리 플래그는 이미 꺼져 키를 넘기지 않고, 표시는 닫힐 때 행과 함께 사라진다). */
  private void releaseInput(Pair p) {
    try {
      routes.releaseInput(p.id);
    } catch (RuntimeException e) {
      log.warn("작업 화면 입력 중 표시 끄기 실패 session={}", p.id, e);
    }
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
          // 끄기는 runner 확인을 기다리지 않고 바로 키 입력 넘기기를 멈춘다(안전한 쪽). 표의 입력 중 표시도 꺼 다른 화면이 켤 수 있게 한다.
          p.inputEnabled = false;
          releaseInput(p);
          send(p, p.runner, message);
        }
      }
      default -> {
        // 모르는 종류는 runner 로 넘기지 않는다 — 계약에 없는 명령이 터미널에 닿지 않게.
      }
    }
  }

  /**
   * 브라우저의 입력 켜기 요청 — 같은 AI 의 다른 화면(모든 파드)이 이미 입력 중이면 막고 브라우저에 오류를 보낸다. 아니면 runner 로 넘길 뿐이다: 입력이
   * 열렸다고 보는 것·기록·감사는 runner 가 켜졌다고 알릴 때({@link #runnerInput})다.
   */
  private void requestInput(Pair p, TextMessage message) {
    // 판정(DB)·오류 보내기는 잠금 밖에서 — 느린 DB·브라우저 소켓이 close·타이머·붙기를 붙들지 않게(WP-2013 리뷰 후속, WP-1978).
    InputCheck check =
        checkInput(p, () -> inputTakenByOther(p), "작업 화면 입력 중 확인 실패 — 켜기 요청을 넘기지 않음");
    if (check != InputCheck.OK) {
      sendJson(p, p.browser, Map.of("type", "error", "message", check.rejection));
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

  /** 브라우저 소켓이 닫혔다 — 까닭을 정해 남긴다(넘기던 파드가 멈춰 닫았으면 {@link #REASON_SHUTDOWN}). */
  void browserClosed(UUID id, WebSocketSession raw, String reason) {
    Pair p = pairs.get(id);
    if (p == null) return;
    // 그 소켓이 이 세션의 브라우저일 때만 — 거절돼 닫힌 두 번째 브라우저 소켓이 세션을 닫지 않게(runnerClosed 와 같다).
    if (sameSocket(p.browser, raw)) close(p, reason, false);
  }

  /**
   * runner 소켓이 닫혔다 — 그 소켓이 이 세션의 runner 일 때만(거절된 두 번째 runner 가 세션을 닫지 않게). 까닭을 정해 남긴다(넘기던 파드가 멈춰
   * 닫았으면 {@link #REASON_SHUTDOWN}).
   */
  void runnerClosed(UUID id, WebSocketSession raw, String reason) {
    Pair p = pairs.get(id);
    if (p == null) return;
    if (sameSocket(p.runner, raw)) close(p, reason, true);
  }

  /**
   * 세션을 한 번만 닫는다: 레지스트리에서 빼고 공유 경로 행을 지우고, 남은 입력 기록을 쓰고, 브라우저에 끝남 상태를 알린 뒤(브라우저가 닫은 것이 아니면) 두 소켓을
   * 닫고, 세션 행에 닫힌 때·까닭을 남긴다. 한국어 까닭은 상태 프레임에 싣는다 — 닫기 프레임의 까닭은 123바이트까지라 짧은 영문만 쓴다. 한 단계가 실패해도 나머지
   * 단계는 실행하고 단계 실패는 던지지 않는다({@link #closeStep}).
   *
   * <p>closed 표시와 표 제거는 attach 와 같은 잠금 아래에서 한다. attach 가 그 잠금 아래에서 closed 를 보고 소켓 칸을 채우므로, 잠금을 놓은
   * 뒤에는 이미 붙은 소켓은 아래 단계가 읽어 닫고 늦게 온 attach 는 스스로 닫는다(WP-2013).
   */
  void close(Pair p, String reason, boolean notifyBrowser) {
    synchronized (this) {
      if (!p.closed.compareAndSet(false, true)) return;
      pairs.remove(p.id);
    }
    // 공유 경로 행을 먼저 지운다 — 상한 자리·입력 중 표시·쓰지 않은 접속 표가 다른 파드에서도 바로 풀리게(DB 호출이라 잠금 밖).
    closeStep(p, "경로 정리", () -> routes.remove(p.id));
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
   * 1초마다: 기한 검사(지난 세션 닫기), 입력 기록 꺼내 쓰기, 25초마다 핑. 단계마다·세션마다 실패를 따로 잡아, 한 세션이나 한 단계의 실패가 나머지(같은 세션의
   * 다른 단계·다른 세션·핑)를 막지 않게 한다. 임대 갱신은 여기서 하지 않는다 — {@link #renew}(별도 스레드).
   */
  void tick() {
    // executor 는 작업이 어떤 Throwable 이든 던지면 다음 주기를 다시 돌리지 않는다. 그래서 Error 까지 잡는다. 또 한 세션이
    // 매번 실패해도 뒤의 세션과 핑이 굶지 않도록 단계·세션별로 나눠 잡는다(WP-2009).
    Instant now = Instant.now();
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

  /**
   * 갱신 스레드의 {@link #RENEW_INTERVAL}(30초) 주기 작업 — 임대를 한 번 갱신한다. executor 는 작업이 던지면 다음 주기를 취소하므로
   * Error 까지 잡는다 — DB 장애로 갱신이 실패해도 다음 주기(30초 뒤)에 다시 한다(WP-2009 규칙). 테스트가 결과를 곧바로 보도록 패키지 공개다.
   */
  void renew() {
    try {
      renewRoutes();
    } catch (Throwable e) {
      log.warn("작업 화면 경로 임대 갱신 실패", e);
    }
  }

  /**
   * 이 파드의 열린 짝들의 공유 경로 임대를 한 문장으로 늘린다. 늘리지 못한 행(사라졌거나 이미 임대가 지나 다른 파드가 지웠을 수 있음)의 짝은 닫는다 — 다시 넣으면 그
   * 사이 다른 파드가 잡은 자리와 합쳐 상한을 넘을 수 있다(설계 「빌더 점검」 5). 닫기는 타이머 닫기처럼 표시해 브라우저 드레인을 별도 스레드로 넘긴다 — 갱신 스레드도
   * 단일 스레드라 세션당 2초 드레인을 기다리면 다음 갱신이 밀린다.
   */
  private void renewRoutes() {
    List<UUID> ids = pairs.values().stream().filter(p -> !p.closed.get()).map(p -> p.id).toList();
    if (ids.isEmpty()) return;
    for (UUID id : routes.renew(pod.id(), ids)) {
      Pair p = pairs.get(id);
      if (p == null) continue; // 그 사이 스스로 닫혔다
      try {
        closingFromTimer.set(true);
        try {
          close(p, REASON_ROUTE_LOST, true);
        } finally {
          closingFromTimer.remove();
        }
      } catch (Throwable e) {
        log.warn("작업 화면 경로 잃은 세션 닫기 실패 session={}", id, e);
      }
    }
  }

  /**
   * 세션이 닫혀야 할 까닭 — 표를 안 씀(표 만료 + {@link #FORWARD_GRACE} 뒤), 다른 파드가 넘겨 온 소켓의 퐁이 60초 없음(그 사이 보낸 핑에도 답
   * 없음 — {@link #podLinkLost}), runner 가 15초 안에 안 붙음, 30분 무활동, 4시간 지남.
   */
  static Optional<String> expiry(Pair p, Instant now) {
    if (p.browser == null) {
      // 표 만료 뒤에도 유예만큼 기다린다 — 다른 파드가 막 쓴 표로 이어 붙이는 중일 수 있다. now - 유예 와 비교해 먼 미래 기한도 넘치지 않게.
      return now.minus(FORWARD_GRACE).isBefore(p.ticketDeadline)
          ? Optional.empty()
          : Optional.of(REASON_NOT_OPENED);
    }
    if (podLinkLost(p.browserPong, p.browserPingAt, now)
        || podLinkLost(p.runnerPong, p.runnerPingAt, now)) {
      return Optional.of(REASON_POD_LINK_LOST);
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
   * 넘겨 온 소켓이 끊겼는지 — 마지막 퐁이 {@link #PONG_TIMEOUT} 을 넘었고, 그 퐁 뒤에 이 소켓에 보낸 핑이 있으며 그 핑에도 {@link
   * #PONG_ANSWER_WAIT} 동안 답이 없을 때만 참이다(WP-1978 리뷰 후속 ①). 퐁 시각만 보면 타이머 스레드가 DB 호출로 묶여 핑을 못 보낸 동안에도
   * 퐁이 끊긴 것처럼 보여 멀쩡한 넘긴 화면을 닫는다 — 핑을 보내지 않았으면 답이 없는 것이 당연하다. 직접 붙은 소켓(퐁 시각 null)은 보지 않는다.
   */
  private static boolean podLinkLost(Instant lastPong, Instant pingAt, Instant now) {
    return lastPong != null
        && pingAt != null
        && pingAt.isAfter(lastPong)
        && !now.isBefore(lastPong.plus(PONG_TIMEOUT))
        && !now.isBefore(pingAt.plus(PONG_ANSWER_WAIT));
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
    WebSocketSession browser = p.browser;
    WebSocketSession runner = p.runner;
    // 보내기 직전 시각을 소켓마다 적는다 — 타이머가 앞 단계(DB)에 묶였다 풀린 회차여도 실제로 핑이 나간 때를 퐁 판정이 쓰게(WP-1978 리뷰 후속 ①).
    if (pingSocket(p, browser)) p.browserPingAt = Instant.now();
    if (pingSocket(p, runner)) p.runnerPingAt = Instant.now();
  }

  /**
   * 소켓 하나에 핑을 보내 본다 — 열린 소켓이라 보내기를 시도했으면 true(실패해도 시도로 친다). Error 까지 잡아 한 소켓의 실패가 같은 세션의 다른 소켓·뒤
   * 세션의 핑을 막지 않게 한다(WP-2009).
   */
  private boolean pingSocket(Pair p, WebSocketSession s) {
    if (s == null || !s.isOpen()) return false;
    try {
      s.sendMessage(new PingMessage());
    } catch (Throwable e) {
      log.debug("작업 화면 핑 실패 session={}", p.id, e);
    }
    return true;
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
}

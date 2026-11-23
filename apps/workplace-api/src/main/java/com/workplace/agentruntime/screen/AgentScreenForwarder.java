package com.workplace.agentruntime.screen;

import static com.workplace.agentruntime.screen.ScreenSockets.closeQuietly;
import static com.workplace.agentruntime.screen.ScreenSockets.copy;
import static com.workplace.agentruntime.screen.ScreenSockets.decorate;

import jakarta.annotation.PreDestroy;
import jakarta.websocket.ContainerProvider;
import jakarta.websocket.DeploymentException;
import jakarta.websocket.WebSocketContainer;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.PingMessage;
import org.springframework.web.socket.PongMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

/**
 * 다른 파드로 온 작업 화면 소켓을 주인 파드에 이어 붙이는 관(WP-1978).
 *
 * <p>화면의 짝(Pair)은 POST 를 받은 주인 파드 메모리에만 있다. 브라우저나 runner 소켓이 다른 파드에 오면 이 파드가 주인 파드의 내부 경로({@link
 * AgentScreenWebSocketConfig#INTERNAL_PATH_PREFIX}{@code {id}/{browser|runner}})로 WebSocket 을 열고(내부
 * 토큰·테넌트·위치 헤더) 두 다리 사이의 프레임을 그대로 넘긴다. 입력 판정·기록·감사는 모두 주인 파드가 한다 — 이 관은 내용을 보지 않는다(설계 「빌더 점검」 6).
 *
 * <p>한쪽 다리가 닫히면 다른 다리도 같은 상태로 닫고, 보내기가 실패하면 두 다리를 모두 닫는다. 받은 다리에는 25초마다 핑을 보낸다 — 주인 파드의 핑은 위쪽 다리에만
 * 닿으므로 이 파드와 브라우저·runner 사이 구간이 nginx 무활동 끊김에 걸리지 않게. 위쪽 다리에도 같이 핑을 보내고 퐁이 {@link
 * AgentScreenRelay#PONG_TIMEOUT}(60초) 동안 오지 않으면 주인 파드가 사라진 것으로 보고 두 다리를 닫는다 — 닫기 프레임 없이 끊긴 파드 사이
 * 연결이 반쯤 열린 채 남지 않게.
 */
@Component
@Slf4j
public class AgentScreenForwarder {

  /** 주인 파드 연결·등록 확인 제한 — 이 안에 잇지 못하면 받은 소켓을 닫는다. */
  static final long CONNECT_TIMEOUT_SECONDS = 5;

  /**
   * 이 파드가 멈춰 위쪽 다리를 닫을 때의 닫기 상태 — 주인 파드가 이 값을 보고 「관리자가 화면을 닫았어요」 대신 서버가 멈춘 까닭을 남긴다(4000~4999 는
   * 애플리케이션 전용 값).
   */
  static final CloseStatus POD_SHUTDOWN = new CloseStatus(4001, "pod shutdown");

  /** 소켓 하나의 두 다리 — 받은 소켓(inbound)과 주인 파드로 연 소켓(upstream). */
  private static final class Link {
    final WebSocketSession inbound;
    final String sessionId;
    volatile WebSocketSession upstream;
    final AtomicBoolean closed = new AtomicBoolean();
    // 위쪽 다리에서 마지막으로 퐁을 받은 때(System.nanoTime) — 잇는 동안은 만든 때로 본다.
    volatile long lastPongNanos = System.nanoTime();
    // 주인 파드가 위쪽 소켓 등록을 마쳤다는 표시 — 핑에 돌아온 퐁으로 안다.
    final CompletableFuture<Void> ready = new CompletableFuture<>();

    Link(WebSocketSession inbound, String sessionId) {
      this.inbound = inbound;
      this.sessionId = sessionId;
    }
  }

  private final Map<String, Link> links = new ConcurrentHashMap<>();
  private final StandardWebSocketClient client;
  private final String internalToken;
  private final ScheduledExecutorService pinger;

  public AgentScreenForwarder(
      @Value("${workplace.ai-agent.internal-token:}") String internalToken) {
    this.internalToken = internalToken;
    WebSocketContainer container = ContainerProvider.getWebSocketContainer();
    // 위쪽 다리도 받은 다리와 같은 64KB 상한 — 클라이언트 컨테이너 기본 8KB 면 tmux 다시 그리기 프레임에서 끊긴다.
    container.setDefaultMaxBinaryMessageBufferSize(AgentScreenWebSocketConfig.MAX_MESSAGE_BYTES);
    container.setDefaultMaxTextMessageBufferSize(AgentScreenWebSocketConfig.MAX_MESSAGE_BYTES);
    this.client = new StandardWebSocketClient(container);
    this.pinger = ScreenSockets.daemonScheduler("agent-screen-forward-ping");
    long every = AgentScreenRelay.PING_INTERVAL.toSeconds();
    pinger.scheduleWithFixedDelay(this::pingAll, every, every, TimeUnit.SECONDS);
  }

  /**
   * 서버가 멈출 때 핑을 멈추고 이어 둔 관을 모두 닫는다. 위쪽 다리는 {@link #POD_SHUTDOWN} 으로 닫아 주인 파드가 서버 멈춤으로 기록하게 하고, 받은
   * 다리는 1001(떠남)로 닫는다.
   */
  @PreDestroy
  void shutdown() {
    pinger.shutdownNow();
    for (Link link : List.copyOf(links.values())) {
      closeBoth(link, POD_SHUTDOWN, CloseStatus.GOING_AWAY);
    }
  }

  /** 백그라운드 핑을 멈춘다(테스트용 — 테스트가 {@link #pingAll(long)} 을 직접 부른다). */
  void stopPingerForTest() {
    pinger.shutdownNow();
  }

  /** 받은 소켓 하나로 관을 만들고 위쪽 다리의 처리기를 돌려준다(테스트용 — 실제 주인 파드 없이 처리기에 가짜 위쪽 소켓을 넣어 퐁·닫기를 본다). */
  AbstractWebSocketHandler linkForTest(WebSocketSession inbound, String sessionId) {
    Link link = new Link(decorate(inbound), sessionId);
    links.put(inbound.getId(), link);
    return new UpstreamHandler(link);
  }

  /**
   * 받은 소켓을 주인 파드에 잇는다 — 받은 쪽 핸들러의 연결 직후(프레임을 읽기 전)에 부른다. 주인 파드의 내부 경로로 연결하고 핑을 보내 퐁이 올 때까지(=주인이 등록을
   * 마칠 때까지) 기다린 뒤 돌아온다. 그래야 이어 붙은 브라우저 뒤에 오는 runner 가 주인에서 「브라우저 없음」으로 거절되지 않는다. 주인이 핸드셰이크를 거절하면(짝
   * 없음·이미 붙음) 1008, 닿지 못하거나 제한 시간을 넘기면 1011 로 받은 소켓을 닫는다. 표는 되살리지 않는다(설계 「빌더 점검」 1).
   */
  public void open(WebSocketSession inbound, AgentScreenRoutes.Route route, String role) {
    Link link = new Link(decorate(inbound), route.sessionId().toString());
    links.put(inbound.getId(), link);
    WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
    headers.add(AgentScreenWebSocketConfig.HEADER_INTERNAL_TOKEN, internalToken);
    headers.add(AgentScreenWebSocketConfig.HEADER_TENANT, String.valueOf(route.tenantId()));
    headers.add(AgentScreenWebSocketConfig.HEADER_LOCATION, String.valueOf(route.locationId()));
    URI uri =
        URI.create(
            "ws://"
                + route.ownerAddr()
                + AgentScreenWebSocketConfig.INTERNAL_PATH_PREFIX
                + route.sessionId()
                + "/"
                + role);
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(CONNECT_TIMEOUT_SECONDS);
    try {
      client
          .execute(new UpstreamHandler(link), headers, uri)
          .get(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
      // 위쪽 다리는 연결 직후 처리기(afterConnectionEstablished)가 관에 적는다 — 클라이언트는 그 처리기를 부른 뒤에야 연결 결과를 돌려준다.
      link.upstream.sendMessage(new PingMessage());
      link.ready.get(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      failOpen(link, role, e);
    } catch (Exception e) {
      failOpen(link, role, e);
    }
  }

  /** 잇기 실패 — 주인이 거절했으면 1008, 아니면 1011 로 두 다리를 닫는다. 로그에는 표·토큰을 싣지 않는다. */
  private void failOpen(Link link, String role, Exception e) {
    boolean refused = refusedByOwner(e);
    log.warn(
        "작업 화면 주인 파드 잇기 실패 session={} role={} refused={} cause={}",
        link.sessionId,
        role,
        refused,
        e.toString());
    // 늦게 열린 위쪽 다리는 처리기(afterConnectionEstablished)가 닫힘을 보고 스스로 닫는다 — 여기서 따로 챙기지 않는다.
    closeBoth(link, refused ? CloseStatus.POLICY_VIOLATION : CloseStatus.SERVER_ERROR);
  }

  /** 주인 파드가 핸드셰이크를 403 으로 거절했는지 — Tomcat 클라이언트는 상태 코드를 메시지에만 싣는다. */
  private static boolean refusedByOwner(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof DeploymentException && String.valueOf(t.getMessage()).contains("[403]")) {
        return true;
      }
    }
    return false;
  }

  /** 받은 소켓의 프레임을 주인 파드로 그대로 넘긴다(바이너리는 복사 — 컨테이너가 다시 쓰는 수신 버퍼를 나중에 읽지 않게). */
  public void relayFromInbound(WebSocketSession inbound, WebSocketMessage<?> message) {
    Link link = links.get(inbound.getId());
    if (link == null) return;
    send(link, link.upstream, message);
  }

  /** 받은 소켓이 닫히면 위쪽 다리도 같은 상태로 닫는다. */
  public void inboundClosed(WebSocketSession inbound, CloseStatus status) {
    Link link = links.get(inbound.getId());
    if (link != null) closeBoth(link, status);
  }

  /** 한 다리로 보낸다 — 실패하면 두 다리를 닫는다(한쪽만 남아 화면이 멈춘 채로 있지 않게). */
  private void send(Link link, WebSocketSession target, WebSocketMessage<?> message) {
    if (link.closed.get() || target == null || !target.isOpen()) return;
    try {
      target.sendMessage(message instanceof BinaryMessage b ? new BinaryMessage(copy(b)) : message);
    } catch (IOException | RuntimeException e) {
      log.debug("작업 화면 넘기기 보내기 실패 session={}", link.sessionId, e);
      closeBoth(link, CloseStatus.SERVER_ERROR);
    }
  }

  /** 두 다리를 같은 상태로 닫고 관을 지운다 — 이미 닫혔으면 무시. */
  private void closeBoth(Link link, CloseStatus status) {
    closeBoth(link, status, status);
  }

  /** 위쪽·받은 다리를 각각 주어진 상태로 닫고 관을 지운다 — 이미 닫혔으면 무시. */
  private void closeBoth(Link link, CloseStatus upstreamStatus, CloseStatus inboundStatus) {
    if (!link.closed.compareAndSet(false, true)) return;
    links.remove(link.inbound.getId(), link);
    link.ready.completeExceptionally(new IllegalStateException("closed: " + upstreamStatus));
    closeQuietly(link.upstream, sendable(upstreamStatus));
    closeQuietly(link.inbound, sendable(inboundStatus));
  }

  /**
   * 닫기 프레임에 실을 수 있는 상태로 바꾼다 — 1005(상태 없음)·1006(비정상 끊김)·1015(TLS)는 받는 쪽이 붙이는 예약 값이라 보낼 수 없어
   * 1001(떠남)로 넘긴다.
   */
  private static CloseStatus sendable(CloseStatus status) {
    int code = status.getCode();
    return code == 1005 || code == 1006 || code == 1015 ? CloseStatus.GOING_AWAY : status;
  }

  /** 주기 핑 — 지금 시각으로 {@link #pingAll(long)} 을 부른다. */
  private void pingAll() {
    pingAll(System.nanoTime());
  }

  /**
   * 25초마다 두 다리에 핑을 보내고, 잇기를 마친 관 중 위쪽 다리의 퐁이 {@link AgentScreenRelay#PONG_TIMEOUT} 넘게 없으면 두 다리를
   * 닫는다(주인 파드가 닫기 프레임 없이 사라진 경우). 관마다 Error 까지 잡아 한 관의 실패가 다른 관·다음 주기를 막지 않게(예외가 새면 executor 가 주기를
   * 멈춘다). 테스트가 시각을 넣어 직접 부를 수 있게 패키지 공개다.
   */
  void pingAll(long nowNanos) {
    long timeout = AgentScreenRelay.PONG_TIMEOUT.toNanos();
    try {
      for (Link link : List.copyOf(links.values())) {
        try {
          if (link.closed.get()) continue;
          if (link.ready.isDone() && nowNanos - link.lastPongNanos > timeout) {
            log.info("작업 화면 주인 파드 응답 없음 — 관을 닫음 session={}", link.sessionId);
            closeBoth(link, CloseStatus.SERVER_ERROR);
            continue;
          }
          if (link.inbound.isOpen()) link.inbound.sendMessage(new PingMessage());
          WebSocketSession upstream = link.upstream;
          if (upstream != null && upstream.isOpen()) upstream.sendMessage(new PingMessage());
        } catch (Throwable e) {
          log.debug("작업 화면 넘기기 핑 실패 session={}", link.sessionId, e);
        }
      }
    } catch (Throwable e) {
      log.warn("작업 화면 넘기기 핑 단계 실패", e);
    }
  }

  /** 주인 파드 쪽 다리의 처리기 — 받은 프레임을 받은 소켓으로 넘기고, 닫히면 받은 소켓도 닫는다. */
  private final class UpstreamHandler extends AbstractWebSocketHandler {
    private final Link link;

    UpstreamHandler(Link link) {
      this.link = link;
    }

    @Override
    public void afterConnectionEstablished(@NonNull WebSocketSession session) {
      session.setTextMessageSizeLimit(AgentScreenWebSocketConfig.MAX_MESSAGE_BYTES);
      session.setBinaryMessageSizeLimit(AgentScreenWebSocketConfig.MAX_MESSAGE_BYTES);
      // 위쪽 다리를 먼저 관에 적고 나서 닫힘을 본다 — 제한 시간을 넘겨 포기한 잇기(failOpen/closeBoth)와 겹쳐도 둘 중 하나는 이 소켓을 닫는다
      // (닫기 쪽이 closed 를 먼저 세웠으면 여기서 보고 닫고, 아니면 closeBoth 가 관에 적힌 이 소켓을 닫는다).
      WebSocketSession decorated = decorate(session);
      link.upstream = decorated;
      // 제한 시간을 넘겨 이미 포기한 잇기가 늦게 열렸으면 바로 닫는다 — 주인 파드에 주인 없는 다리가 남지 않게.
      if (link.closed.get()) closeQuietly(decorated, CloseStatus.GOING_AWAY);
    }

    @Override
    protected void handleTextMessage(
        @NonNull WebSocketSession session, @NonNull TextMessage message) {
      send(link, link.inbound, message);
    }

    @Override
    protected void handleBinaryMessage(
        @NonNull WebSocketSession session, @NonNull BinaryMessage message) {
      send(link, link.inbound, message);
    }

    @Override
    protected void handlePongMessage(
        @NonNull WebSocketSession session, @NonNull PongMessage message) {
      // 잇기 때 보낸 핑의 답 — 주인 파드가 등록(onOpen)을 마친 뒤에야 프레임을 읽으므로 등록 완료를 뜻한다.
      // 이후 주기 핑의 답은 주인 파드가 살아 있다는 표시다(퐁이 끊기면 pingAll 이 관을 닫는다).
      link.lastPongNanos = System.nanoTime();
      link.ready.complete(null);
    }

    @Override
    public void afterConnectionClosed(
        @NonNull WebSocketSession session, @NonNull CloseStatus status) {
      closeBoth(link, status);
    }
  }
}

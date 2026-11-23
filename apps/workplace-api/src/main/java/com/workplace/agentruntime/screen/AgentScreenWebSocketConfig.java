package com.workplace.agentruntime.screen;

import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.global.config.CorsProperties;
import com.workplace.global.util.CapabilityTokens;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.PongMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * AI 작업 화면 WebSocket 구성(WP-1277) — STOMP 없이 평범한 처리기 두 개.
 *
 * <ul>
 *   <li>브라우저 {@code GET /api/v1/admin/agent-screen?ticket=…} — 브라우저 WebSocket 은 헤더를 못 실어 JWT 필터를
 *       거치지 않고 (SecurityConfig 가 이 경로만 permitAll) 핸드셰이크에서 일회용 표로만 인증한다. 표는 공유 경로 표(WP-1978)에서 해시로 한
 *       번만 소비한다. 표가 없거나 만료·사용됐으면 403.
 *   <li>runner {@code GET /api/v1/agent-runtime/runner/screen/{sessionId}} — 기존 runner 토큰 필터({@code
 *       Bearer rt_})가 인증하고, 핸드셰이크에서 공유 경로 행의 테넌트·위치가 토큰의 것과 같은지 본다(행 없음·다름 → 403).
 *   <li>내부 {@code GET /api/v1/internal/agent-screen/{sessionId}/{browser|runner}}(WP-1978) — 다른 파드가
 *       넘겨 온 소켓을 주인 파드가 받는 경로. 내부 토큰 헤더로 인증하고(SecurityConfig 는 permitAll) 헤더의 테넌트·위치로 직접 붙을 때와 같은
 *       메모리 판정을 한 뒤 같은 처리기로 받는다 — 넘겨진 소켓은 직접 붙은 소켓과 같다.
 * </ul>
 *
 * <p>공개 두 경로는 화면의 주인 파드가 이 파드가 아니면 소켓을 받은 뒤 {@link AgentScreenForwarder} 로 주인 파드의 내부 경로에 이어
 * 붙인다(WP-1978).
 *
 * <p>두 처리기 모두 텍스트·바이너리를 함께 받으므로 {@link AbstractWebSocketHandler} 를 쓴다(Text/BinaryWebSocketHandler 는
 * 다른 종류가 오면 1003 으로 닫는다).
 */
@Configuration
@EnableWebSocket
@Slf4j
public class AgentScreenWebSocketConfig implements WebSocketConfigurer {

  /** 브라우저 경로 — SecurityConfig 의 permitAll 규칙과 같은 값이다. */
  public static final String BROWSER_PATH = "/api/v1/admin/agent-screen";

  /** runner 경로 접두사 — runner 토큰 필터의 경로({@code /api/v1/agent-runtime/runner/}) 아래다. */
  public static final String RUNNER_PATH_PREFIX = "/api/v1/agent-runtime/runner/screen/";

  /** 프레임 크기 상한 — tmux 전체 다시 그리기가 Tomcat 기본 8KB 를 넘어 1009 로 끊기지 않게 64KB. */
  static final int MAX_MESSAGE_BYTES = 64 * 1024;

  /**
   * 내부 경로 접두사(WP-1978) — 뒤에 {@code {sessionId}/browser} 또는 {@code {sessionId}/runner}.
   * SecurityConfig 가 permitAll.
   */
  public static final String INTERNAL_PATH_PREFIX = "/api/v1/internal/agent-screen/";

  /** 내부 경로 인증 헤더 — 값은 api 의 내부 서비스 토큰({@code workplace.ai-agent.internal-token}). */
  static final String HEADER_INTERNAL_TOKEN = "X-Internal-Token";

  /** 내부 경로로 넘기는 화면의 테넌트·위치 — 주인 파드가 메모리 짝과 다시 견준다. */
  static final String HEADER_TENANT = "X-Screen-Tenant";

  static final String HEADER_LOCATION = "X-Screen-Location";

  static final String ROLE_BROWSER = "browser";
  static final String ROLE_RUNNER = "runner";

  private static final String ATTR_SESSION = "agentScreenSessionId";

  /** 이 소켓을 주인 파드로 넘길 때의 경로 행·역할 — 있으면 중계 대신 넘기기 관으로 처리한다. */
  private static final String ATTR_FORWARD_ROUTE = "agentScreenForwardRoute";

  private static final String ATTR_FORWARD_ROLE = "agentScreenForwardRole";

  /** 다른 파드가 내부 경로로 넘겨 온 소켓이라는 표시(주인 파드 쪽) — 퐁 제한과 넘기던 파드의 멈춤 닫기를 본다. */
  private static final String ATTR_VIA_POD = "agentScreenViaPod";

  private final AgentScreenRelay relay;
  private final AgentScreenRoutes routes;
  private final AgentScreenForwarder forwarder;
  private final CorsProperties corsProperties;
  private final String internalToken;

  public AgentScreenWebSocketConfig(
      AgentScreenRelay relay,
      AgentScreenRoutes routes,
      AgentScreenForwarder forwarder,
      CorsProperties corsProperties,
      @Value("${workplace.ai-agent.internal-token:}") String internalToken) {
    this.relay = relay;
    this.routes = routes;
    this.forwarder = forwarder;
    this.corsProperties = corsProperties;
    this.internalToken = internalToken;
  }

  @Override
  public void registerWebSocketHandlers(@NonNull WebSocketHandlerRegistry registry) {
    var browser =
        registry
            .addHandler(new BrowserHandler(), BROWSER_PATH)
            .addInterceptors(new BrowserTicketInterceptor());
    // 브라우저 출처 — 웹 앱은 API 와 다른 출처(로컬 6173 → 6060)에서 붙으므로 CORS 허용 출처를 그대로 쓴다. 설정이 없으면 같은 출처만.
    // 인증은 POST(Bearer)로만 받는 일회용 표라 다른 사이트가 연결을 가로채지 못한다(쿠키로 인증하지 않는다).
    List<String> origins =
        Optional.ofNullable(corsProperties.allowedOrigins()).orElse(List.of()).stream()
            .filter(o -> o != null && !o.isBlank())
            .toList();
    if (!origins.isEmpty()) browser.setAllowedOrigins(origins.toArray(String[]::new));
    registry
        .addHandler(new RunnerHandler(), RUNNER_PATH_PREFIX + "*")
        .addInterceptors(new RunnerSessionInterceptor());
    // 내부 경로 — 다른 api 파드만 부른다(브라우저가 아님). 출처 제한을 걸지 않고 내부 토큰으로만 인증한다. 처리기는 공개 경로와 같은 것을 쓴다.
    registry
        .addHandler(new BrowserHandler(), INTERNAL_PATH_PREFIX + "*/" + ROLE_BROWSER)
        .addInterceptors(new InternalInterceptor(ROLE_BROWSER));
    registry
        .addHandler(new RunnerHandler(), INTERNAL_PATH_PREFIX + "*/" + ROLE_RUNNER)
        .addInterceptors(new InternalInterceptor(ROLE_RUNNER));
  }

  /**
   * 소켓마다 프레임 크기 상한을 64KB 로 올린다. 컨테이너 기본값(ServletServerContainerFactoryBean)은 내장 Tomcat 의 업그레이드 경로에서
   * 세션에 반영되지 않아(8KB 로 만들어짐, 테스트로 확인) 연결 직후 세션에 직접 건다 — 이 한 곳이 상한이다.
   */
  private static void raiseLimits(WebSocketSession session) {
    session.setTextMessageSizeLimit(MAX_MESSAGE_BYTES);
    session.setBinaryMessageSizeLimit(MAX_MESSAGE_BYTES);
  }

  private static UUID sessionIdOf(WebSocketSession s) {
    return (UUID) s.getAttributes().get(ATTR_SESSION);
  }

  /** 핸드셰이크가 주인 파드로 넘기라고 적은 소켓인지. */
  private static boolean forwarded(WebSocketSession s) {
    return s.getAttributes().containsKey(ATTR_FORWARD_ROUTE);
  }

  /** 다른 파드가 내부 경로로 넘겨 온 소켓인지(주인 파드 쪽). */
  private static boolean viaPod(WebSocketSession s) {
    return Boolean.TRUE.equals(s.getAttributes().get(ATTR_VIA_POD));
  }

  /**
   * 소켓이 닫힌 까닭 — 넘기던 파드가 멈추며 {@link AgentScreenForwarder#POD_SHUTDOWN} 으로 닫았으면 서버 멈춤, 아니면 주어진 기본 까닭.
   */
  private static String closeReason(WebSocketSession s, CloseStatus status, String fallback) {
    if (viaPod(s) && status.getCode() == AgentScreenForwarder.POD_SHUTDOWN.getCode()) {
      return AgentScreenRelay.REASON_SHUTDOWN;
    }
    return fallback;
  }

  /** 넘길 소켓으로 표시한다 — 연결 뒤 처리기가 중계 대신 넘기기 관을 쓴다. */
  private static void markForward(
      Map<String, Object> attributes, AgentScreenRoutes.Route route, String role) {
    attributes.put(ATTR_FORWARD_ROUTE, route);
    attributes.put(ATTR_FORWARD_ROLE, role);
  }

  /** 넘길 소켓을 주인 파드에 잇는다(연결 직후). */
  private void openForward(WebSocketSession s) {
    forwarder.open(
        s,
        (AgentScreenRoutes.Route) s.getAttributes().get(ATTR_FORWARD_ROUTE),
        (String) s.getAttributes().get(ATTR_FORWARD_ROLE));
  }

  /** 경로의 세션 id 문자열을 UUID 로 — 형식이 틀리면 빈 값. */
  private static Optional<UUID> parseId(String raw) {
    try {
      return Optional.of(UUID.fromString(raw));
    } catch (IllegalArgumentException e) {
      return Optional.empty();
    }
  }

  /** 거절 — 403 을 적고 false. 상태를 안 적으면 업그레이드 없는 200 이 나간다. */
  private static boolean reject(ServerHttpResponse response) {
    response.setStatusCode(HttpStatus.FORBIDDEN);
    return false;
  }

  /**
   * 브라우저 핸드셰이크 — 쿼리의 표를 공유 경로 표에서 해시로 소비한다(일회용, 모든 파드 공통). 주인 파드가 이 파드면 그 세션에 아직 브라우저가 없을 때만 받고,
   * 주인이 다른 파드면 넘길 소켓으로 표시하고 받는다(주인의 판정은 내부 경로 핸드셰이크에서 한다). 표 저장소(DB) 오류는 500 대신 403 으로 거절한다.
   */
  final class BrowserTicketInterceptor implements HandshakeInterceptor {
    @Override
    public boolean beforeHandshake(
        @NonNull ServerHttpRequest request,
        @NonNull ServerHttpResponse response,
        @NonNull WebSocketHandler wsHandler,
        @NonNull Map<String, Object> attributes) {
      URI uri = request.getURI();
      String ticket = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("ticket");
      if (ticket == null || ticket.isBlank()) return reject(response);
      Optional<AgentScreenRoutes.Route> route;
      try {
        route = routes.consumeTicket(CapabilityTokens.sha256Hex(ticket));
      } catch (RuntimeException e) {
        // DB 오류가 500 으로 새지 않게 거절한다. 로그에 표 평문·해시를 싣지 않는다.
        log.warn("작업 화면 접속 표 확인 실패 — 거절 cause={}", e.toString());
        return reject(response);
      }
      if (route.isEmpty()) return reject(response);
      AgentScreenRoutes.Route r = route.get();
      if (relay.isOwner(r)) {
        if (!relay.canAttachBrowser(r.sessionId(), r.tenantId())) return reject(response);
      } else {
        // 짝은 주인 파드 메모리에 있다 — 받은 뒤 주인 파드의 내부 경로로 이어 붙인다(WP-1978).
        markForward(attributes, r, ROLE_BROWSER);
      }
      attributes.put(ATTR_SESSION, r.sessionId());
      return true;
    }

    @Override
    public void afterHandshake(
        @NonNull ServerHttpRequest request,
        @NonNull ServerHttpResponse response,
        @NonNull WebSocketHandler wsHandler,
        Exception exception) {}
  }

  /**
   * runner 핸드셰이크 — 필터가 세운 runner 주체(핸드셰이크는 아직 필터 체인 스레드라 SecurityContext 가 남아 있다)로 공유 경로 행의 테넌트·위치를
   * 견준다(행 없음·다름 → 403, 넘기기 전에). 주인이 이 파드면 메모리 판정까지 보고, 다른 파드면 넘길 소켓으로 표시한다. 표 저장소(DB) 오류는 403.
   */
  final class RunnerSessionInterceptor implements HandshakeInterceptor {
    @Override
    public boolean beforeHandshake(
        @NonNull ServerHttpRequest request,
        @NonNull ServerHttpResponse response,
        @NonNull WebSocketHandler wsHandler,
        @NonNull Map<String, Object> attributes) {
      Authentication auth = SecurityContextHolder.getContext().getAuthentication();
      if (auth == null || !(auth.getPrincipal() instanceof RunnerPrincipal principal)) {
        return reject(response);
      }
      String path = request.getURI().getPath();
      Optional<UUID> parsed = parseId(path.substring(path.lastIndexOf('/') + 1));
      if (parsed.isEmpty()) return reject(response);
      UUID id = parsed.get();
      Optional<AgentScreenRoutes.Route> route;
      try {
        route = routes.find(id);
      } catch (RuntimeException e) {
        log.warn("작업 화면 경로 행 확인 실패 — 거절 session={} cause={}", id, e.toString());
        return reject(response);
      }
      if (route.isEmpty()
          || route.get().tenantId() != principal.tenantId()
          || route.get().locationId() != principal.locationId()) {
        return reject(response);
      }
      AgentScreenRoutes.Route r = route.get();
      if (relay.isOwner(r)) {
        if (!relay.canAttachRunner(id, principal.tenantId(), principal.locationId())) {
          return reject(response);
        }
      } else {
        markForward(attributes, r, ROLE_RUNNER);
      }
      attributes.put(ATTR_SESSION, id);
      return true;
    }

    @Override
    public void afterHandshake(
        @NonNull ServerHttpRequest request,
        @NonNull ServerHttpResponse response,
        @NonNull WebSocketHandler wsHandler,
        Exception exception) {}
  }

  /**
   * 내부 경로 핸드셰이크(주인 파드 쪽, WP-1978) — 내부 토큰을 상수 시간으로 견주고(없거나 다르면 403), 경로의 세션 id 와 헤더의 테넌트·위치로 직접 붙을
   * 때와 같은 메모리 판정({@code canAttachBrowser}·{@code canAttachRunner})을 한다. 넘기는 파드가 이미 경로 행과 견줬어도 주인이
   * 메모리 짝과 다시 견준다(설계 「빌더 점검」 6).
   */
  private final class InternalInterceptor implements HandshakeInterceptor {
    private final String role;

    InternalInterceptor(String role) {
      this.role = role;
    }

    @Override
    public boolean beforeHandshake(
        @NonNull ServerHttpRequest request,
        @NonNull ServerHttpResponse response,
        @NonNull WebSocketHandler wsHandler,
        @NonNull Map<String, Object> attributes) {
      if (!tokenMatches(request.getHeaders().getFirst(HEADER_INTERNAL_TOKEN))) {
        return reject(response);
      }
      // 경로: …/agent-screen/{sessionId}/{role} — 등록 패턴이 역할을 정하므로 id 만 꺼낸다.
      String path = request.getURI().getPath();
      String rest = path.substring(INTERNAL_PATH_PREFIX.length());
      Optional<UUID> id = parseId(rest.substring(0, Math.max(0, rest.indexOf('/'))));
      Optional<Long> tenant = parseLong(request.getHeaders().getFirst(HEADER_TENANT));
      if (id.isEmpty() || tenant.isEmpty()) return reject(response);
      boolean ok;
      if (ROLE_BROWSER.equals(role)) {
        ok = relay.canAttachBrowser(id.get(), tenant.get());
      } else {
        Optional<Long> location = parseLong(request.getHeaders().getFirst(HEADER_LOCATION));
        ok = location.isPresent() && relay.canAttachRunner(id.get(), tenant.get(), location.get());
      }
      if (!ok) return reject(response);
      attributes.put(ATTR_SESSION, id.get());
      attributes.put(ATTR_VIA_POD, Boolean.TRUE);
      return true;
    }

    @Override
    public void afterHandshake(
        @NonNull ServerHttpRequest request,
        @NonNull ServerHttpResponse response,
        @NonNull WebSocketHandler wsHandler,
        Exception exception) {}
  }

  /** 내부 토큰 비교 — 설정이 비면 모두 거절, 길이가 달라도 상수 시간 비교를 거친다(응답 시간으로 토큰을 맞춰 보지 못하게). */
  private boolean tokenMatches(String given) {
    if (internalToken == null || internalToken.isBlank() || given == null) return false;
    byte[] a = given.getBytes(StandardCharsets.UTF_8);
    byte[] b = internalToken.getBytes(StandardCharsets.UTF_8);
    return MessageDigest.isEqual(a, b);
  }

  private static Optional<Long> parseLong(String raw) {
    if (raw == null) return Optional.empty();
    try {
      return Optional.of(Long.parseLong(raw.trim()));
    } catch (NumberFormatException e) {
      return Optional.empty();
    }
  }

  /** 브라우저 소켓 처리기 — 프레임 판정은 중계 레지스트리가 한다. 넘길 소켓이면 넘기기 관으로 보낸다. */
  private final class BrowserHandler extends AbstractWebSocketHandler {
    @Override
    public void afterConnectionEstablished(@NonNull WebSocketSession session) {
      raiseLimits(session);
      if (forwarded(session)) openForward(session);
      else relay.attachBrowser(sessionIdOf(session), session, viaPod(session));
    }

    @Override
    protected void handlePongMessage(
        @NonNull WebSocketSession session, @NonNull PongMessage message) {
      // 넘겨 온 소켓의 퐁만 적는다 — 넘기던 파드가 사라졌는지 보는 데 쓴다(WP-1978).
      if (viaPod(session)) relay.pong(sessionIdOf(session), session);
    }

    @Override
    protected void handleTextMessage(
        @NonNull WebSocketSession session, @NonNull TextMessage message) {
      if (forwarded(session)) forwarder.relayFromInbound(session, message);
      else relay.fromBrowserText(sessionIdOf(session), message);
    }

    @Override
    protected void handleBinaryMessage(
        @NonNull WebSocketSession session, @NonNull BinaryMessage message) {
      if (forwarded(session)) forwarder.relayFromInbound(session, message);
      else relay.fromBrowserBinary(sessionIdOf(session), message);
    }

    @Override
    public void afterConnectionClosed(
        @NonNull WebSocketSession session, @NonNull CloseStatus status) {
      if (forwarded(session)) forwarder.inboundClosed(session, status);
      else {
        relay.browserClosed(
            sessionIdOf(session),
            session,
            closeReason(session, status, AgentScreenRelay.REASON_BROWSER_CLOSED));
      }
    }
  }

  /** runner 소켓 처리기 — runner 가 보낸 프레임은 그대로 브라우저로 넘긴다. 넘길 소켓이면 넘기기 관으로 보낸다. */
  private final class RunnerHandler extends AbstractWebSocketHandler {
    @Override
    public void afterConnectionEstablished(@NonNull WebSocketSession session) {
      raiseLimits(session);
      if (forwarded(session)) openForward(session);
      else relay.attachRunner(sessionIdOf(session), session, viaPod(session));
    }

    @Override
    protected void handlePongMessage(
        @NonNull WebSocketSession session, @NonNull PongMessage message) {
      if (viaPod(session)) relay.pong(sessionIdOf(session), session);
    }

    @Override
    protected void handleTextMessage(
        @NonNull WebSocketSession session, @NonNull TextMessage message) {
      fromRunner(session, message);
    }

    @Override
    protected void handleBinaryMessage(
        @NonNull WebSocketSession session, @NonNull BinaryMessage message) {
      fromRunner(session, message);
    }

    private void fromRunner(WebSocketSession session, WebSocketMessage<?> message) {
      if (forwarded(session)) forwarder.relayFromInbound(session, message);
      else relay.fromRunner(sessionIdOf(session), message);
    }

    @Override
    public void afterConnectionClosed(
        @NonNull WebSocketSession session, @NonNull CloseStatus status) {
      if (forwarded(session)) forwarder.inboundClosed(session, status);
      else {
        relay.runnerClosed(
            sessionIdOf(session),
            session,
            closeReason(session, status, AgentScreenRelay.REASON_RUNNER_CLOSED));
      }
    }
  }
}

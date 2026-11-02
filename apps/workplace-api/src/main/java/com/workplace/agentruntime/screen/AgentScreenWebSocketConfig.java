package com.workplace.agentruntime.screen;

import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.global.config.CorsProperties;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHandler;
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
 *       거치지 않고 (SecurityConfig 가 이 경로만 permitAll) 핸드셰이크에서 일회용 표로만 인증한다. 표가 없거나 만료·사용됐으면 403.
 *   <li>runner {@code GET /api/v1/agent-runtime/runner/screen/{sessionId}} — 기존 runner 토큰 필터({@code
 *       Bearer rt_})가 인증하고, 핸드셰이크에서 세션의 테넌트·위치가 토큰의 것과 같은지 본다(아니면 403).
 * </ul>
 *
 * <p>두 처리기 모두 텍스트·바이너리를 함께 받으므로 {@link AbstractWebSocketHandler} 를 쓴다(Text/BinaryWebSocketHandler 는
 * 다른 종류가 오면 1003 으로 닫는다).
 */
@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class AgentScreenWebSocketConfig implements WebSocketConfigurer {

  /** 브라우저 경로 — SecurityConfig 의 permitAll 규칙과 같은 값이다. */
  public static final String BROWSER_PATH = "/api/v1/admin/agent-screen";

  /** runner 경로 접두사 — runner 토큰 필터의 경로({@code /api/v1/agent-runtime/runner/}) 아래다. */
  public static final String RUNNER_PATH_PREFIX = "/api/v1/agent-runtime/runner/screen/";

  /** 프레임 크기 상한 — tmux 전체 다시 그리기가 Tomcat 기본 8KB 를 넘어 1009 로 끊기지 않게 64KB. */
  static final int MAX_MESSAGE_BYTES = 64 * 1024;

  private static final String ATTR_SESSION = "agentScreenSessionId";

  private final AgentScreenRelay relay;
  private final AgentScreenTickets tickets;
  private final CorsProperties corsProperties;

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

  /** 거절 — 403 을 적고 false. 상태를 안 적으면 업그레이드 없는 200 이 나간다. */
  private static boolean reject(ServerHttpResponse response) {
    response.setStatusCode(HttpStatus.FORBIDDEN);
    return false;
  }

  /** 브라우저 핸드셰이크 — 쿼리의 표를 꺼내 쓰고(일회용) 그 세션에 아직 브라우저가 없을 때만 받는다. */
  private final class BrowserTicketInterceptor implements HandshakeInterceptor {
    @Override
    public boolean beforeHandshake(
        @NonNull ServerHttpRequest request,
        @NonNull ServerHttpResponse response,
        @NonNull WebSocketHandler wsHandler,
        @NonNull Map<String, Object> attributes) {
      URI uri = request.getURI();
      String ticket = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("ticket");
      Optional<AgentScreenTickets.Claims> claims = tickets.consume(ticket, Instant.now());
      if (claims.isEmpty()
          || !relay.canAttachBrowser(claims.get().sessionId(), claims.get().tenantId())) {
        return reject(response);
      }
      attributes.put(ATTR_SESSION, claims.get().sessionId());
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
   * runner 핸드셰이크 — 필터가 세운 runner 주체(핸드셰이크는 아직 필터 체인 스레드라 SecurityContext 가 남아 있다)로 세션의 테넌트·위치를 견준다.
   */
  private final class RunnerSessionInterceptor implements HandshakeInterceptor {
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
      UUID id;
      try {
        id = UUID.fromString(path.substring(path.lastIndexOf('/') + 1));
      } catch (IllegalArgumentException e) {
        return reject(response);
      }
      if (!relay.canAttachRunner(id, principal.tenantId(), principal.locationId())) {
        return reject(response);
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

  /** 브라우저 소켓 처리기 — 프레임 판정은 중계 레지스트리가 한다. */
  private final class BrowserHandler extends AbstractWebSocketHandler {
    @Override
    public void afterConnectionEstablished(@NonNull WebSocketSession session) {
      raiseLimits(session);
      relay.attachBrowser(sessionIdOf(session), session);
    }

    @Override
    protected void handleTextMessage(
        @NonNull WebSocketSession session, @NonNull TextMessage message) {
      relay.fromBrowserText(sessionIdOf(session), message);
    }

    @Override
    protected void handleBinaryMessage(
        @NonNull WebSocketSession session, @NonNull BinaryMessage message) {
      relay.fromBrowserBinary(sessionIdOf(session), message);
    }

    @Override
    public void afterConnectionClosed(
        @NonNull WebSocketSession session, @NonNull CloseStatus status) {
      relay.browserClosed(sessionIdOf(session), session);
    }
  }

  /** runner 소켓 처리기 — runner 가 보낸 프레임은 그대로 브라우저로 넘긴다. */
  private final class RunnerHandler extends AbstractWebSocketHandler {
    @Override
    public void afterConnectionEstablished(@NonNull WebSocketSession session) {
      raiseLimits(session);
      relay.attachRunner(sessionIdOf(session), session);
    }

    @Override
    protected void handleTextMessage(
        @NonNull WebSocketSession session, @NonNull TextMessage message) {
      relay.fromRunner(sessionIdOf(session), message);
    }

    @Override
    protected void handleBinaryMessage(
        @NonNull WebSocketSession session, @NonNull BinaryMessage message) {
      relay.fromRunner(sessionIdOf(session), message);
    }

    @Override
    public void afterConnectionClosed(
        @NonNull WebSocketSession session, @NonNull CloseStatus status) {
      relay.runnerClosed(sessionIdOf(session), session);
    }
  }
}

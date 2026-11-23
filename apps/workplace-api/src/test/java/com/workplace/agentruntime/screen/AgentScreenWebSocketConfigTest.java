package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.global.config.CorsProperties;
import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.socket.WebSocketHandler;

/**
 * 작업 화면 핸드셰이크가 공유 경로 저장소(DB) 오류를 500 으로 내보내지 않고 403 으로 거절하는지 단위 검증(WP-1978 리뷰 후속) — 브라우저 표 소비와
 * runner 경로 행 조회가 던지는 경우.
 */
class AgentScreenWebSocketConfigTest {

  private AgentScreenRoutes routes;
  private AgentScreenRelay relay;
  private AgentScreenWebSocketConfig config;
  private ServerHttpResponse response;
  private final Map<String, Object> attributes = new HashMap<>();

  @BeforeEach
  void setUp() {
    routes = mock(AgentScreenRoutes.class);
    relay = mock(AgentScreenRelay.class);
    config =
        new AgentScreenWebSocketConfig(
            relay, routes, mock(AgentScreenForwarder.class), mock(CorsProperties.class), "token");
    response = mock(ServerHttpResponse.class);
  }

  @AfterEach
  void tearDown() {
    SecurityContextHolder.clearContext();
  }

  private static ServerHttpRequest request(String uri) {
    ServerHttpRequest request = mock(ServerHttpRequest.class);
    when(request.getURI()).thenReturn(URI.create(uri));
    return request;
  }

  @Test
  void browserHandshake_whenTicketLookupThrows_rejects403() {
    when(routes.consumeTicket(anyString())).thenThrow(new RuntimeException("db down"));

    boolean accepted =
        config.new BrowserTicketInterceptor()
            .beforeHandshake(
                request("ws://localhost/api/v1/admin/agent-screen?ticket=abc"),
                response,
                mock(WebSocketHandler.class),
                attributes);

    assertThat(accepted).isFalse();
    verify(response).setStatusCode(HttpStatus.FORBIDDEN);
    assertThat(attributes).isEmpty();
  }

  @Test
  void runnerHandshake_whenRouteLookupThrows_rejects403() {
    SecurityContextHolder.getContext()
        .setAuthentication(
            new UsernamePasswordAuthenticationToken(new RunnerPrincipal(1L, 3L), null, List.of()));
    when(routes.find(any())).thenThrow(new RuntimeException("db down"));

    boolean accepted =
        config.new RunnerSessionInterceptor()
            .beforeHandshake(
                request(
                    "ws://localhost"
                        + AgentScreenWebSocketConfig.RUNNER_PATH_PREFIX
                        + UUID.randomUUID()),
                response,
                mock(WebSocketHandler.class),
                attributes);

    assertThat(accepted).isFalse();
    verify(response).setStatusCode(HttpStatus.FORBIDDEN);
    assertThat(attributes).isEmpty();
  }
}

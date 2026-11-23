package com.workplace.agentruntime.screen;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.boot.web.server.context.WebServerInitializedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 이 api 파드의 식별과 파드끼리 접속 주소(WP-1978) — 화면의 「주인 파드」를 route 표에 적고, 다른 파드가 내부 WebSocket 을 열 때 쓴다.
 *
 * <p>id 는 기동 때 만든 UUID(재시작하면 새 파드). 주소는 설정 {@code app.agent-screen.pod-address}(운영은 downward API 의
 * 파드 IP) 가 있으면 그것을, 비면 로컬 호스트 주소를 host 로 쓰고, 포트는 웹 서버가 실제로 연 포트(테스트 RANDOM_PORT 대응)를 쓴다.
 */
@Component
public class AgentScreenPod {

  private final String id = UUID.randomUUID().toString();
  private final String host;
  private volatile int port;

  public AgentScreenPod(
      @Value("${app.agent-screen.pod-address:}") String configuredHost,
      @Value("${server.port:8080}") int configuredPort) {
    this.host = configuredHost.isBlank() ? localHost() : configuredHost.trim();
    this.port = configuredPort;
  }

  private static String localHost() {
    try {
      return InetAddress.getLocalHost().getHostAddress();
    } catch (UnknownHostException e) {
      return "127.0.0.1";
    }
  }

  /** 웹 서버가 뜬 뒤 실제 포트를 받는다 — 관리 포트 컨텍스트의 이벤트는 무시한다. */
  @EventListener
  void onWebServerInitialized(WebServerInitializedEvent event) {
    WebServerApplicationContext ctx = event.getApplicationContext();
    if ("management".equals(ctx.getServerNamespace())) {
      return;
    }
    this.port = event.getWebServer().getPort();
  }

  /** 파드 id. */
  public String id() {
    return id;
  }

  /**
   * 다른 파드가 이 파드에 접속할 주소 — {@code <host>:<port>}. IPv6 주소(콜론을 품음)는 URI 에 그대로 넣으면 포트와 섞이므로 {@code
   * [host]:port} 로 감싼다(이미 감싼 값은 그대로).
   */
  public String address() {
    boolean ipv6 = host.indexOf(':') >= 0 && !host.startsWith("[");
    return (ipv6 ? "[" + host + "]" : host) + ":" + port;
  }
}

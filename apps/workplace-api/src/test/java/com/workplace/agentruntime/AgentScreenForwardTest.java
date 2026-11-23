package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_LOCATION;
import static com.workplace.jooq.Tables.AGENT_RUNNER_TOKEN;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AGENT_SCREEN_INPUT;
import static com.workplace.jooq.Tables.AGENT_SCREEN_ROUTE;
import static com.workplace.jooq.Tables.AGENT_SCREEN_SESSION;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.websocket.ContainerProvider;
import jakarta.websocket.DeploymentException;
import jakarta.websocket.WebSocketContainer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.lang.NonNull;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.PingMessage;
import org.springframework.web.socket.PongMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1978 AI 작업 화면 이어 붙이기 통합 테스트 — 화면의 주인 파드가 아닌 파드로 온 브라우저·runner 소켓을 주인 파드의 내부 WebSocket 경로로 넘기는지
 * 본다. 한 서버(RANDOM_PORT)에서 공유 경로 행의 주인 파드 id 를 다른 값으로 바꿔 넘기기 경로를 강제한다 — 주인 주소는 이 서버라 내부 경로로 자기에게
 * 돌아오고, 메모리 짝(Pair)은 이 서버에 있다. 내부 경로의 토큰·위치 검사와 공개 runner 경로의 경로 행 대조도 본다.
 *
 * <p>시드·도우미는 {@link AgentScreenRelayTest} 와 같은 방식(시드 커밋, 끝나면 지움).
 */
class AgentScreenForwardTest extends IntegrationTestBase {

  private static final Duration WAIT = Duration.ofSeconds(10);

  @LocalServerPort int port;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired JwtTokenProvider jwt;

  @Value("${workplace.ai-agent.internal-token}")
  String internalToken;

  private long admin;
  private long member;
  private long l1;
  private long l2;
  private String t1;
  private String t2;
  private long agent;
  private final List<Long> agents = new ArrayList<>();
  private final List<WebSocketSession> sockets = new ArrayList<>();
  private StandardWebSocketClient client;

  @BeforeEach
  void seed() {
    WebSocketContainer container = ContainerProvider.getWebSocketContainer();
    // 테스트 클라이언트도 기본 8KB 상한이라 큰 프레임을 받으려면 올려야 한다(실제 브라우저·runner 는 상한이 크다).
    container.setDefaultMaxBinaryMessageBufferSize(64 * 1024);
    container.setDefaultMaxTextMessageBufferSize(64 * 1024);
    client = new StandardWebSocketClient(container);
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    callInTenant(
        1L,
        () -> {
          admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
          TestFixtures.grantRole(dsl, admin, "ADMIN");
          member = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
          var first =
              locationService.create(
                  admin, new CreateAgentLocationRequest("S1-" + suffix, null, 10));
          l1 = first.location().id();
          t1 = first.plaintextToken();
          var second =
              locationService.create(
                  admin, new CreateAgentLocationRequest("S2-" + suffix, null, 10));
          l2 = second.location().id();
          t2 = second.plaintextToken();
          return null;
        });
    agent = runningAgent();
  }

  /** L1 에서 켜고 runner 가 지금 generation 을 RUNNING 으로 보고한 AI. */
  private long runningAgent() {
    long a =
        callInTenant(
            1L,
            () -> {
              var fx = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
              long id = fx.runningAgent(l1);
              dsl.update(AGENT_RUNTIME_SETTING)
                  .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, AGENT_RUNTIME_SETTING.GENERATION)
                  .set(AGENT_RUNTIME_SETTING.PHASE, "RUNNING")
                  .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(id))
                  .execute();
              return id;
            });
    agents.add(a);
    return a;
  }

  @AfterEach
  void cleanup() {
    sockets.forEach(
        s -> {
          try {
            if (s.isOpen()) s.close();
          } catch (Exception ignored) {
            // 이미 닫힘
          }
        });
    List<Long> users = new ArrayList<>(agents);
    users.add(admin);
    users.add(member);
    // 공유 경로 표는 전역 표(RLS 없음)라 테넌트 컨텍스트 없이 지운다.
    dsl.deleteFrom(AGENT_SCREEN_ROUTE).where(AGENT_SCREEN_ROUTE.AGENT_USER_ID.in(agents)).execute();
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AGENT_SCREEN_INPUT)
              .where(
                  AGENT_SCREEN_INPUT.SESSION_ID.in(
                      dsl.select(AGENT_SCREEN_SESSION.ID)
                          .from(AGENT_SCREEN_SESSION)
                          .where(AGENT_SCREEN_SESSION.AGENT_USER_ID.in(agents))))
              .execute();
          dsl.deleteFrom(AGENT_SCREEN_SESSION)
              .where(AGENT_SCREEN_SESSION.AGENT_USER_ID.in(agents))
              .execute();
          dsl.deleteFrom(AGENT_RUNTIME_SETTING)
              .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.in(agents))
              .execute();
          dsl.deleteFrom(AGENT_RUNNER_TOKEN)
              .where(AGENT_RUNNER_TOKEN.LOCATION_ID.in(l1, l2))
              .execute();
          dsl.deleteFrom(AGENT_LOCATION).where(AGENT_LOCATION.ID.in(l1, l2)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
  }

  // ------------------------------------------------------------------ 도우미

  /**
   * 받은 프레임 — 텍스트는 String, 바이너리는 byte[]. 닫힘은 {@code closed}, 등록 확인은 {@code pong} 으로(소켓마다 새로 만든다).
   */
  private static final class Recorder extends AbstractWebSocketHandler {
    final BlockingQueue<Object> frames = new LinkedBlockingQueue<>();
    final CompletableFuture<CloseStatus> closed = new CompletableFuture<>();
    final CompletableFuture<Void> pong = new CompletableFuture<>();

    @Override
    protected void handlePongMessage(
        @NonNull WebSocketSession session, @NonNull PongMessage message) {
      pong.complete(null);
    }

    @Override
    protected void handleTextMessage(
        @NonNull WebSocketSession session, @NonNull TextMessage message) {
      frames.add(message.getPayload());
    }

    @Override
    protected void handleBinaryMessage(
        @NonNull WebSocketSession session, @NonNull BinaryMessage message) {
      var buf = message.getPayload();
      byte[] b = new byte[buf.remaining()];
      buf.get(b);
      frames.add(b);
    }

    @Override
    public void afterConnectionClosed(
        @NonNull WebSocketSession session, @NonNull CloseStatus status) {
      closed.complete(status);
      // 등록(pong) 전에 닫혔다면 10초 타임아웃 대신 바로 원인을 드러낸다 (이미 pong 을 받았으면 무효)
      pong.completeExceptionally(new IllegalStateException("등록 전에 닫혔다: " + status));
    }

    Object next() throws InterruptedException {
      Object f = frames.poll(WAIT.toSeconds(), TimeUnit.SECONDS);
      assertThat(f).as("프레임이 와야 한다").isNotNull();
      return f;
    }
  }

  /** 관리자(또는 주어진 사람) JWT 로 세션을 연다. */
  private HttpResponse<String> post(long userId, long agentId) throws Exception {
    String token = jwt.generateAccessToken(userId, "u-" + userId, 1L);
    HttpRequest req =
        HttpRequest.newBuilder(
                URI.create(
                    "http://localhost:"
                        + port
                        + "/api/v1/admin/agents/"
                        + agentId
                        + "/screen-sessions"))
            .header("Authorization", "Bearer " + token)
            .POST(HttpRequest.BodyPublishers.noBody())
            .build();
    try (HttpClient http = HttpClient.newHttpClient()) {
      return http.send(req, HttpResponse.BodyHandlers.ofString());
    }
  }

  private JsonNode openSession(long agentId) throws Exception {
    HttpResponse<String> r = post(admin, agentId);
    assertThat(r.statusCode()).as(r.body()).isEqualTo(201);
    return om.readTree(r.body());
  }

  /**
   * 서버가 이 소켓을 등록할 때까지 기다린다. 클라이언트의 101 응답은 서버의 afterConnectionEstablished (등록)보다 먼저 오고, Tomcat 은
   * onOpen 이 끝난 뒤에야 프레임을 읽으므로 ping 에 pong 이 돌아오면 등록이 끝난 것이다.
   */
  private static void awaitRegistered(WebSocketSession s, Recorder rec) throws Exception {
    s.sendMessage(new PingMessage());
    rec.pong.get(WAIT.toSeconds(), TimeUnit.SECONDS);
  }

  /** 핸드셰이크가 403 으로 거절됐음을 단언한다 — 잘못 받아들인 뒤 pong 대기가 실패해도 예외라서 사유까지 본다. */
  private static void assertHandshakeRejected(ThrowingCallable connect) {
    assertThatThrownBy(connect)
        .isInstanceOf(ExecutionException.class)
        .hasRootCauseInstanceOf(DeploymentException.class)
        .hasMessageContaining("[403]");
  }

  private WebSocketSession browser(String ticket, Recorder rec) throws Exception {
    WebSocketSession s =
        client
            .execute(rec, "ws://localhost:" + port + "/api/v1/admin/agent-screen?ticket=" + ticket)
            .get(10, TimeUnit.SECONDS);
    sockets.add(s);
    awaitRegistered(s, rec);
    return s;
  }

  private WebSocketSession runner(String sessionId, String token, Recorder rec) throws Exception {
    WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
    headers.add("Authorization", "Bearer " + token);
    WebSocketSession s =
        client
            .execute(
                rec,
                headers,
                URI.create(
                    "ws://localhost:" + port + "/api/v1/agent-runtime/runner/screen/" + sessionId))
            .get(10, TimeUnit.SECONDS);
    sockets.add(s);
    // runner 등록 전에는 브라우저 프레임이 버려지고 두 번째 runner 도 핸드셰이크에서 403 이 되지 않으므로 등록을 기다린다
    awaitRegistered(s, rec);
    return s;
  }

  /** 열고 브라우저·runner 를 모두 붙인 화면. */
  private record Screen(
      String sessionId,
      WebSocketSession browser,
      Recorder b,
      WebSocketSession runner,
      Recorder r) {}

  private Screen connected(long agentId) throws Exception {
    JsonNode opened = openSession(agentId);
    String id = opened.get("sessionId").asString();
    Recorder b = new Recorder();
    WebSocketSession bs = browser(opened.get("ticket").asString(), b);
    Recorder r = new Recorder();
    WebSocketSession rs = runner(id, t1, r);
    return new Screen(id, bs, b, rs, r);
  }

  private static TextMessage text(String s) {
    return new TextMessage(s);
  }

  /** 공유 경로 행의 주인을 다른 파드로 바꾼다 — 주인 주소는 이 서버라 넘기기가 내부 경로로 자기에게 돌아온다. */
  private void ownedByOtherPod(String sessionId, String ownerAddr) {
    dsl.update(AGENT_SCREEN_ROUTE)
        .set(AGENT_SCREEN_ROUTE.OWNER_POD_ID, "other-pod")
        .set(AGENT_SCREEN_ROUTE.OWNER_ADDR, ownerAddr)
        .where(AGENT_SCREEN_ROUTE.SESSION_ID.eq(UUID.fromString(sessionId)))
        .execute();
  }

  /** 열고 주인을 다른 파드로 바꾼 뒤 브라우저·runner 를 넘기는 경로로 붙인 화면. */
  private Screen forwarded() throws Exception {
    JsonNode opened = openSession(agent);
    String id = opened.get("sessionId").asString();
    ownedByOtherPod(id, "localhost:" + port);
    Recorder b = new Recorder();
    WebSocketSession bs = browser(opened.get("ticket").asString(), b);
    Recorder r = new Recorder();
    WebSocketSession rs = runner(id, t1, r);
    return new Screen(id, bs, b, rs, r);
  }

  /** 내부 경로로 직접 붙는다 — 헤더는 주어진 것만 싣는다(값이 null 이면 뺀다). */
  private WebSocketSession internal(
      String sessionId, String role, String token, Long tenant, Long location, Recorder rec)
      throws Exception {
    WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
    if (token != null) headers.add("X-Internal-Token", token);
    if (tenant != null) headers.add("X-Screen-Tenant", String.valueOf(tenant));
    if (location != null) headers.add("X-Screen-Location", String.valueOf(location));
    WebSocketSession s =
        client
            .execute(
                rec,
                headers,
                URI.create(
                    "ws://localhost:"
                        + port
                        + "/api/v1/internal/agent-screen/"
                        + sessionId
                        + "/"
                        + role))
            .get(10, TimeUnit.SECONDS);
    sockets.add(s);
    awaitRegistered(s, rec);
    return s;
  }

  // ------------------------------------------------------------------ 넘기기

  /** 주인이 다른 파드면 브라우저·runner 모두 넘기는 경로로 붙고 프레임이 양쪽으로 오간다(10KB 바이너리 포함). */
  @Test
  void forward_browserAndRunner_relayFrames() throws Exception {
    Screen s = forwarded();

    byte[] big = new byte[10 * 1024];
    Arrays.fill(big, (byte) 'y');
    big[0] = 0x1b;
    s.runner().sendMessage(new BinaryMessage(big));
    Object got = s.b().next();
    assertThat(got).as(String.valueOf(got)).isInstanceOf(byte[].class);
    assertThat((byte[]) got).isEqualTo(big);

    s.browser().sendMessage(text("{\"type\":\"resize\",\"cols\":120,\"rows\":40}"));
    JsonNode resize = om.readTree((String) s.r().next());
    assertThat(resize.get("type").asString()).isEqualTo("resize");
    assertThat(resize.get("cols").asInt()).isEqualTo(120);
  }

  /** 넘기는 경로의 브라우저가 닫으면 주인 쪽 화면이 닫혀 runner 소켓도 닫히고 세션 행에 「관리자가 화면을 닫았어요」가 남는다. */
  @Test
  void forward_browserClose_closesOwnerSession() throws Exception {
    Screen s = forwarded();

    s.browser().close();

    assertThat(s.r().closed.get(10, TimeUnit.SECONDS)).isNotNull();
    UUID id = UUID.fromString(s.sessionId());
    await()
        .atMost(WAIT)
        .untilAsserted(
            () -> {
              var row =
                  callInTenant(
                      1L,
                      () ->
                          dsl.selectFrom(AGENT_SCREEN_SESSION)
                              .where(AGENT_SCREEN_SESSION.ID.eq(id))
                              .fetchOne());
              assertThat(row.getClosedAt()).isNotNull();
              assertThat(row.getCloseReason()).isEqualTo("관리자가 화면을 닫았어요");
            });
  }

  /** 주인 파드에 닿지 못하면 받은 브라우저 소켓을 1011 로 닫는다(연결 제한 5초 안). */
  @Test
  void forward_ownerUnreachable_closesInbound() throws Exception {
    JsonNode opened = openSession(agent);
    ownedByOtherPod(opened.get("sessionId").asString(), "127.0.0.1:1");
    Recorder b = new Recorder();
    WebSocketSession s =
        client
            .execute(
                b,
                "ws://localhost:"
                    + port
                    + "/api/v1/admin/agent-screen?ticket="
                    + opened.get("ticket").asString())
            .get(10, TimeUnit.SECONDS);
    sockets.add(s);

    CloseStatus status = b.closed.get(6, TimeUnit.SECONDS);

    assertThat(status.getCode()).isEqualTo(CloseStatus.SERVER_ERROR.getCode());
  }

  /**
   * 주인 파드가 넘겨 온 소켓을 거절하면(이미 runner 가 붙은 화면에 두 번째 runner) 받은 소켓을 1008 로 닫는다 — 핸드셰이크는 넘기는 파드가 받았으므로
   * 거절은 닫기 상태로 드러난다. 붙어 있던 runner 는 그대로다.
   */
  @Test
  void forward_ownerRefuses_closesInboundWithPolicyViolation() throws Exception {
    Screen s = forwarded();

    WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
    headers.add("Authorization", "Bearer " + t1);
    Recorder second = new Recorder();
    WebSocketSession extra =
        client
            .execute(
                second,
                headers,
                URI.create(
                    "ws://localhost:"
                        + port
                        + "/api/v1/agent-runtime/runner/screen/"
                        + s.sessionId()))
            .get(10, TimeUnit.SECONDS);
    sockets.add(extra);

    CloseStatus status = second.closed.get(6, TimeUnit.SECONDS);

    assertThat(status.getCode()).isEqualTo(CloseStatus.POLICY_VIOLATION.getCode());
    assertThat(s.runner().isOpen()).isTrue();
  }

  /**
   * 넘기던 파드가 멈추며 위쪽 다리를 파드 멈춤 상태(4001)로 닫으면 주인은 「관리자가 화면을 닫았어요」 대신 서버 멈춤 까닭을 남긴다 — 내부 경로로 직접 붙어 그
   * 상태로 닫아 본다.
   */
  @Test
  void internal_podShutdownClose_recordsShutdownReason() throws Exception {
    JsonNode opened = openSession(agent);
    String id = opened.get("sessionId").asString();
    WebSocketSession b = internal(id, "browser", internalToken, 1L, null, new Recorder());

    b.close(new CloseStatus(4001, "pod shutdown"));

    UUID sid = UUID.fromString(id);
    await()
        .atMost(WAIT)
        .untilAsserted(
            () -> {
              var row =
                  callInTenant(
                      1L,
                      () ->
                          dsl.selectFrom(AGENT_SCREEN_SESSION)
                              .where(AGENT_SCREEN_SESSION.ID.eq(sid))
                              .fetchOne());
              assertThat(row.getClosedAt()).isNotNull();
              assertThat(row.getCloseReason()).isEqualTo("서버가 멈춰 닫았어요");
            });
  }

  /** 다른 위치의 runner 토큰은 공개 runner 경로에서 경로 행과 견줘 넘기기 전에 403 — 같은 위치 토큰은 넘겨 붙는다. */
  @Test
  void runner_routeLocationMismatch_rejected() throws Exception {
    JsonNode opened = openSession(agent);
    String id = opened.get("sessionId").asString();
    ownedByOtherPod(id, "localhost:" + port);
    browser(opened.get("ticket").asString(), new Recorder());

    assertHandshakeRejected(() -> runner(id, t2, new Recorder()));
    assertThat(runner(id, t1, new Recorder()).isOpen()).isTrue();
  }

  // ------------------------------------------------------------------ 내부 경로

  /** 내부 경로는 내부 토큰이 없거나 틀리면 403 — 맞는 토큰이면 붙는다(거절 까닭이 토큰이었음을 보인다). */
  @Test
  void internal_rejectsBadToken() throws Exception {
    String id = openSession(agent).get("sessionId").asString();

    assertHandshakeRejected(() -> internal(id, "browser", null, 1L, null, new Recorder()));
    assertHandshakeRejected(
        () -> internal(id, "browser", internalToken + "x", 1L, null, new Recorder()));
    assertThat(internal(id, "browser", internalToken, 1L, null, new Recorder()).isOpen()).isTrue();
  }

  /** 내부 경로의 runner 는 헤더의 위치가 세션의 위치와 다르면 403 — 같은 위치면 붙는다. */
  @Test
  void internal_rejectsLocationMismatch() throws Exception {
    JsonNode opened = openSession(agent);
    String id = opened.get("sessionId").asString();
    browser(opened.get("ticket").asString(), new Recorder());

    assertHandshakeRejected(() -> internal(id, "runner", internalToken, 1L, l2, new Recorder()));
    assertThat(internal(id, "runner", internalToken, 1L, l1, new Recorder()).isOpen()).isTrue();
  }
}

package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_LOCATION;
import static com.workplace.jooq.Tables.AGENT_RUNNER_TOKEN;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AGENT_SCREEN_INPUT;
import static com.workplace.jooq.Tables.AGENT_SCREEN_SESSION;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.screen.AgentScreenService;
import com.workplace.agentruntime.screen.AgentScreenTickets;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.websocket.ContainerProvider;
import jakarta.websocket.WebSocketContainer;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.lang.NonNull;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

/**
 * WP-1277 AI 작업 화면 통합 테스트 — 실제 서버(RANDOM_PORT)에 실제 WebSocket 으로 붙는다. 세션 열기 권한·상태 확인, 일회용
 * 표(재사용·만료·없음 거절), runner 위치 확인, 양방향 중계(8KB 넘는 프레임 포함), 입력 허용 전 키 입력 버림·허용 뒤 넘김과 기록, 입력 독점, 한쪽 닫힘
 * 전파를 본다.
 *
 * <p>서버의 WebSocket 스레드는 자기 커넥션으로 DB 를 읽으므로 테스트 트랜잭션을 쓰지 않고 시드를 커밋한다 — 끝나면 {@code cleanupInTenant} 로
 * 지운다. 위치 2개(L1·L2)와 L1 에서 RUNNING 으로 보고된 AI 하나.
 */
class AgentScreenRelayTest extends IntegrationTestBase {

  private static final Duration WAIT = Duration.ofSeconds(10);

  @LocalServerPort int port;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired JwtTokenProvider jwt;
  @Autowired AgentScreenTickets tickets;
  @Autowired AgentScreenService screenService;

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

  /** 받은 프레임 — 텍스트는 String, 바이너리는 byte[]. 닫힘은 {@code closed} 로. */
  private static final class Recorder extends AbstractWebSocketHandler {
    final BlockingQueue<Object> frames = new LinkedBlockingQueue<>();
    final CompletableFuture<CloseStatus> closed = new CompletableFuture<>();

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

  private WebSocketSession browser(String ticket, Recorder rec) throws Exception {
    WebSocketSession s =
        client
            .execute(rec, "ws://localhost:" + port + "/api/v1/admin/agent-screen?ticket=" + ticket)
            .get(10, TimeUnit.SECONDS);
    sockets.add(s);
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
    String id = opened.get("sessionId").asText();
    Recorder b = new Recorder();
    WebSocketSession bs = browser(opened.get("ticket").asText(), b);
    Recorder r = new Recorder();
    WebSocketSession rs = runner(id, t1, r);
    return new Screen(id, bs, b, rs, r);
  }

  /** 관리자가 남긴 그 종류 감사 행 수. */
  private int auditCount(String action) {
    return callInTenant(
        1L,
        () ->
            dsl.fetchCount(
                AUDIT_LOG, AUDIT_LOG.ACTION_TYPE.eq(action).and(AUDIT_LOG.USER_ID.eq(admin))));
  }

  private static TextMessage text(String s) {
    return new TextMessage(s);
  }

  // ------------------------------------------------------------------ 세션 열기

  /** 관리자가 아닌 구성원은 403. */
  @Test
  void open_whenNotAdmin_returns403() throws Exception {
    assertThat(post(member, agent).statusCode()).isEqualTo(403);
  }

  /** 꺼진 AI 는 409(한국어 안내). */
  @Test
  void open_whenAgentNotRunning_returns409() throws Exception {
    long off =
        callInTenant(
            1L, () -> new AgentRuntimeTestFixtures(dsl, om, settingService, admin).newAgent(l1));
    agents.add(off);
    HttpResponse<String> r = post(admin, off);
    assertThat(r.statusCode()).isEqualTo(409);
    assertThat(r.body()).contains("실행 중인 AI 만 작업 화면을 볼 수 있어요");
  }

  /** AI 하나에 열린 화면은 3개까지 — 4번째는 409. 성공 응답에는 sessionId·ticket·expiresAt 이 있고 세션 행·감사가 남는다. */
  @Test
  void open_whenThreeAlreadyOpen_returns409() throws Exception {
    JsonNode first = openSession(agent);
    assertThat(first.get("ticket").asText()).hasSizeGreaterThanOrEqualTo(43);
    assertThat(first.get("expiresAt").asText()).isNotBlank();
    openSession(agent);
    openSession(agent);
    HttpResponse<String> r = post(admin, agent);
    assertThat(r.statusCode()).isEqualTo(409);
    assertThat(r.body()).contains("이 AI 의 작업 화면이 이미 3개 열려 있어요");
    UUID id = UUID.fromString(first.get("sessionId").asText());
    callInTenant(
        1L,
        () -> {
          var row =
              dsl.selectFrom(AGENT_SCREEN_SESSION).where(AGENT_SCREEN_SESSION.ID.eq(id)).fetchOne();
          assertThat(row.getLocationId()).isEqualTo(l1);
          assertThat(row.getOpenedBy()).isEqualTo(admin);
          assertThat(
                  dsl.fetchCount(
                      AUDIT_LOG,
                      AUDIT_LOG
                          .ACTION_TYPE
                          .eq("AGENT_SCREEN_OPENED")
                          .and(AUDIT_LOG.USER_ID.eq(admin))))
              .isEqualTo(3);
          return null;
        });
  }

  // ------------------------------------------------------------------ 표

  /** 표 없이 붙으면 거절. */
  @Test
  void browserSocket_whenNoTicket_isRejected() {
    assertThatThrownBy(
            () ->
                client
                    .execute(
                        new Recorder(), "ws://localhost:" + port + "/api/v1/admin/agent-screen")
                    .get(10, TimeUnit.SECONDS))
        .isInstanceOf(Exception.class);
  }

  /** 표는 한 번만 — 같은 표로 다시 붙으면 거절. */
  @Test
  void browserSocket_whenTicketReused_isRejected() throws Exception {
    JsonNode opened = openSession(agent);
    String ticket = opened.get("ticket").asText();
    browser(ticket, new Recorder());
    assertThatThrownBy(() -> browser(ticket, new Recorder())).isInstanceOf(Exception.class);
  }

  /** 만료된 표는 거절 — 같은 세션의 유효한 표는 그대로 쓸 수 있다. */
  @Test
  void browserSocket_whenTicketExpired_isRejected() throws Exception {
    JsonNode opened = openSession(agent);
    UUID id = UUID.fromString(opened.get("sessionId").asText());
    String expired =
        tickets.issue(new AgentScreenTickets.Claims(id, 1L, admin, Instant.now().minusSeconds(1)));
    assertThatThrownBy(() -> browser(expired, new Recorder())).isInstanceOf(Exception.class);
    assertThat(browser(opened.get("ticket").asText(), new Recorder()).isOpen()).isTrue();
  }

  // ------------------------------------------------------------------ runner

  /** 다른 위치의 유효한 runner 토큰으로는 붙지 못하고, 그 위치 runner 는 붙는다. 브라우저가 붙으면 그 위치 runner 에게 SSE 가 간다. */
  @Test
  void runnerSocket_whenOtherLocation_isRejected() throws Exception {
    JsonNode opened = openSession(agent);
    String id = opened.get("sessionId").asText();
    // L1 runner 의 변경 스트림 — 브라우저가 붙으면 agent-runtime.screen 이 와야 한다.
    CompletableFuture<String> sse = new CompletableFuture<>();
    HttpClient http = HttpClient.newHttpClient();
    HttpRequest req =
        HttpRequest.newBuilder(
                URI.create("http://localhost:" + port + "/api/v1/agent-runtime/runner/events"))
            .header("Authorization", "Bearer " + t1)
            .GET()
            .build();
    HttpResponse<java.io.InputStream> stream =
        http.send(req, HttpResponse.BodyHandlers.ofInputStream());
    Thread reader =
        new Thread(
            () -> {
              try (BufferedReader br =
                  new BufferedReader(
                      new InputStreamReader(stream.body(), StandardCharsets.UTF_8))) {
                String line;
                boolean screen = false;
                while ((line = br.readLine()) != null) {
                  if (line.equals("event:agent-runtime.screen")) screen = true;
                  else if (screen && line.startsWith("data:")) {
                    sse.complete(line.substring(5));
                    return;
                  }
                }
              } catch (Exception e) {
                sse.completeExceptionally(e);
              }
            });
    reader.setDaemon(true);
    reader.start();
    try {
      // SSE 가 등록될 시간을 준 뒤 브라우저를 붙인다.
      Thread.sleep(300);
      browser(opened.get("ticket").asText(), new Recorder());
      JsonNode event = om.readTree(sse.get(10, TimeUnit.SECONDS));
      assertThat(event.get("sessionId").asText()).isEqualTo(id);
      assertThat(event.get("agentUserId").asLong()).isEqualTo(agent);

      assertThatThrownBy(() -> runner(id, t2, new Recorder())).isInstanceOf(Exception.class);
      assertThat(runner(id, t1, new Recorder()).isOpen()).isTrue();
      // 세션당 runner 하나 — 두 번째는 거절.
      assertThatThrownBy(() -> runner(id, t1, new Recorder())).isInstanceOf(Exception.class);
    } finally {
      stream.body().close();
      http.shutdownNow();
    }
  }

  // ------------------------------------------------------------------ 중계

  /** runner → 브라우저: 8KB 넘는 바이너리·텍스트 그대로. 브라우저 → runner: resize·window 는 넘기고 모르는 종류는 버린다. */
  @Test
  void relay_forwardsBothDirections_includingFramesOver8Kb() throws Exception {
    Screen s = connected(agent);
    byte[] big = new byte[20 * 1024];
    Arrays.fill(big, (byte) 'x');
    big[0] = 0x1b;
    s.runner().sendMessage(new BinaryMessage(big));
    Object got = s.b().next();
    assertThat(got).as(String.valueOf(got)).isInstanceOf(byte[].class);
    assertThat((byte[]) got).isEqualTo(big);
    String windows =
        "{\"type\":\"windows\",\"items\":[{\"index\":0,\"name\":\"a\",\"active\":true}]}";
    s.runner().sendMessage(text(windows));
    assertThat(s.b().next()).isEqualTo(windows);

    s.browser().sendMessage(text("{\"type\":\"bogus\"}"));
    s.browser().sendMessage(text("{\"type\":\"resize\",\"cols\":120,\"rows\":40}"));
    assertThat(om.readTree((String) s.r().next()).get("type").asText()).isEqualTo("resize");
    s.browser().sendMessage(text("{\"type\":\"window\",\"index\":1}"));
    assertThat(om.readTree((String) s.r().next()).get("index").asInt()).isEqualTo(1);
  }

  /**
   * 입력은 runner 가 켰다고 알린 뒤에만 열린다 — 그 전(브라우저가 켜 달라고 한 뒤 포함) 키 입력은 버리고 감사도 없다. 확인 뒤에는 넘기며 기록(제어 문자
   * 표기)·세션 행·감사에 남기고, runner 가 껐다고 알리면 다시 버린다.
   */
  @Test
  void browserBinary_isDroppedUntilRunnerConfirmsInput_thenForwardedAndRecorded() throws Exception {
    Screen s = connected(agent);
    s.browser().sendMessage(new BinaryMessage("rm -rf /".getBytes(StandardCharsets.UTF_8)));
    s.browser().sendMessage(text("{\"type\":\"resize\",\"cols\":80,\"rows\":24}"));
    assertThat(s.r().next()).isInstanceOf(String.class); // 키 입력이 아니라 resize 가 먼저 온다

    // 브라우저가 켜 달라고 해도 runner 가 켰다고 알리기 전에는 여전히 버린다.
    s.browser().sendMessage(text("{\"type\":\"input\",\"enabled\":true}"));
    assertThat(om.readTree((String) s.r().next()).get("enabled").asBoolean()).isTrue();
    byte[] keys = "ls\r\u001b".getBytes(StandardCharsets.UTF_8);
    s.browser().sendMessage(new BinaryMessage("early".getBytes(StandardCharsets.UTF_8)));
    s.browser().sendMessage(text("{\"type\":\"window\",\"index\":2}"));
    assertThat(s.r().next()).isInstanceOf(String.class);
    assertThat(auditCount("AGENT_SCREEN_INPUT_ENABLED")).isZero();

    // runner 가 켰다고 알리면 브라우저로 넘기고, 그 뒤 키 입력은 넘긴다.
    String confirmed = "{\"type\":\"input\",\"enabled\":true,\"allowed\":true}";
    s.runner().sendMessage(text(confirmed));
    assertThat(s.b().next()).isEqualTo(confirmed);
    s.browser().sendMessage(new BinaryMessage(keys));
    assertThat((byte[]) s.r().next()).isEqualTo(keys);

    UUID id = UUID.fromString(s.sessionId());
    await()
        .atMost(WAIT)
        .untilAsserted(
            () ->
                assertThat(
                        callInTenant(
                            1L,
                            () ->
                                dsl.select(AGENT_SCREEN_INPUT.DATA)
                                    .from(AGENT_SCREEN_INPUT)
                                    .where(AGENT_SCREEN_INPUT.SESSION_ID.eq(id))
                                    .fetch(AGENT_SCREEN_INPUT.DATA)))
                    .containsExactly("ls\\x0d\\x1b"));
    callInTenant(
        1L,
        () -> {
          var row =
              dsl.selectFrom(AGENT_SCREEN_SESSION).where(AGENT_SCREEN_SESSION.ID.eq(id)).fetchOne();
          assertThat(row.getInputEnabledBy()).isEqualTo(admin);
          assertThat(row.getInputEnabledAt()).isNotNull();
          assertThat(
                  dsl.fetchCount(
                      AUDIT_LOG,
                      AUDIT_LOG
                          .ACTION_TYPE
                          .eq("AGENT_SCREEN_INPUT_ENABLED")
                          .and(AUDIT_LOG.USER_ID.eq(admin))))
              .isEqualTo(1);
          return null;
        });

    // runner 가 꺼졌다고 알리면 키 입력은 또 버린다.
    s.runner().sendMessage(text("{\"type\":\"input\",\"enabled\":false,\"allowed\":true}"));
    s.b().next();
    s.browser().sendMessage(new BinaryMessage(keys));
    s.browser().sendMessage(text("{\"type\":\"window\",\"index\":0}"));
    assertThat(s.r().next()).isInstanceOf(String.class);
  }

  /** 같은 AI 의 다른 화면이 입력 중이면 두 번째 화면은 입력을 켜지 못하고 오류를 받는다(runner 에도 가지 않는다). */
  @Test
  void inputEnable_whenAnotherSessionHasInput_isRefused() throws Exception {
    Screen first = connected(agent);
    Screen second = connected(agent);
    first.browser().sendMessage(text("{\"type\":\"input\",\"enabled\":true}"));
    first.r().next();
    first.runner().sendMessage(text("{\"type\":\"input\",\"enabled\":true,\"allowed\":true}"));
    first.b().next();

    second.browser().sendMessage(text("{\"type\":\"input\",\"enabled\":true}"));
    JsonNode err = om.readTree((String) second.b().next());
    assertThat(err.get("type").asText()).isEqualTo("error");
    assertThat(err.get("message").asText()).isEqualTo("다른 관리자가 이미 입력 중이에요");
    second.browser().sendMessage(text("{\"type\":\"resize\",\"cols\":1,\"rows\":1}"));
    assertThat(om.readTree((String) second.r().next()).get("type").asText()).isEqualTo("resize");
  }

  // ------------------------------------------------------------------ 닫기

  /** 브라우저가 닫으면 runner 도 닫히고 세션 행에 닫힌 때·까닭이 남는다. */
  @Test
  void close_whenBrowserCloses_closesRunnerAndRecordsClosedAt() throws Exception {
    Screen s = connected(agent);
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

  /** runner 가 닫으면 브라우저는 끝남 상태를 받고 닫힌다. */
  @Test
  void close_whenRunnerCloses_notifiesAndClosesBrowser() throws Exception {
    Screen s = connected(agent);
    s.runner().close();
    JsonNode status = om.readTree((String) s.b().next());
    assertThat(status.get("type").asText()).isEqualTo("status");
    assertThat(status.get("state").asText()).isEqualTo("ended");
    assertThat(s.b().closed.get(10, TimeUnit.SECONDS)).isNotNull();
  }

  /** 남은 열린 행 정리는 최대 수명(4시간)이 지난 행만 닫는다 — 롤링 배포 중 새 파드가 옛 파드에서 아직 살아 있는 세션의 기록을 닫지 않게. */
  @Test
  void closeStaleSessions_closesOnlyRowsOlderThanMaxLifetime() {
    UUID old = UUID.randomUUID();
    UUID live = UUID.randomUUID();
    callInTenant(
        1L,
        () -> {
          for (var row :
              List.of(
                  new Object[] {old, OffsetDateTime.now().minusHours(5)},
                  new Object[] {live, OffsetDateTime.now().minusMinutes(10)})) {
            dsl.insertInto(AGENT_SCREEN_SESSION)
                .set(AGENT_SCREEN_SESSION.ID, (UUID) row[0])
                .set(AGENT_SCREEN_SESSION.AGENT_USER_ID, agent)
                .set(AGENT_SCREEN_SESSION.OPENED_AT, (OffsetDateTime) row[1])
                .execute();
          }
          return null;
        });
    screenService.closeStaleSessions();
    callInTenant(
        1L,
        () -> {
          assertThat(
                  dsl.selectFrom(AGENT_SCREEN_SESSION)
                      .where(AGENT_SCREEN_SESSION.ID.eq(old))
                      .fetchOne()
                      .getClosedAt())
              .isNotNull();
          assertThat(
                  dsl.selectFrom(AGENT_SCREEN_SESSION)
                      .where(AGENT_SCREEN_SESSION.ID.eq(live))
                      .fetchOne()
                      .getClosedAt())
              .isNull();
          return null;
        });
  }
}

package com.workplace.global.realtime.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.relay.RelayTestSupport.Pod;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 두 파드 시뮬레이션(WP-1973 Task 3) — 컨텍스트가 파드 A, 새로 만든 레지스트리+전용 중계가 파드 B 로서, A 의 발행이 PostgreSQL NOTIFY
 * LISTEN 경로를 실제로 건너 B 의 emitter 까지 도착하는지 보고 확인한다.
 *
 * <p>수신자 등록은 테스트마다 컨텍스트 배선을 다시 받는다({@code SseEventRelayTransportTest} 가 수신자를 자기 것으로 바꿔 뒀을 수 있어 — 공유
 * 컨텍스트). 캡처는 {@code SseEmitterCapture} 가 보낸 SSE 프레임을 그대로 담는다.
 */
@TestPropertySource(properties = "app.realtime.relay.enabled=true")
class SsePodRelayIntegrationTest extends IntegrationTestBase {

  /** 파드 A(컨텍스트) 레지스트리 — fanOut 은 여기서만 발행한다(파드 B 는 받기만 한다). */
  @Autowired private SseRegistry podARegistry;

  /** 파드 A(컨텍스트) runner 레지스트리 — runner 발행(send·closeAll)도 여기서만 한다(파드 B 는 받기만 한다). */
  @Autowired private RunnerSseRegistry podARunnerRegistry;

  /** 파드 A 중계 — 8KB 아웃박스 경로 검증에 직접 publish 로 쓴다. */
  @Autowired private SseEventRelay podARelay;

  /** 컨텍스트 배선 — 매 테스트 시작에 다시 등록해 앞 테스트가 남긴 수신자를 되돌린다(공유 컨텍스트). */
  @Autowired private RelayLocalDispatcher dispatcher;

  /** 파드 B — 매 테스트 새로 만들어 리스너·커넥션이 테스트마다 끊어지지 않게. */
  private PostgresSseEventRelay podBRelay;

  private Pod podB;

  /** 파드 A 의 emitter 캡처 — 같은 파드 안에서도 중계 경로를 지나 받는지 확인하는 데 쓴다. */
  private final List<ServerSentEvent<String>> receivedA = new CopyOnWriteArrayList<>();

  /** JDBC URL — 파드 B·스니퍼가 쓰는 컨테이너 DB 주소(컨텍스트와 같은 하나의 테스트 DB). */
  private final String jdbcUrl = PostgresTestContainer.INSTANCE.getJdbcUrl();

  @BeforeEach
  void 파드_배선을_다시_받고_파드_B를_준비한다() {
    dispatcher.register(); // 공유 컨텍스트의 수신자를 배선으로 되돌린다(수신 등록은 시작 시점만 맞으면 유실 없음)
    // 등록은 더 이상 기다리지 않으므로, 발행하는 테스트가 파드 A 의 첫 LISTEN 전에 내보내 이벤트를 놓치지 않게 스스로 기다린다(WP-1973 리뷰 3차).
    if (podARelay instanceof PostgresSseEventRelay podAPostgres) podAPostgres.awaitFirstListen();
    podB = RelayTestSupport.newPod(jdbcUrl, "app_tenant", "app_tenant");
    podBRelay = (PostgresSseEventRelay) podB.relay();
  }

  @AfterEach
  void 파드와_아웃박스를_정리한다() {
    RelayTestSupport.close(podB); // 수동으로 만든 중계의 리스너 스레드·커넥션을 닫는다(테스트 커넥션 누수 방지)
    baseDsl.execute("DELETE FROM sse_relay_event"); // 공유 DB 에 아웃박스 행을 남기지 않는다(닫고 난 뒤 삭제)
  }

  /** 파드 A 의 fanOut 이 파드 B 의 유저 연결에 도착한다 — 파드 사이 중계의 기본 계약. */
  @Test
  void 파드_B가_파드_A의_이벤트를_받는다() {
    long uid = 910001L;
    RelayTestSupport.registerCaptured(podB, uid);

    podARegistry.fanOut(Set.of(uid), "notify.created", Map.of("type", "ISSUE"));

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () ->
                assertThat(podB.received())
                    .as("파드 B 의 유저 %d 연결에 이벤트가 도착한다", uid)
                    .anySatisfy(
                        e -> {
                          assertThat(e.event()).isEqualTo("notify.created");
                          assertThat(e.data()).contains("\"type\":\"ISSUE\"");
                        }));
  }

  /** 파드 A 도 같은 경로로 받는다 — fanOut 은 로컬 직행이 없고(발행→NOTIFY→수신→전달), 로컬 emitter 도 그 경로를 지나 받는다. */
  @Test
  void 파드_A도_같은_경로로_받는다() {
    long uid = 910002L;
    RelayTestSupport.registerCaptured(podARegistry, receivedA, uid);
    RelayTestSupport.registerCaptured(podB, uid);

    podARegistry.fanOut(Set.of(uid), "notify.created", Map.of("type", "ISSUE"));

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () -> {
              assertThat(receivedA)
                  .as("파드 A 의 로컬 emitter 도 중계 경로를 지나 받는다")
                  .anySatisfy(e -> assertThat(e.event()).isEqualTo("notify.created"));
              assertThat(podB.received())
                  .as("파드 B 도 같은 이벤트를 받는다")
                  .anySatisfy(e -> assertThat(e.event()).isEqualTo("notify.created"));
            });
  }

  /** 홈 채팅 답변 이벤트도 파드 사이로 간다 — 도메인별 이벤트 이름이 아니라 공통 경로를 쓰므로 payload 필드까지 그대로다. */
  @Test
  void 홈_채팅_답변_이벤트가_파드_사이로_간다() {
    long uid = 910003L;
    RelayTestSupport.registerCaptured(podB, uid);

    podARegistry.fanOut(
        Set.of(uid), "home.chat.delta", Map.of("correlationId", "corr-7", "sessionId", "sess-7"));

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () ->
                assertThat(podB.received())
                    .as("home.chat.delta 도 파드 B 에 payload 그대로 도착한다")
                    .anySatisfy(
                        e -> {
                          assertThat(e.event()).isEqualTo("home.chat.delta");
                          assertThat(e.data()).contains("\"correlationId\":\"corr-7\"");
                          assertThat(e.data()).contains("\"sessionId\":\"sess-7\"");
                        }));
  }

  /**
   * 정지 멤버의 닫힘 신호가 모든 파드에서 적용된다(WP-420·WP-1973) — 파드 A 에서 {@code closeAll} 을 불러도 발행 파드가 아닌 파드 B 의 같은
   * 유저 연결까지 emitter 와 같은 방식으로 닫혀야 한다(정지 멤버가 다른 파드에서 스트림을 유지하지 못하게 하는 보안 계약).
   */
  @Test
  void 정지_멤버_닫힘이_다른_파드에서_적용된다() {
    long uid = 910007L;
    // onCompletion 플래그 — emitter.complete() 가 실제로 불렸는지 캡처(받은 프레임으론 닫힘을 알 수 없다).
    AtomicBoolean 파드B_닫힘 = new AtomicBoolean();
    SseEmitter emitterB = RelayTestSupport.registerCaptured(podB, uid);
    emitterB.onCompletion(() -> 파드B_닫힘.set(true));
    AtomicBoolean 파드A_닫힘 = new AtomicBoolean();
    SseEmitter emitterA = RelayTestSupport.registerCaptured(podARegistry, receivedA, uid);
    emitterA.onCompletion(() -> 파드A_닫힘.set(true));

    podARegistry.closeAll(uid);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () -> {
              assertThat(파드A_닫힘.get()).as("발행 파드(A) 의 로컬 연결도 닫힌다").isTrue();
              assertThat(파드B_닫힘.get()).as("다른 파드(B) 의 같은 유저 연결도 닫힌다").isTrue();
            });
  }

  /** runner 이벤트도 파드 사이로 간다 — send 는 target runner·키 [테넌트, 위치] 로 발행하고, 수신 파드는 그 키의 연결에만 전달한다. */
  @Test
  void runner_이벤트가_파드_사이로_간다() {
    long tenantId = 1L;
    long locationId = 910008L;
    RelayTestSupport.registerRunnerCaptured(podB, tenantId, locationId);

    podARunnerRegistry.send(
        tenantId, locationId, "runner.location.updated", Map.of("status", "IDLE"));

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () ->
                assertThat(podB.received())
                    .as("파드 B 의 (테넌트, 위치) 연결에 runner 이벤트가 도착한다")
                    .anySatisfy(
                        e -> {
                          assertThat(e.event()).isEqualTo("runner.location.updated");
                          assertThat(e.data()).contains("\"status\":\"IDLE\"");
                        }));
  }

  /** runner 닫힘 신호도 파드 사이로 간다 — closeAll(테넌트, 위치) 이 다른 파드의 그 위치 연결을 닫는다(토큰 재발급·위치 삭제 뒤). */
  @Test
  void runner_닫힘_신호가_파드_사이로_간다() {
    long tenantId = 1L;
    long locationId = 910009L;
    AtomicBoolean 닫힘 = new AtomicBoolean();
    SseEmitter emitterB = RelayTestSupport.registerRunnerCaptured(podB, tenantId, locationId);
    emitterB.onCompletion(() -> 닫힘.set(true));

    podARunnerRegistry.closeAll(tenantId, locationId);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(닫힘.get()).as("파드 B 의 그 위치 연결이 닫힌다").isTrue());
  }

  /** 같은 파드에서 연달아 보낸 이벤트는 순서대로 도착한다 — 단일 NOTIFY 채널이 발행 순서를 보존한다(스펙 — 채널 하나인 이유). */
  @Test
  void 같은_파드에서_보낸_이벤트는_순서대로_도착한다() {
    long uid = 910004L;
    RelayTestSupport.registerCaptured(podB, uid);

    for (int seq = 1; seq <= 3; seq++) {
      podARegistry.fanOut(Set.of(uid), "seq.check", Map.of("seq", seq));
    }

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(파드B_이벤트("seq.check")).as("3개가 모두 도착한다").hasSize(3));
    List<ServerSentEvent<String>> 도착 = 파드B_이벤트("seq.check");
    assertThat(도착.get(0).data()).contains("\"seq\":1");
    assertThat(도착.get(1).data()).contains("\"seq\":2");
    assertThat(도착.get(2).data()).contains("\"seq\":3");
  }

  /**
   * 리스너가 강제 종료된 뒤 재연결하고 이벤트를 계속 받는다 — 재연결 대기 동안 첫 이벤트는 놓쳐도 된다(재생 버퍼 없음 — 스펙 계약), 이후 이벤트는 끊김 없이 도착해야
   * 한다.
   */
  @Test
  void 리스너가_재연결한_뒤_이벤트가_도착한다() {
    long uid = 910005L;
    RelayTestSupport.registerCaptured(podB, uid);

    // 리스너가 실제로 LISTEN 에 성공한 뒤에 끊어야 재연결 경로를 겨눌 수 있다.
    await().atMost(Duration.ofSeconds(5)).until(() -> podBRelay.listenerBackendPid() > 0);
    long 죽일_백엔드 = podBRelay.listenerBackendPid();

    // 슈퍼유저로 강제 종료한다 — 같은 롤의 세션 종료는 권한이 없어 거부될 수 있다(테스트 전용 슈퍼유저).
    try (Connection 슈퍼 = DriverManager.getConnection(jdbcUrl, "app", "app");
        Statement st = 슈퍼.createStatement()) {
      st.execute("SELECT pg_terminate_backend(" + 죽일_백엔드 + ")");
    } catch (Exception e) {
      throw new IllegalStateException("리스너 세션 강제 종료에 실패했다", e);
    }

    // 끊긴 리스너가 자체적으로 인지한다(새 pid 로 바뀜) — 그 전의 발행은 재연결까지 놓칠 수 있다.
    await().atMost(Duration.ofSeconds(10)).until(() -> podBRelay.listenerBackendPid() != 죽일_백엔드);

    // 재연결 후 이벤트는 도착해야 한다 — 놓친 첫 발행은 허용하므로 도착할 때까지 반복 발행한다(재생 없음 — 스펙 계약).
    await()
        .atMost(Duration.ofSeconds(15))
        .pollInterval(Duration.ofMillis(500))
        .untilAsserted(
            () -> {
              podARegistry.fanOut(Set.of(uid), "after.reconnect", Map.of("n", System.nanoTime()));
              assertThat(podB.received())
                  .as("재연결 이후의 이벤트는 도착한다")
                  .anySatisfy(e -> assertThat(e.event()).isEqualTo("after.reconnect"));
            });
  }

  /**
   * 채널 계약이 실제로 지켜진다 — 스니퍼 연결이 {@code wp_sse_relay} 채널을 듣고, 8KB 발행이 아웃박스 행 번호({@code #id}) 통지로 오며,
   * 파드 B 에는 발행한 payload 그대로 도착한다(통지 값 ≠ payload — 표가 대신 받는다).
   */
  @Test
  void 큰_페이로드는_wp_sse_relay_채널에_ID_통지로_파드에_도착한다() {
    long uid = 910006L;
    RelayTestSupport.registerCaptured(podB, uid);
    RelayMessage 큰_발행 =
        new RelayMessage(
            RelayMessage.TARGET_USER, "notify.created", "x".repeat(8 * 1024), "[" + uid + "]");
    assertThat(큰_발행.needsOutbox()).as("8KB 는 아웃박스 대상이다").isTrue();

    try (Connection 스니퍼 = DriverManager.getConnection(jdbcUrl, "app_tenant", "app_tenant")) {
      스니퍼.setAutoCommit(true);
      try (Statement st = 스니퍼.createStatement()) {
        st.execute("LISTEN wp_sse_relay"); // 채널 이름을 직접 듣는다 — 리스너 구현과 무관한 제3의 관찰자
      }
      long 이전행 = outboxCount();

      podARelay.publish(큰_발행);

      // 발행은 전용 스레드/큐라 아웃박스 행이 조금 늦는다(WP-1973 리뷰 1) — 행이 남을 때까지 기다린다.
      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(() -> assertThat(outboxCount()).as("아웃박스에 행이 하나 남는다").isEqualTo(이전행 + 1));
      PGNotification 통지 = 다음_통지(스니퍼);
      assertThat(통지.getName()).as("채널은 wp_sse_relay 다").isEqualTo("wp_sse_relay");
      assertThat(통지.getParameter()).as("통지 값은 아웃박스 행 번호(#id) 다").matches("#\\d+");

      // 파드 B 에는 통지 값(#id) 이 아니라 발행 payload 그대로 도착한다.
      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(
              () ->
                  assertThat(podB.received())
                      .as("파드 B 에 8KB payload 그대로 도착한다")
                      .anySatisfy(
                          e -> {
                            assertThat(e.event()).isEqualTo("notify.created");
                            assertThat(e.data()).isEqualTo("x".repeat(8 * 1024));
                          }));
    } catch (Exception e) {
      throw new IllegalStateException("채널 계약 확인에 실패했다", e);
    }
  }

  /** 파드 B 가 받은 특정 이벤트 이름의 프레임들(순서대로). */
  private List<ServerSentEvent<String>> 파드B_이벤트(String eventName) {
    return podB.received().stream().filter(e -> eventName.equals(e.event())).toList();
  }

  /** 스니퍼가 LISTEN 한 뒤 처음 도착한 통지 — 최대 5초 기다린다(없으면 실패). */
  private static PGNotification 다음_통지(Connection 스니퍼) throws Exception {
    long 종료 = System.currentTimeMillis() + 5_000L;
    while (System.currentTimeMillis() < 종료) {
      PGNotification[] 후보 = ((PGConnection) 스니퍼).getNotifications(500);
      if (후보.length > 0) return 후보[0];
    }
    throw new AssertionError("5초 안에 NOTIFY 통지가 오지 않았다");
  }

  /** 아웃박스 행 수 — 발행이 표 를 거쳤는지 가르는 지표. */
  private long outboxCount() {
    return baseDsl.fetchOne("SELECT count(*) FROM sse_relay_event").get(0, Long.class);
  }
}

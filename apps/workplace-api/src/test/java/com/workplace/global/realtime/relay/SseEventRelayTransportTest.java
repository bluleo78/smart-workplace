package com.workplace.global.realtime.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import com.workplace.global.util.AfterCommit;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import java.lang.reflect.Field;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.postgresql.PGConnection;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 중계를 켠(PostgreSQL NOTIFY) 상태의 발행 경로 검증(WP-1973) — 작은 페이로드는 아웃박스 표 없이 NOTIFY 로 바로 가고, 8KB 페이로드는
 * 아웃박스 행을 거쳐 그대로 도착하며, 발행 실패가 호출부로 새지 않는다.
 *
 * <p>커밋 뒤 발행(스펙 5.2)도 여기서 고정한다 — 트랜잭션 안의 발행은 커밋 전엔 아웃박스에 없고, 롤백되면 어디에도 남지 않는다. 수신 검증은 실제 LISTEN 배선이
 * receiver 로 메시지를 넘길 때까지 기다린다(두 파드 시뮬레이션은 SsePodRelayIntegrationTest).
 *
 * <p>리뷰 finding 1 의 닫힘 신호 재시도(백오프 게이트 무시·첫 SQL 실패 후 즉시 재시도·최종 실패 error)도 실제 DB 로 여기서 고정한다. 리뷰
 * finding 4(죽은 커넥션의 첫 이벤트 재시도)·5(커밋 콜백 안 발행의 호출 순서)·6(커밋까지 미루고 롤백 시 버리는 운영 계약을 enabled=true 로 고정)의
 * 검증도 여기서 한다.
 *
 * <p>반려 수정(2차) 이후에는 리뷰 2(생존 확인·수신 재연결)·3(멈춘 수신자와 다른 전달 줄)·5(afterCompletion 보충)·6(큐 넘침 닫힘 신호
 * error)과 선택 항목(타임아웃 덮어쓰기 방지·키 순서와 무관한 줄 배정)을 같은 운영 경로에서 본다.
 */
@ExtendWith(OutputCaptureExtension.class)
@TestPropertySource(properties = "app.realtime.relay.enabled=true")
class SseEventRelayTransportTest extends IntegrationTestBase {

  /** 켜짐 구현 — 속성 true 라 Noop 가 조건에서 빠지므로 이 빈 하나만 주입된다. */
  @Autowired private SseEventRelay relay;

  /** 신규(수동 생성) 중계가 쓰는 JDBC URL — 파드 B 시뮬레이션(SsePodRelayIntegrationTest)과 같은 테스트 컨테이너. */
  private final String jdbcUrl = PostgresTestContainer.INSTANCE.getJdbcUrl();

  /** 아웃박스 정리 — 공유 Testcontainers DB 에 테스트가 남긴 행을 두지 않아 매 테스트가 0 행에서 시작한다. */
  @AfterEach
  void clearOutbox() {
    baseDsl.execute("DELETE FROM sse_relay_event");
  }

  /**
   * 첫 LISTEN 을 매 테스트 시작에 맞춘다(WP-1973 리뷰 3차) — {@code onMessage} 가 더 이상 호출부를 막지 않으므로, 등록 직후 바로 발행하는
   * 테스트가 수신이 켜지기 전에 발행해 이벤트를 놓칠 수 있다. 수신자만 미리 띄우고(각 테스트가 자기 수신자로 갈아 끼운다) 첫 LISTEN 을 기다린다.
   */
  @BeforeEach
  void 첫_LISTEN을_기다린다() {
    relay.onMessage(message -> {});
    if (relay instanceof PostgresSseEventRelay postgres) postgres.awaitFirstListen();
  }

  /** 작은 페이로드는 표를 거치지 않는다 — 아웃박스 행이 늘지 않고 NOTIFY 왕복 한 번으로 끝난다. */
  @Test
  void 작은_페이로드는_표를_거치지_않는다() {
    long 이전 = outboxCount();

    relay.publish(
        new RelayMessage(
            RelayMessage.TARGET_USER, "notify.created", "{\"type\":\"ISSUE\"}", "[7]"));

    assertThat(outboxCount()).as("작은 발행은 아웃박스 표를 거치지 않는다").isEqualTo(이전);
  }

  /** 큰 페이로드(8KB)는 아웃박스 행을 거쳐 도착한다 — NOTIFY 상한을 표가 대신 받고, 되읽은 값은 발행본 그대로다. */
  @Test
  void 큰_페이로드는_아웃박스를_건너_도착한다() {
    List<RelayMessage> 받은 = new ArrayList<>();
    Consumer<RelayMessage> 수신자 = 받은::add;
    relay.onMessage(수신자); // 수신자만 갈아 끼운다 — LISTEN 수신 자체는 이미 돌아간다(등록 시점만 맞으면 유실 없음)

    RelayMessage 메시지 = largeMessage();
    assertThat(메시지.needsOutbox()).as("8KB 페이로드는 아웃박스 대상이다").isTrue();

    relay.publish(메시지);

    // 발행은 전용 스레드/큐라 행이 조금 늦는다(WP-1973 리뷰 1) — 아웃박스 행이 남을 때까지 기다린다.
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(outboxCount()).as("아웃박스에 행 1개가 남는다").isEqualTo(1));
    String 행페이로드 =
        baseDsl
            .fetchOne("SELECT payload FROM sse_relay_event ORDER BY id DESC LIMIT 1")
            .get(0, String.class);
    RelayMessage 도착 = RelayMessage.decode(행페이로드);
    assertThat(도착).as("행 payload 를 되읽으면 발행본 그대로다").isEqualTo(메시지);
    // LISTEN 수신이 실제로 receiver 로 넘어온다 — 발행본과 같은 메시지가 도착할 때까지 기다린다(수동 accept 는 실제 배선과 경쟁하므로 쓰지 않는다).
    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> assertThat(받은).containsExactly(메시지));
  }

  /** 발행은 best-effort — 커넥션을 못 잡아도 예외를 호출부로 밀어내지 않고 로그로만 남긴다. */
  @Test
  void 발행_실패시_예외를_밀어내지_않는다() {
    PostgresSseEventRelay 고장난_중계 =
        new PostgresSseEventRelay("jdbc:postgresql://127.0.0.1:1/workplace", "nobody", "nobody");

    try {
      assertThatCode(() -> 고장난_중계.publish(largeMessage()))
          .as("연결이 거부돼도 발행은 예외를 던지지 않는다")
          .doesNotThrowAnyException();
    } finally {
      고장난_중계.close(); // 발행 스레드가 빈 큐를 돌지 않게 닫는다
    }
  }

  /**
   * 발행 커넥션이 끊긴 뒤에도 첫 이벤트와 닫힘 신호가 도착한다(WP-1973 리뷰 finding 1·4) — {@code isClosed()} 로는 알 수 없는 죽은
   * 커넥션이므로 일반 이벤트는 새 커넥션으로 한 번 더 시도해 도착하고(리뷰 4), 닫힘 신호는 백오프 게이트를 무시하고 재연결해 모든 파드에서 보안 토큰 회수가
   * 일어난다(리뷰 1).
   *
   * <p>받는 쪽은 다른 파드다 — 발행 파드는 자기가 보낸 닫힘 신호를 제외하고(리뷰 3차 선택) 로컬을 발행 직전에 이미 닫으므로, 재시도로 닫힘이 실제로 뱉어졌는지는
   * 남은 파드가 받는 쪽에서 본다.
   */
  @Test
  void 커넥션이_끊긴_뒤_첫_이벤트와_닫힘_신호가_도착한다() throws Exception {
    PostgresSseEventRelay 중계 = 신규_중계();
    PostgresSseEventRelay 수신파드 = 신규_중계();
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    수신파드.onMessage(받은::add);
    수신파드.awaitFirstListen(); // onMessage 는 호출부를 막지 않는다 — 발행 전에 수신이 켜졌는지 테스트가 스스로 맞춘다
    try {
      발행_커넥션을_끊는다(중계);

      // 죽은 커넥션의 첫 발행 — isClosed() 로는 못 잡아 executePublish 가 실패하고, 재시도가 새 커넥션으로 보낸다(리뷰 4).
      중계.publish(
          new RelayMessage(RelayMessage.TARGET_USER, "after.dead.connection", "{}", "[771973]"));
      // 닫힘 신호: 같은 죽은 커넥션 상태에서 게이트를 무시하고 재연결을 시도해야 한다.
      중계.publish(RelayMessage.closeUser(771973L));

      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(
              () -> {
                assertThat(받은)
                    .as("죽은 커넥션의 첫 이벤트는 재시도로 도착한다")
                    .extracting(RelayMessage::event)
                    .contains("after.dead.connection");
                assertThat(받은)
                    .as("닫힘 신호가 재연결을 거쳐 다른 파드에 도착한다")
                    .contains(RelayMessage.closeUser(771973L));
              });
    } finally {
      중계.close();
      수신파드.close();
    }
  }

  /**
   * 닫힘 신호의 첫 SQL 실패도 발행 호출 안의 즉시 재시도로 도착한다(WP-1973 리뷰 finding 1) — 죽은 커넥션으로 첫 발행이 실패해도 백오프를 무시하고
   * 재연결을 다시 시도한다(닫힘 신호 전용 메모리 큐 없이 — 과잉 구현 방지). 받는 쪽은 자기가 보낸 닫힘을 제외하지 않는 다른 파드다(리뷰 3차 선택).
   */
  @Test
  void 닫힘_신호의_첫_SQL_실패는_즉시_재시도로_도착한다() throws Exception {
    PostgresSseEventRelay 중계 = 신규_중계();
    PostgresSseEventRelay 수신파드 = 신규_중계();
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    수신파드.onMessage(받은::add);
    수신파드.awaitFirstListen();
    try {
      발행_커넥션을_끊는다(중계);

      assertThatCode(() -> 중계.publish(RelayMessage.closeUser(771974L)))
          .as("첫 SQL 실패도 예외를 밀어내지 않는다")
          .doesNotThrowAnyException();

      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(
              () ->
                  assertThat(받은)
                      .as("즉시 재시도를 거쳐 닫힘 신호가 다른 파드에 도착한다")
                      .contains(RelayMessage.closeUser(771974L)));
    } finally {
      중계.close();
      수신파드.close();
    }
  }

  /**
   * 닫힘 신호도 재시도까지 모두 실패하면 error 로 남고 예외는 던지지 않는다(WP-1973 리뷰 finding 1) — 유실이 눈에 띄게 남으면서도
   * 호출부(best-effort 계약)는 멈추지 않는다. 일반 이벤트는 같은 상황에서 error 를 남기지 않는다.
   */
  @Test
  void 닫힘_신호도_최종_실패하면_error_로그로_남긴다(CapturedOutput output) {
    PostgresSseEventRelay 고장난_중계 =
        new PostgresSseEventRelay("jdbc:postgresql://127.0.0.1:1/workplace", "nobody", "nobody");
    try {
      assertThatCode(
              () ->
                  고장난_중계.publish(
                      new RelayMessage(RelayMessage.TARGET_USER, "quiet.drop", "{}", "[7]")))
          .as("일반 이벤트는 예외 없이 조용히 버려진다")
          .doesNotThrowAnyException();
      // 발행은 전용 스레드/큐라 로그가 조금 늦다(WP-1973 리뷰 1) — 일반 이벤트가 끝날 때까지 기다린 뒤 error 가 없는지 본다.
      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(
              () ->
                  assertThat(발행_실패_로그_줄들(output, "커넥션이 준비되지 않아 이벤트를 버린다"))
                      .as("일반 이벤트가 실패 warn 으로 끝난다")
                      .isNotEmpty());
      assertThat(닫힘_실패_로그_줄들(output)).as("일반 이벤트는 닫힘 신호 실패 로그(error)를 남기지 않는다").isEmpty();

      assertThatCode(() -> 고장난_중계.publish(RelayMessage.closeUser(7L)))
          .as("닫힘 신호 최종 실패도 예외를 호출부로 밀어내지 않는다")
          .doesNotThrowAnyException();
      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(() -> assertThat(닫힘_실패_로그_줄들(output)).hasSize(1));
      assertThat(닫힘_실패_로그_줄들(output).get(0))
          .as("그 줄은 ERROR 레벨이고 닫힘 신호 실패를 가르는다")
          .contains("ERROR")
          .contains("SSE 중계 닫힘 신호 발행 실패");
    } finally {
      고장난_중계.close();
    }
  }

  /** 트랜잭션 안의 발행은 커밋 뒤로 미뤄진다 — 커밋 전엔 아웃박스에 없고, 커밋되면 남는다(스펙 5.2). */
  @Test
  void 발행은_커밋_뒤에_아웃박스로_남는다() {
    long 이전 = outboxCount();

    callInTenant(
        1L,
        () -> {
          relay.publish(largeMessage());
          assertThat(outboxCount()).as("커밋 전에는 아직 발행하지 않는다").isEqualTo(이전);
          return null;
        });

    // 발행은 큐를 거쳐 조금 늦는다 — 커밋 뒤 아웃박스에 남을 때까지 기다린다.
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(outboxCount()).as("커밋되면 아웃박스에 남는다").isEqualTo(이전 + 1));
  }

  /** 롤백된 트랜잭션의 발행은 아웃박스에 남지 않는다 — 롤백된 변경이 이벤트로 새지 않게(스펙 5.2). */
  @Test
  void 롤백된_트랜잭션의_발행은_아웃박스에_남지_않는다() {
    long 이전 = outboxCount();

    inRollbackTx(
        soft -> {
          relay.publish(largeMessage());
          soft.assertThat(outboxCount()).as("커밋 전에는 아직 발행하지 않는다").isEqualTo(이전);
        });

    assertThat(outboxCount()).as("롤백됐으면 발행도 없다").isEqualTo(이전);
  }

  /**
   * 켜진 중계의 발행 계약을 수신자에서 고정한다(WP-1973 리뷰 6) — 운영(켜짐)은 커밋까지 기다렸다가 커밋된 발행만 수신자에 닿고, 롤백된 발행은 영영 닿지 않는다.
   * Noop(테스트 프로파일)은 바로 보내므로 이 계약은 enabled=true 로 여기서만 볼 수 있다.
   */
  @Test
  void 켜진_중계의_발행은_커밋_뒤에만_수신자에게_닿는다() {
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    relay.onMessage(받은::add);
    RelayMessage 커밋_발행 = new RelayMessage(RelayMessage.TARGET_USER, "tx.commit", "{}", "[7]");
    RelayMessage 롤백_발행 = new RelayMessage(RelayMessage.TARGET_USER, "tx.rollback", "{}", "[7]");

    callInTenant(
        1L,
        () -> {
          relay.publish(커밋_발행);
          assertThat(발행된_이벤트(받은, "tx.commit")).as("커밋 전에는 수신자에도 닿지 않는다").isEmpty();
          return null;
        });

    inRollbackTx(
        soft -> {
          relay.publish(롤백_발행);
          soft.assertThat(발행된_이벤트(받은, "tx.rollback")).as("롤백 전에도 닿지 않는다").isEmpty();
        });

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () -> assertThat(발행된_이벤트(받은, "tx.commit")).as("커밋된 발행은 수신자에 닿는다").hasSize(1));
    assertThat(발행된_이벤트(받은, "tx.rollback")).as("롤백된 발행은 수신자에도 닿지 않는다").isEmpty();
  }

  /**
   * 커밋 콜백 안의 발행이 호출 순서대로 나간다(WP-1973 리뷰 5, WP-874) — afterCommit 안의 publish 를 afterCompletion 으로 밀면
   * 같은 트랜잭션의 앞 발행과 순서가 뒤바뀐다(링크 미리보기가 메시지 수정보다 먼저 나가는 문제). 콜백 안의 발행은 바로 큐에 넣는다.
   */
  @Test
  void 커밋_콜백_안의_발행은_호출_순서대로_나간다() {
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    relay.onMessage(받은::add);
    RelayMessage 콜백_발행 = new RelayMessage(RelayMessage.TARGET_USER, "order.callback", "{}", "[7]");
    RelayMessage 직접_발행 = new RelayMessage(RelayMessage.TARGET_USER, "order.direct", "{}", "[7]");

    callInTenant(
        1L,
        () -> {
          AfterCommit.run(() -> relay.publish(콜백_발행)); // 등록 순서: 커밋 콜백이 먼저
          relay.publish(직접_발행); // 그 다음 트랜잭션 발행
          return null;
        });

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () -> {
              List<String> 순서 =
                  받은.stream()
                      .map(RelayMessage::event)
                      .filter(e -> e != null && e.startsWith("order."))
                      .toList();
              assertThat(순서)
                  .as("커밋 콜백 안의 발행이 호출 순서대로 먼저 나간다")
                  .containsExactly("order.callback", "order.direct");
            });
  }

  /**
   * 커밋 콜백 안에서 다시 발행해도 아웃박스에 남는다 — MessageSseDispatcher·RunnerSseDispatcher 가 {@link AfterCommit} 으로
   * fanOut 을 커밋 뒤에 부르는데, 그 안의 publish 는 afterCommit 스냅샷이 이미 복사된 뒤에 등록된다(Spring 7). 없으면 이 경로의 이벤트가
   * 중계에서 사라진다.
   */
  @Test
  void 커밋_콜백_안의_발행도_아웃박스에_남는다() {
    long 이전 = outboxCount();

    callInTenant(
        1L,
        () -> {
          AfterCommit.run(() -> relay.publish(largeMessage()));
          return null;
        });

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () -> assertThat(outboxCount()).as("커밋 콜백의 발행도 커밋 뒤에 남는다").isEqualTo(이전 + 1));
  }

  /**
   * 속성이 없는 프로파일(local·운영 기본값)에서도 켜진 구현이 빈이 된다 — Task 1 리뷰 Important(비테스트 프로파일에 SseEventRelay 빈 부재 →
   * bootRun local 컨텍스트 실패)의 재검증.
   */
  @Test
  void 속성이_없으면_켜진_구현이_빈이_된다() {
    new ApplicationContextRunner()
        .withUserConfiguration(SseRelayConfiguration.class)
        .withPropertyValues(
            "spring.datasource.url=jdbc:postgresql://localhost:5435/workplace_test",
            "spring.datasource.username=app_tenant",
            "spring.datasource.password=app_tenant")
        .run(
            ctx -> {
              assertThat(ctx).hasSingleBean(SseEventRelay.class);
              assertThat(ctx.getBean(SseEventRelay.class))
                  .isInstanceOf(PostgresSseEventRelay.class);
            });
  }

  /**
   * 리뷰 반려 수정(2차)도 실제 경로에서 고정한다 — 수신 커넥션 죽음의 생존 확인·재연결(리뷰 2), 느린(멈춘) 클라이언트가 다른 대상의 전달을 막지 않음(리뷰 3),
   * 플래그 없는 커밋 콜백 발행의 afterCompletion 보충 경로(리뷰 5), 닫힘 신호의 큐 넘침 유실 error(리뷰 6 계약), 그리고 타임아웃 파라미터 덮어쓰기
   * 방지·키 순서와 무관한 전달 줄 배정 같은 선택 항목을 본다.
   */
  @Test
  void 타임아웃_파라미터는_이미_있는_값을_덮지_않는다() {
    assertThat(PostgresSseEventRelay.withTimeouts("jdbc:postgresql://db:5432/workplace"))
        .as("파라미터가 없으면 연결·소켓 제한을 둘 다 덧붙인다")
        .contains("?connectTimeout=5")
        .contains("&socketTimeout=15");
    assertThat(
            PostgresSseEventRelay.withTimeouts(
                "jdbc:postgresql://db:5432/workplace?socketTimeout=60"))
        .as("운영자가 넣은 소켓 제한은 그대로 두고 연결 제한만 덧붙인다")
        .contains("socketTimeout=60")
        .contains("connectTimeout=5")
        .doesNotContain("socketTimeout=15");
    assertThat(
            PostgresSseEventRelay.withTimeouts(
                "jdbc:postgresql://db:5432/workplace?connectTimeout=9&socketTimeout=60"))
        .as("둘 다 있으면 값을 바꾸지 않는다")
        .isEqualTo("jdbc:postgresql://db:5432/workplace?connectTimeout=9&socketTimeout=60");
  }

  /** 키 순서가 달라도 같은 대상이면 같은 전달 줄로 간다 — 줄이 갈리면 대상 안의 발행 순서가 흐트러진다(WP-1973 리뷰: 멤버 목록 순서 불안정). */
  @Test
  void 키_순서가_달라도_같은_전달_줄로_간다() {
    RelayMessage 앞뒤 = new RelayMessage(RelayMessage.TARGET_USER, "stripe.order", "{}", "[7,8]");
    RelayMessage 역순 = new RelayMessage(RelayMessage.TARGET_USER, "stripe.order", "{}", "[8,7]");

    assertThat(PostgresSseEventRelay.stripeIndex(역순))
        .as("키 집합이 같으면 순서와 무관하게 같은 줄이다")
        .isEqualTo(PostgresSseEventRelay.stripeIndex(앞뒤));
  }

  /**
   * 여러 받는 사람의 이벤트는 받는 사람 단위로 나뉘어 도착한다(WP-1973 리뷰) — 메시지 전체로 줄을 고르면 다음 메시지와 집합이 달라 다른 줄로 가, 같은
   * 사용자에게도 전달 순서가 뒤바뀐다(예: {@code [1,2]} 다음 {@code [1]}). userId 별 부분집합으로 나눠 각 사용자가 늘 한 줄에 가게 한다.
   * 켜진(PostgreSQL NOTIFY) 운영 경로에서 고정한다.
   */
  @Test
  void 여러_받는_사람의_이벤트는_받는_사람_별로_나뉘어_도착한다() {
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    PostgresSseEventRelay 중계 = 신규_중계();
    중계.onMessage(받은::add);
    중계.awaitFirstListen();
    try {
      중계.publish(new RelayMessage(RelayMessage.TARGET_USER, "stripe.per.user", "{}", "[7,8]"));

      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(() -> assertThat(발행된_이벤트(받은, "stripe.per.user")).hasSize(2));
      assertThat(발행된_이벤트(받은, "stripe.per.user"))
          .as("한 받는 사람씩 나뉜 부분집합으로 도착한다")
          .extracting(RelayMessage::keysJson)
          .containsExactlyInAnyOrder("[7]", "[8]");

      RelayMessage 혼자_7 =
          new RelayMessage(RelayMessage.TARGET_USER, "stripe.per.user", "{}", "[7]");
      RelayMessage 둘_중_7 =
          new RelayMessage(RelayMessage.TARGET_USER, "stripe.per.user", "{}", "[7,9]");
      assertThat(PostgresSseEventRelay.stripeIndex(둘_중_7.perRecipient().get(0)))
          .as("같은 사용자는 다른 받는 사람과 섞여 있어도 늘 같은 전달 줄로 간다")
          .isEqualTo(PostgresSseEventRelay.stripeIndex(혼자_7));
    } finally {
      중계.close();
    }
  }

  /**
   * 생존 확인(주기 {@code SELECT 1})은 끊긴 커넥션에서 실제로 SQLException 으로 드러난다(WP-1973 리뷰 2) — 반쯤 열린 죽음을 재연결로
   * 보내는 신호가 나는지, 루프 밖 백오프로 넘어가는 경로의 입구를 여기서 고정한다.
   */
  @Test
  void 생존_확인은_끊긴_커넥션에서_SQL_예외로_드러난다() throws Exception {
    Connection 커넥션 = DriverManager.getConnection(jdbcUrl, "app_tenant", "app_tenant");
    try {
      long pid = 커넥션.unwrap(PGConnection.class).getBackendPID();
      try (Connection 슈퍼 = DriverManager.getConnection(jdbcUrl, "app", "app");
          Statement st = 슈퍼.createStatement()) {
        st.execute(
            "SELECT pg_terminate_backend(" + pid + ", 5000)"); // 2 인자 — 종료가 끝날 때까지 기다려 레이스 없음
      }

      assertThatThrownBy(() -> PostgresSseEventRelay.keepAlive(커넥션))
          .as("강제 종료된 커넥션의 생존 확인은 예외로 실패한다 — 그 예외가 재연결 백오프로 이어진다")
          .isInstanceOf(SQLException.class);
    } finally {
      커넥션.close();
    }
  }

  /**
   * 수신(LISTEN) 커넥션이 끊기면 재연결해 이벤트를 계속 받는다(WP-1973 리뷰 2) — 죽은 수신 커넥션에 묶인 파드는 이벤트와 닫힘 신호를 영구히 놓친다. 생존
   * 확인·읽기 실패가 재연결로 이어져 새 커넥션에서 다시 받는다.
   */
  @Test
  void 수신_커넥션이_끊기면_재연결해_이벤트를_계속_받는다() throws Exception {
    PostgresSseEventRelay 중계 = new PostgresSseEventRelay(jdbcUrl, "app_tenant", "app_tenant", 500L);
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    중계.onMessage(받은::add);
    try {
      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(() -> assertThat(중계.listenerBackendPid()).isNotEqualTo(-1));
      int 끊길_pid = 중계.listenerBackendPid();

      try (Connection 슈퍼 = DriverManager.getConnection(jdbcUrl, "app", "app");
          Statement st = 슈퍼.createStatement()) {
        st.execute("SELECT pg_terminate_backend(" + 끊길_pid + ", 5000)");
      }

      // 끊긴 사이의 이벤트는 재생하지 않으므로(best-effort) 새 커넥션으로 바뀐 뒤에 발행한다.
      await()
          .atMost(Duration.ofSeconds(10))
          .untilAsserted(
              () -> assertThat(중계.listenerBackendPid()).isNotEqualTo(-1).isNotEqualTo(끊길_pid));

      중계.publish(new RelayMessage(RelayMessage.TARGET_USER, "after.listen.dead", "{}", "[771973]"));

      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(
              () ->
                  assertThat(발행된_이벤트(받은, "after.listen.dead"))
                      .as("재연결된 수신 커넥션에서 이벤트를 다시 받는다")
                      .hasSize(1));
    } finally {
      중계.close();
    }
  }

  /**
   * 멈춘 수신자와 다른 전달 줄의 이벤트는 막히지 않는다(WP-1973 리뷰 3) — 리스너 하나가 전달까지 맡던 구조에서는 느린(멈춘) 클라이언트 하나가 파드 전체의 전달을
   * 멈췄다. 같은 대상·키는 같은 줄로 가므로 대상 안의 순서는 그대로 지켜진다.
   */
  @Test
  void 멈춘_수신자와_다른_줄의_이벤트는_막히지_않는다() throws Exception {
    PostgresSseEventRelay 중계 = 신규_중계();
    CountDownLatch 멈춤_확인 = new CountDownLatch(1);
    CountDownLatch 풀릴_때까지_대기 = new CountDownLatch(1);
    CountDownLatch 다른_줄_도착 = new CountDownLatch(1);
    중계.onMessage(
        message -> {
          if ("stripe.blocked".equals(message.event())) {
            멈춤_확인.countDown();
            try {
              풀릴_때까지_대기.await(); // 이 줄의 스레드를 끝까지 묶어 둔다 — 다른 줄이 독립으로 도는지 확인하기 위해
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
            }
          } else if ("stripe.free".equals(message.event())) {
            다른_줄_도착.countDown();
          }
        });
    중계.awaitFirstListen(); // 발행 전에 수신이 켜졌는지 스스로 맞춘다(onMessage 는 기다리지 않는다)
    try {
      RelayMessage 막힐_메시지 =
          new RelayMessage(RelayMessage.TARGET_USER, "stripe.blocked", "{}", "[7]");
      RelayMessage 자유_메시지 = 다른_줄의_메시지(막힐_메시지, "stripe.free");

      중계.publish(막힐_메시지);
      assertThat(멈춤_확인.await(5, TimeUnit.SECONDS)).as("첫 이벤트가 전달 줄 하나를 점유한다").isTrue();

      중계.publish(자유_메시지);
      assertThat(다른_줄_도착.await(5, TimeUnit.SECONDS)).as("다른 줄의 이벤트는 멈춘 줄에 끼지 않고 도착한다").isTrue();
    } finally {
      풀릴_때까지_대기.countDown(); // 묶인 전달 스레드를 풀어 close 가 스레드를 기다리지 않게 한다
      중계.close();
    }
  }

  /**
   * 플래그 없는 커밋 콜백의 발행도 수신자에 닿는다(WP-1973 리뷰 5) — {@link AfterCommit} 안이 아닌 AFTER_COMMIT 리스너(예:
   * SuspendedMemberStreamCloser)의 publish 는 afterCommit 스냅샷이 복사된 뒤에 등록돼
   * afterCompletion(STATUS_COMMITTED) 보충 경로로만 발행된다. 그 경로가 죽으면 정지 멤버의 닫힘 신호가 중계에서 사라진다.
   */
  @Test
  void 플래그_없는_커밋_콜백의_발행도_수신자에_닿는다() {
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    relay.onMessage(받은::add);
    RelayMessage 메시지 =
        new RelayMessage(RelayMessage.TARGET_USER, "aftercompletion.fallback", "{}", "[7]");

    callInTenant(
        1L,
        () -> {
          TransactionSynchronizationManager.registerSynchronization(
              new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                  relay.publish(메시지); // AfterCommit 플래그 없음 — 보충 발행 경로를 지난다
                }
              });
          return null;
        });

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () ->
                assertThat(발행된_이벤트(받은, "aftercompletion.fallback"))
                    .as("afterCompletion 보충 발행도 수신자에 닿는다")
                    .hasSize(1));
  }

  /**
   * 발행 큐가 가득 차면 닫힘 신호 유실은 error 로 남는다(WP-1973 리뷰 6 계약) — 닫힘 신호는 보안(토큰 회수)이라 일반 이벤트의 경고와 레벨이 갈려야 한다.
   * 발행 스레드를 락으로 묶어 큐를 실제로 가득 채운 뒤 본다(운영 경로 — 중계를 끄지 않고).
   */
  @Test
  void 발행_큐가_가득_차면_닫힘_신호의_유실은_error_로그로_남는다(CapturedOutput output) throws Exception {
    PostgresSseEventRelay 중계 = 신규_중계();
    try {
      Field 발행_락 = PostgresSseEventRelay.class.getDeclaredField("lock");
      발행_락.setAccessible(true);
      synchronized (발행_락.get(중계)) {
        // 발행 스레드가 이 락 안의 JDBC 에 묶이는 동안 큐를 가득 채운다 — 안에서 못 비우니 넘치는지가 그대로 드러난다.
        for (int i = 0; i < 4_100; i++) {
          중계.publish(new RelayMessage(RelayMessage.TARGET_USER, "filler", "{}", "[1]"));
        }

        assertThatCode(() -> 중계.publish(RelayMessage.closeUser(771975L)))
            .as("닫힘 신호 유실도 예외를 호출부로 밀어내지 않는다")
            .doesNotThrowAnyException();

        assertThat(큐_넘침_닫힘_로그_줄들(output))
            .as("큐 넘침으로 버려진 닫힘 신호는 ERROR 한 줄로 남는다")
            .hasSize(1)
            .first()
            .asString()
            .contains("ERROR")
            .contains("닫힘 신호를 넣지 못했다")
            .contains("user.close");
      }
    } finally {
      중계.close();
    }
  }

  /**
   * 큰 fanOut 도 줄마다 작업 하나로 전달된다(WP-1973 리뷰 3차) — 받는 사람 수만큼 작업을 큐에 넣으면 채널·스레드 멤버 전체 fanOut(천 단위)에서 줄
   * 큐(1024×4)를 넘겨 조용히 유실된다. 통지 하나를 줄 번호로 묶어 넘기면 큐 점유가 메시지 수로 떨어져 전원에게 닿는다.
   *
   * <p>받는 쪽을 잠시 멈춰 두고 본다 — 계속 받으면 구 구현(파트당 작업 제출)도 큐를 넘지 못해 이 테스트가 회귀를 잡지 못하기 때문이다. 멈춘 동안 구 구현은
   * 5000 파트를 줄마다 내려다 큐(1025)를 넘겨 유실 경고를 남기고, 새 구현은 줄마다 작업 하나라 경고 없이 5000 건을 모두 받는다.
   */
  @Test
  void 큰_fanOut도_줄마다_작업_하나로_전달된다(CapturedOutput output) throws Exception {
    CountDownLatch 방해 = new CountDownLatch(1);
    CountDownLatch 첫_수신 = new CountDownLatch(1);
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    PostgresSseEventRelay 중계 = 신규_중계();
    중계.onMessage(
        message -> {
          if ("fanout.big".equals(message.event())) {
            첫_수신.countDown();
            try {
              방해.await(); // 전달 줄 하나가 이 메시지에 멈춰 제출이 끝날 때까지 구 구현의 큐 넘침을 그대로 둔다
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
            }
          }
          받은.add(message);
        });
    중계.awaitFirstListen();
    try {
      int 인원 = 5_000; // 4줄 × 1024 를 넘겨 받는 사람 단위 제출이면 유실되는 크기
      StringBuilder keys = new StringBuilder("[");
      for (int i = 0; i < 인원; i++) {
        if (i > 0) keys.append(',');
        keys.append(920000L + i);
      }
      keys.append(']');

      중계.publish(new RelayMessage(RelayMessage.TARGET_USER, "fanout.big", "{}", keys.toString()));

      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(() -> assertThat(첫_수신.getCount()).as("큰 fanOut 이 전달 줄에 도착한다").isZero());
      // 발행 쪽이 5000 파트의 전달 작업을 모두 내놓는다(그룹핑 뒤 줄 제출) — 멈춰 있는 동안에만 유실이 갈리므로 그 뒤에 내려 놓는다.
      Thread.sleep(1_000L);
      방해.countDown();

      await()
          .atMost(Duration.ofSeconds(15))
          .untilAsserted(
              () ->
                  assertThat(발행된_이벤트(받은, "fanout.big"))
                      .as("줄마다 작업 하나라 받는 사람 수만큼 유실되지 않는다")
                      .hasSize(인원));
      assertThat(발행_실패_로그_줄들(output, "전달 큐가 가득 찼다"))
          .as("통지 1건이 줄마다 작업 하나라 전달 큐가 넘치지 않는다(파트 단위 제출이면 넘친다)")
          .isEmpty();
    } finally {
      방해.countDown(); // 실패해도 전달 스레드를 가두어 두지 않는다
      중계.close();
    }
  }

  /** 같은 사람의 이벤트와 닫힘 신호는 같은 전달 줄로 간다(WP-1973 리뷰 3차) — 줄이 갈리면 닫힘이 앞선 이벤트를 앞질러 재연결한 스트림을 닫는다. */
  @Test
  void 같은_사람의_이벤트와_닫힘_신호는_같은_전달_줄로_간다() {
    RelayMessage 이벤트 =
        new RelayMessage(RelayMessage.TARGET_USER, "stripe.close.order", "{}", "[7]");
    assertThat(PostgresSseEventRelay.stripeIndex(RelayMessage.closeUser(7L)))
        .as("같은 userId 의 user 와 user.close 는 한 줄이다")
        .isEqualTo(PostgresSseEventRelay.stripeIndex(이벤트));

    RelayMessage runner이벤트 =
        new RelayMessage(RelayMessage.TARGET_RUNNER, "stripe.close.order", "{}", "[3,7]");
    assertThat(PostgresSseEventRelay.stripeIndex(RelayMessage.closeRunner(3L, 7L)))
        .as("같은 (테넌트, 위치) 의 runner 와 runner.close 는 한 줄이다")
        .isEqualTo(PostgresSseEventRelay.stripeIndex(runner이벤트));
  }

  /**
   * 같은 사람의 닫힘 신호는 앞선 이벤트 뒤에 도착한다 — 한 줄 FIFO 로만 지켜지는 순서(WP-1973 리뷰 3차)를 운영 경로에서 본다. 발행 파드는 자기가 보낸 닫힘
   * 신호를 건너뛰므로(리뷰 3차 선택) 받는 쪽은 다른 파드다 — 같은 줄에 묶이는지가 곧 이 순서로 드러난다.
   */
  @Test
  void 같은_사람의_닫힘_신호는_앞선_이벤트_뒤에_도착한다() {
    PostgresSseEventRelay 발행파드 = 신규_중계();
    PostgresSseEventRelay 수신파드 = 신규_중계();
    List<RelayMessage> 받은 = new CopyOnWriteArrayList<>();
    수신파드.onMessage(받은::add);
    수신파드.awaitFirstListen();
    try {
      long uid = 940007L;
      발행파드.publish(
          new RelayMessage(RelayMessage.TARGET_USER, "close.order.before", "{}", "[" + uid + "]"));
      발행파드.publish(RelayMessage.closeUser(uid));

      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(
              () ->
                  assertThat(받은)
                      .as("우리 사용자의 닫힘 신호가 도착한다")
                      .anyMatch(
                          m -> 우리_키(m, uid) && RelayMessage.TARGET_USER_CLOSE.equals(m.target())));
      // 키로 거른다 — 같은 채널을 쓰는 다른 테스트의 닫힘 신호가 섞이면 순서 단언이 흔들린다.
      List<RelayMessage> 순서 =
          받은.stream()
              .filter(m -> 우리_키(m, uid))
              .filter(
                  m ->
                      "close.order.before".equals(m.event())
                          || RelayMessage.TARGET_USER_CLOSE.equals(m.target()))
              .toList();
      assertThat(순서).hasSize(2);
      assertThat(순서.get(0).event()).as("이벤트가 먼저, 닫힘이 그 뒤다").isEqualTo("close.order.before");
      assertThat(순서.get(1).target()).isEqualTo(RelayMessage.TARGET_USER_CLOSE);
    } finally {
      발행파드.close();
      수신파드.close();
    }
  }

  /**
   * 자기가 보낸 닫힘 신호는 그 파드로 돌아오지 않는다(WP-1973 리뷰 3차 선택) — 발행 파드는 발행 직전에 로컬을 이미 닫았는데, NOTIFY 왕복 중 재연결한
   * 스트림을 되돌아온 유선 닫힘이 다시 닫는다. 같은 줄의 뒤 이벤트가 도착했다는 것은 앞의 닫힘도 그 파드에서 처리됐다는 뜻이라 판단이 확정적이다.
   */
  @Test
  void 자기가_보낸_닫힘_신호는_그_파드로_돌아오지_않는다() {
    PostgresSseEventRelay 나 = 신규_중계();
    PostgresSseEventRelay 다른파드 = 신규_중계();
    List<RelayMessage> 내게_온 = new CopyOnWriteArrayList<>();
    List<RelayMessage> 다른파드에_온 = new CopyOnWriteArrayList<>();
    나.onMessage(내게_온::add);
    나.awaitFirstListen();
    다른파드.onMessage(다른파드에_온::add);
    다른파드.awaitFirstListen();
    try {
      long uid = 950007L;
      나.publish(RelayMessage.closeUser(uid));
      나.publish(
          new RelayMessage(RelayMessage.TARGET_USER, "after.self.close", "{}", "[" + uid + "]"));

      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(() -> assertThat(발행된_이벤트(내게_온, "after.self.close")).hasSize(1));
      await()
          .atMost(Duration.ofSeconds(5))
          .untilAsserted(
              () ->
                  assertThat(다른파드에_온)
                      .as("다른 파드에는 닫힘이 그대로 간다")
                      .anyMatch(
                          m -> 우리_키(m, uid) && RelayMessage.TARGET_USER_CLOSE.equals(m.target())));
      // 우리 키로만 본다 — 다른 테스트가 같은 채널에 보낸 닫힘 신호까지 실려도 이 결론은 흔들리지 않는다.
      assertThat(내게_온)
          .as("자기 파드는 발행 직전에 이미 닫았으므로 되돌아오지 않는다")
          .noneMatch(m -> 우리_키(m, uid) && RelayMessage.TARGET_USER_CLOSE.equals(m.target()));
    } finally {
      나.close();
      다른파드.close();
    }
  }

  /** 아웃박스 행 수 — 발행이 표 를 거쳤는지 가르는 지표. */
  private long outboxCount() {
    return baseDsl.fetchOne("SELECT count(*) FROM sse_relay_event").get(0, Long.class);
  }

  /** 8KB 페이로드를 가진 발행 메시지 — 인코딩이 7000 바이트를 넘겨 아웃박스 대상이 된다. */
  private static RelayMessage largeMessage() {
    return new RelayMessage(
        RelayMessage.TARGET_USER, "notify.created", "x".repeat(8 * 1024), "[7]");
  }

  /** 신규 전용 중계(수동 생성) — 컨텍스트 빈과 섞이지 않게 따로 만들고, 각 테스트 finally 에서 닫는다. */
  private PostgresSseEventRelay 신규_중계() {
    return new PostgresSseEventRelay(jdbcUrl, "app_tenant", "app_tenant");
  }

  /**
   * 발행 커넥션을 직접 잡아 중계에 주입하고 서버 측에서 강제 종료한다 — 실제 발행 경로가 죽은 커넥션을 그대로 써서 백오프·재시도 경로를 겨눌 수 있게(주입은 테스트 전용
   * 리플렉션 — 프로덕션에 테스트 자리를 만들지 않는다).
   *
   * @return 종료시킨 백엔드 pid
   */
  private long 발행_커넥션을_끊는다(PostgresSseEventRelay 중계) throws Exception {
    Connection 죽을커넥션 = DriverManager.getConnection(jdbcUrl, "app_tenant", "app_tenant");
    long 백엔드 = 죽을커넥션.unwrap(PGConnection.class).getBackendPID();
    Field 필드 = PostgresSseEventRelay.class.getDeclaredField("connection");
    필드.setAccessible(true);
    필드.set(중계, 죽을커넥션);
    // 슈퍼유저로 강제 종료(2 인자 — 서버가 종료될 때까지 기다려 레이스 없음) — 같은 롤의 세션 종료는 권한이 없어 거부될 수 있다.
    try (Connection 슈퍼 = DriverManager.getConnection(jdbcUrl, "app", "app");
        Statement st = 슈퍼.createStatement()) {
      st.execute("SELECT pg_terminate_backend(" + 백엔드 + ", 5000)");
    }
    return 백엔드;
  }

  /** 닫힘 신호 최종 실패(error) 로그 줄 — 메시지가 이 경로 전용이라 일반 발행 warn 과 섞이지 않는다. */
  private static List<String> 닫힘_실패_로그_줄들(CapturedOutput output) {
    return output.getAll().lines().filter(l -> l.contains("SSE 중계 닫힘 신호 발행 실패")).toList();
  }

  /** 발행 큐 넘침으로 닫힘 신호가 버려진 error 로그 줄 — send 경로의 최종 실패 문구와 갈리게 다른 문구를 쓴다. */
  private static List<String> 큐_넘침_닫힘_로그_줄들(CapturedOutput output) {
    return output.getAll().lines().filter(l -> l.contains("닫힘 신호를 넣지 못했다")).toList();
  }

  /** 기준 메시지와 다른 전달 줄에 드는 같은 대상의 메시지 — 멈춘 줄에 독립적인 다른 줄을 테스트가 고르게 한다(줄 번호가 같으면 테스트가 성립하지 않는다). */
  private static RelayMessage 다른_줄의_메시지(RelayMessage 기준, String event) {
    for (int key = 0; key < 50; key++) {
      RelayMessage 후보 = new RelayMessage(기준.target(), event, "{}", "[" + key + "]");
      if (PostgresSseEventRelay.stripeIndex(후보) != PostgresSseEventRelay.stripeIndex(기준)) {
        return 후보;
      }
    }
    throw new IllegalStateException("기준 메시지와 다른 전달 줄을 찾지 못했다");
  }

  /** 특정 발행 실패 warn 로그 줄 — 닫힘 신호 error 와 문자열이 겹치지 않게 문구로 한정한다. */
  private static List<String> 발행_실패_로그_줄들(CapturedOutput output, String phrase) {
    return output.getAll().lines().filter(l -> l.contains(phrase)).toList();
  }

  /** 지정 이벤트 이름이 도착한 발행들 — 수신자 목록을 이벤트 이름으로 거라 다른 테스트의 메시지와 섞이지 않는다. */
  private static List<RelayMessage> 발행된_이벤트(List<RelayMessage> 받은, String eventName) {
    return 받은.stream().filter(m -> eventName.equals(m.event())).toList();
  }

  /** 그 유저의 키를 받는 메시지 — 공유 테스트 DB 채널에 다른 테스트가 보낸 닫힘 신호까지 걸러 테스트 결론을 흔들지 않게 한다. */
  private static boolean 우리_키(RelayMessage message, long uid) {
    return ("[" + uid + "]").equals(message.keysJson());
  }
}

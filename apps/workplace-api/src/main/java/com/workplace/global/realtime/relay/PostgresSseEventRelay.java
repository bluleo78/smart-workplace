package com.workplace.global.realtime.relay;

import com.workplace.global.util.AfterCommit;
import jakarta.annotation.PreDestroy;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import lombok.extern.slf4j.Slf4j;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 켜진 상태의 중계 구현(WP-1973) — 발행은 PostgreSQL NOTIFY 로 파드 사이에 내고, 수신은 전용 커넥션의 LISTEN 으로 받아 자기 파드의 연결에
 * 전달한다.
 *
 * <p>인코딩 결과가 {@link RelayMessage#MAX_NOTIFY_BYTES} 안이면 표 없이 {@code pg_notify} 로 바로 보내고, 그 외는
 * 아웃박스({@code sse_relay_event}) 행에 남기고 통지에는 {@code #id} 만 실어 보낸다 — NOTIFY 페이로드 상한(8000 바이트)을 표가 대신
 * 받는다. 수신은 도착한 통지를 바로바로 읽어({@code getNotifications(50)}) 같은 채널 순서대로 dispatch 한다.
 *
 * <p>커넥션은 Hikari 풀이 아니라 {@link DriverManager} 로 직접 잡은 전용 커넥션이다 — afterCommit 콜백·수신 스레드에서 써도 풀 커넥션을
 * 소모하지 않는다(WP-751 재발 방지). 발행은 한 커넥션에 {@code synchronized} 락을 걸어 파드 안 발행 순서 = NOTIFY 도착 순서가 된다.
 *
 * <p><b>발행은 전용 스레드/큐(WP-1973 리뷰 1)</b> — 요청 스레드(afterCommit 콜백)는 큐에 넣기만 하고 실제 JDBC 는 발행 스레드가 한다. DB
 * 경로가 조용히 끊겨도 요청 스레드·Hikari 커넥션이 블로킹되지 않는다. 커넥션은 {@code connectTimeout}·{@code socketTimeout} 을
 * 걸어(아래 {@link #withTimeouts}) 발행·수신 모두 무한 대기하지 않는다.
 *
 * <p>수신 커넥션이 끊기면 닫고 지수 백오프(1s→30s 상한) 후 {@code LISTEN} 을 다시 등록한다 — 끊긴 사이의 이벤트는 재생하지 않는다(재생 버퍼 없음 —
 * best-effort 계약). 반쯤 열린 죽음(읽기가 빈 배열만 돌려주어 끊김이 안 드러나는 상태)은 주기 {@code SELECT 1} 생존 확인이 잡아 재연결로
 * 보낸다(WP-1973 리뷰 2).
 *
 * <p><b>전달은 받는 사람별 스트라이프(WP-1973 리뷰 3)</b> — 리스너 스레드는 통지만 읽고, 로컬 전달은 받는 사람(userId)으로 나뉜 전용 스레드들의
 * FIFO 큐에 넘긴다. 느린 클라이언트 하나가 파드 전체 전달을 막지 않고, 한 받는 사람의 메시지는 늘 한 줄에 가므로 그 사람 안의 순서는 지켜진다(여러 사람을 담은
 * 메시지는 부분집합으로 나눠 각 사람의 줄로 보낸다 — 리뷰: 받는 사람 단위).
 *
 * <p>예외는 닫힘 신호({@code user.close}·{@code runner.close})다 — 백오프 게이트를 무시한 재연결과 발행 안의 한 번 즉시 재시도를 거치고,
 * 그래도 실패하면 error 로 남긴다. 닫힘을 받지 못한 파드의 emitter 는 타임아웃(최대 1h)까지 스트림을 유지해 보안 토큰 회수가 한 파드에서만 일어나기
 * 때문이다(WP-1973 리뷰 — 닫힘 신호 전용 메모리 재시도 큐는 두지 않는다). 일반 이벤트도 죽은 커넥션을 첫 발행에서 감지하면 새 커넥션으로 한 번 더
 * 시도한다(WP-1973 리뷰 4). 위 best-effort 는 그대로다.
 */
@Slf4j
public class PostgresSseEventRelay implements SseEventRelay {

  /** 발행·수신이 함께 쓰는 NOTIFY 채널 — 채널을 나누면 순서가 깨질 수 있어 단일 채널로 고정한다. */
  private static final String CHANNEL = "wp_sse_relay";

  /** 작은 페이로드 — 표 없이 곧바로 NOTIFY 로 보낸다(왕복 1회, 이벤트마다 표 쓰기를 늘리지 않기 위해). */
  private static final String NOTIFY_SQL = "SELECT pg_notify('" + CHANNEL + "', ?)";

  /**
   * 큰 페이로드 — 아웃박스 행의 id 를 통지한다. {@code FROM r} 이 있어야 outer query 가 CTE 의 id 를 볼 수 있다(없으면 "column id
   * does not exist" — 실측 확인).
   */
  private static final String OUTBOX_SQL =
      "WITH r AS (INSERT INTO sse_relay_event(payload) VALUES (?) RETURNING id) "
          + "SELECT pg_notify('"
          + CHANNEL
          + "', '#' || id) FROM r";

  /** 아웃박스 도착 통지({@code #id})를 되읽는 쿼리 — 같은 수신 커넥션에서 이어 읽어 도착 순서를 지킨다. */
  private static final String OUTBOX_READ_SQL = "SELECT payload FROM sse_relay_event WHERE id = ?";

  /** 커넥션 연결 제한(초) — DB 가 응답하지 않아 스레드가 무한히 멈추지 않게 한다(WP-1973 리뷰 1·2). */
  private static final int CONNECT_TIMEOUT_SEC = 5;

  /** 소켓 읽기 제한(초) — 한 번의 JDBC 호출(발행 SQL·생존 확인)이 끝없이 블로킹되지 않게 한다(WP-1973 리뷰 1). */
  private static final int SOCKET_TIMEOUT_SEC = 15;

  /** 연결 재시도 지수 백오프 시작(1초). */
  private static final long INITIAL_BACKOFF_MS = 1_000L;

  /** 백오프 상한(30초) — 그 이상 막으면 발행이 오래 멈추고 이벤트가 계속 버려진다. */
  private static final long MAX_BACKOFF_MS = 30_000L;

  /**
   * 수신 대기 간격(50ms) — {@code getNotifications} 는 소켓에서 블로킹하며 통지가 오면 곧바로 깨어나고, 이 값은 「아무것도 없을 때」의 최대
   * 대기·종료 확인 주기로만 쓰인다(스펙이 요구하는 50ms 이하 주기).
   *
   * <p>실측(로컬 Testcontainers, 발행→emitter 도착, 워밍업 후 10회): 평균 2ms · 최대 6ms — 대기 간격이 아니라 소켓 대기 때문에 도착
   * 즉시 깨어남을 확인. 원격 DB 는 네트워크 왕복이 더해진다.
   */
  private static final int LISTEN_POLL_MS = 50;

  /**
   * 수신 커넥션 생존 확인 주기(ms) — LISTEN 커넥션은 읽기만 해서 반쯤 열린 죽음을 못 잡는다(WP-1973 리뷰 2). 기본 30초, 테스트는 짧게 줄여 재연결
   * 경로를 시간 안에 겨눈다.
   */
  private static final long LISTEN_KEEPALIVE_MS = 30_000L;

  /**
   * 첫 LISTEN 시도가 끝날 때까지의 대기 상한 — {@link #awaitFirstListen} (테스트 전용)이 쓴다. 운영 배선({@link #onMessage})은
   * 호출부를 막지 않으므로 기다리지 않는다(WP-1973 리뷰 — 기동 중 최대 10초 블로킹 제거). 상한은 10초고, DB 가 커넥션을 거절하면
   * connectTimeout(5s) 안에 실패해 그보다 먼저 끝난다.
   */
  private static final long FIRST_LISTEN_WAIT_MS = 10_000L;

  /** 발행 큐 크기 — DB 가 멈춘 동안 쌓이는 이벤트를 OOM 없이 받는다(넘치면 경고와 함께 버린다). */
  private static final int PUBLISH_QUEUE_CAPACITY = 4_096;

  /** 큐를 비울 때까지 기다리는 최대 시간(ms) — 닫힘 신호(보안)에만 쓴다(일반 이벤트는 기다리지 않는다). */
  private static final long CLOSE_ENQUEUE_WAIT_MS = 1_000L;

  /** 발행 스레드의 빈 큐 대기(ms) — 닫힘 신호를 빨리 감지하기 위한 폴 간격. */
  private static final long PUBLISH_POLL_MS = 200L;

  /** 전달 스트라이프 수 — 대상별로 나눠 느린 클라이언트가 다른 대상의 전달을 막지 않게 한다(WP-1973 리뷰 3). */
  private static final int DELIVERY_STRIPES = 4;

  /** 전달 스트라이프마다 큐 크기 — 멈춘 클라이언트 때문에 메모리가 늘지 않게 한다(넘치면 경고와 함께 버린다). */
  private static final int DELIVERY_QUEUE_CAPACITY = 1_024;

  private final String url;
  private final String username;
  private final String password;

  /** 수신 커넥션 생존 확인 주기(ms) — 운영은 30초, 테스트는 짧게 줄여 재연결을 시간 안에 검증한다(WP-1973 리뷰 2). */
  private final long listenKeepaliveMs;

  /** 발행 순서 락 — 발행 스레드(·닫기)만 쓰므로 요청 스레드는 여기서 시간을 쓰지 않는다. */
  private final Object lock = new Object();

  /** 수신 스레드 시작 락 — 리스너 스레드는 한 번만 뜬다. */
  private final Object listenerLock = new Object();

  /** 발행 큐 — 요청 스레드는 여기에만 넣고(리뷰 1), 발행 스레드가 빼서 JDBC 를 한다. */
  private final ArrayBlockingQueue<RelayMessage> publishQueue =
      new ArrayBlockingQueue<>(PUBLISH_QUEUE_CAPACITY);

  /** 발행 스레드 — 큐를 순서대로 비워 발행한다(파드 안 발행 순서 = 큐 순서 = NOTIFY 도착 순서). 데몬. */
  private final Thread publisherThread;

  /** 전달 스트라이프 — 받는 사람(키)으로 나뉜 단일 스레드 실행자들(각 큐 FIFO 라 그 사람 안 순서 유지). 데몬. */
  private final ThreadPoolExecutor[] deliveryStripes;

  /** 전용 발행 커넥션(autoCommit) — null 이면 아직 안 잡았거나 실패 후 재시도 대기 중이다. lock 을 지킨다. */
  private Connection connection;

  /** 다음 연결 시도가 허용되는 시각 — 그 전까지는 백오프 대기로 발행을 버린다. lock 을 지킨다. */
  private long retryAfterMs;

  /** 다음 연결 실패 때의 대기 시간(지수 백오프 1s→2s→…→30s 상한). lock 을 지킨다. */
  private long backoffMs = INITIAL_BACKOFF_MS;

  /** 도착 메시지 수신자 — 전달 스레드에서 부른다. */
  private volatile Consumer<RelayMessage> receiver;

  /** 수신(데몬) 스레드 — listenerLock 안에서만 읽고 쓴다(한 번만 뜬다). */
  private Thread listenerThread;

  /** 중계가 닫혔는지 — 컨텍스트 종료 후의 발행·수신·전달을 모두 막는다. */
  private volatile boolean closed;

  /**
   * 이 파드(이 중계 인스턴스)의 식별자 — 닫힘 신호에만 실어 보낸다({@link RelayMessage#withPublisher}). 발행 파드도 자기 NOTIFY 를
   * 되받아 {@code closeLocal} 을 한 번 더 부르는데, 그 사이 재연결한 스트림까지 다시 닫히므로 자기가 보낸 것을 제외한다(WP-1973 리뷰 3차 선택).
   */
  private final String publisherId = UUID.randomUUID().toString();

  /** 수신 커넥션의 백엔드 pid — LISTEN 성공 후 갱신, 끊기면 -1(테스트가 강제 종료로 재연결을 겨눌 때 쓴다). */
  private volatile int listenerBackendPid = -1;

  /** 첫 LISTEN 시도(성공·실패 모두)가 끝나면 열리는 래치 — 테스트가 {@link #awaitFirstListen} 으로 수신 시작을 기다리는 데 쓴다. */
  private final CountDownLatch firstListenAttempt = new CountDownLatch(1);

  /** 커넥션 정보로 중계를 만든다 — 생존 확인 주기 기본값(30초)을 쓴다. 자세한 동작은 아래 패키지 전용 생성자를 본다. */
  public PostgresSseEventRelay(String url, String username, String password) {
    this(url, username, password, LISTEN_KEEPALIVE_MS);
  }

  /**
   * 커넥션 정보와 생존 확인 주기로 중계를 만든다 — 커넥션은 여기서 잡지 않고 첫 발행·수신 때 지연 생성한다(기동이 DB 연결 상태에 끓이지 않게). 발행 스레드와 전달
   * 스트라이프는 여기서 띄운다(두 번째 파드도 같은 생성자로 만든다).
   *
   * @param url JDBC URL({@code spring.datasource.url}) — 타임아웃 파라미터를 덧붙여 쓴다
   * @param username 접속 유저({@code spring.datasource.username})
   * @param password 접속 비밀번호({@code spring.datasource.password})
   * @param listenKeepaliveMs 수신 커넥션 생존 확인 주기 — 테스트가 짧게 줄여 재연결 경로를 겨눌 때 쓴다(패키지 전용)
   */
  PostgresSseEventRelay(String url, String username, String password, long listenKeepaliveMs) {
    this.url = withTimeouts(url);
    this.username = username;
    this.password = password;
    this.listenKeepaliveMs = listenKeepaliveMs;
    this.deliveryStripes = newDeliveryStripes();
    this.publisherThread = new Thread(this::publishLoop, "sse-relay-publish");
    this.publisherThread.setDaemon(true);
    this.publisherThread.start();
  }

  /**
   * JDBC URL 에 연결 제한을 건다(WP-1973 리뷰 1·2) — 발행·수신이 함께 쓰는 URL 이라 한 곳에서 넣는다. 이미 있는 파라미터는 덮어쓰지 않는다 —
   * pgjdbc 는 마지막 값을 쓰므로 운영자가 직접 건 타임아웃을 우리가 조용히 바꾸지 않기 위함이다.
   */
  static String withTimeouts(String url) {
    StringBuilder withTimeouts = new StringBuilder(url);
    String separator = url.contains("?") ? "&" : "?";
    if (!url.contains("connectTimeout=")) {
      withTimeouts.append(separator).append("connectTimeout=").append(CONNECT_TIMEOUT_SEC);
      separator = "&";
    }
    if (!url.contains("socketTimeout=")) {
      withTimeouts.append(separator).append("socketTimeout=").append(SOCKET_TIMEOUT_SEC);
    }
    return withTimeouts.toString();
  }

  /**
   * 메시지를 중계한다 — 트랜잭션 중이면 커밋 뒤로 미루고(롤백된 변경이 이벤트로 새지 않게), 커밋 콜백·트랜잭션 밖이면 바로 발행 큐에 넣는다. 요청 스레드는 큐에 넣기만
   * 하므로 JDBC 로 멈추지 않는다(리뷰 1). 실패는 로그로만 남기고 호출부로 예외를 밀어내지 않는다(발행은 best-effort — {@link
   * SseEventRelay} 계약).
   */
  @Override
  public void publish(RelayMessage message) {
    if (AfterCommit.inCommitCallback()) {
      // 커밋 콜백 안 — 이미 커밋됐으므로 미루지 않는다. afterCompletion 으로 밀면 같은 콜백의 다른 발행과 순서가 엇갈린다(WP-1973 리뷰 5,
      // WP-874 링크 미리보기 순서).
      enqueue(message);
      return;
    }
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(new DeferredPublication(message));
    } else {
      enqueue(message);
    }
  }

  /**
   * 커밋 뒤로 미루는 발행 한 건 — 트랜잭션 안의 {@code publish} 가 등록한다. afterCommit 과 커밋 확정(afterCompletion) 중 먼저 온
   * 쪽에서 한 번만 발행한다.
   */
  private class DeferredPublication implements TransactionSynchronization {

    private final RelayMessage message;

    /** 한 번만 보낸다 — 두 경로가 같은 메시지를 두 번 발행하지 않게 한다. */
    private boolean sent;

    private DeferredPublication(RelayMessage message) {
      this.message = message;
    }

    @Override
    public void afterCommit() {
      sendOnce();
    }

    /**
     * 커밋 확정 시 보충 발행 — 다른 컴포넌트의 커밋 콜백({@link AfterCommit} 안의 fanOut 등)에서 다시 publish 가 불리면
     * afterCommit 스냅샷이 이미 복사된 뒤라 그 발행은 afterCommit 을 놓친다(Spring 7). 놓친 발행이 새지 않게 커밋
     * 확정(STATUS_COMMITTED)에서 보충하고, 롤백에서는 보내지 않는다.
     */
    @Override
    public void afterCompletion(int status) {
      if (status == TransactionSynchronization.STATUS_COMMITTED) sendOnce();
    }

    private void sendOnce() {
      if (sent) return;
      sent = true;
      enqueue(message);
    }
  }

  /**
   * 발행 큐에 넣는다 — 닫힘 신호(보안)는 큐가 가득 차도 잠깐 기다려 넣고, 그 밖은 넘치면 경고와 함께 버린다(발행은 best-effort — 큐가 가득 찼다는 것은
   * DB 경로가 이미 오래 멈췄다는 뜻이다). 닫힘 신호마저 못 넣으면 유실이 눈에 띄게 남아야 하므로 error 로 남긴다 — 일반 이벤트의 경고와는 레벨·문구가
   * 갈린다(WP-1973 리뷰: 닫힘 신호 유실은 error 계약).
   */
  private void enqueue(RelayMessage message) {
    if (closed) return;
    boolean closeTarget = RelayMessage.isCloseTarget(message.target());
    // 닫힘 신호에만 발행 파드를 싣는다 — 자기 NOTIFY 로 돌아온 것을 그 파드가 제외하는 데 쓴다(이벤트는 형식을 늘리지 않는다).
    RelayMessage outgoing = closeTarget ? message.withPublisher(publisherId) : message;
    if (publishQueue.offer(outgoing)) return;
    if (closeTarget) {
      try {
        if (publishQueue.offer(outgoing, CLOSE_ENQUEUE_WAIT_MS, TimeUnit.MILLISECONDS)) return;
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      log.error(
          "SSE 중계 발행 큐가 가득 차 닫힘 신호를 넣지 못했다({}건) — 유실됐다(타깃 {})",
          PUBLISH_QUEUE_CAPACITY,
          message.target());
      return;
    }
    log.warn("SSE 중계 발행 큐가 가득 찼다({}건) — 이벤트를 버린다(타깃 {})", PUBLISH_QUEUE_CAPACITY, message.target());
  }

  /**
   * 발행 스레드 — 큐를 순서대로 비워 {@link #send} 로 보낸다. 여기서만 JDBC 를 하므로 요청 스레드(트랜잭션 커밋 콜백 포함)는 블로킹되지
   * 않는다(WP-1973 리뷰 1).
   */
  private void publishLoop() {
    while (!closed && !Thread.currentThread().isInterrupted()) {
      try {
        RelayMessage message = publishQueue.poll(PUBLISH_POLL_MS, TimeUnit.MILLISECONDS);
        if (message != null) send(message);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt(); // close() 가 깨운 것 — 재시도하지 않는다
      } catch (RuntimeException e) {
        log.warn("SSE 중계 발행 스레드 오류 — 다음 메시지로 넘어간다: {}", e.getMessage());
      }
    }
  }

  /**
   * 수신자 등록 — 등록과 동시에 수신(LISTEN) 스레드를 띄우고 곧바로 돌아온다. 호출부(생성기·{@code @PostConstruct} 배선)를 막지 않는 것이 목표다
   * — DB 가 느리면 기동이 그만큼 늦어지기 때문이다. 등록과 실제 LISTEN 성공 사이의 짧은 빈틈은 best-effort 계약 안이고, 그 빈틈을 없애야 하는 테스트는
   * {@link #awaitFirstListen} 으로 스스로 기다린다(WP-1973 리뷰 — 첫 LISTEN 기동 대기를 호출부에서 뺐다).
   */
  @Override
  public void onMessage(Consumer<RelayMessage> receiver) {
    this.receiver = receiver;
    startListener();
  }

  /**
   * 첫 LISTEN 시도(성공·실패 모두)가 끝날 때까지 기다린다 — 등록 직후 바로 발행해야 하는 테스트가 쓰는 패키지 전용 도구다(상한 {@link
   * #FIRST_LISTEN_WAIT_MS}, 커넥션 연결 제한으로 실제 대기는 짧다). 운영 배선은 기다리지 않는다(위).
   */
  void awaitFirstListen() {
    try {
      if (!firstListenAttempt.await(FIRST_LISTEN_WAIT_MS, TimeUnit.MILLISECONDS)) {
        log.warn("SSE 중계 첫 LISTEN 시도가 {}ms 안에 끝나지 않았다 — 수신 시작을 기다리지 않고 진행한다", FIRST_LISTEN_WAIT_MS);
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  /** 수신 리스너의 백엔드 pid — LISTEN 성공 후 갱신, 연결이 없으면 -1. 테스트가 강제 종료로 재연결을 겨눌 때 쓴다(패키지 전용). */
  int listenerBackendPid() {
    return listenerBackendPid;
  }

  /**
   * 컨텍스트가 내려가면 발행·수신 스레드와 전달 스트라이프를 멈추고 전용 커넥션을 닫는다 — 컨텍스트 반복 기동에서 누수를 막는다. DB 가 멈춘 채로 종료되면 발행 스레드가
   * JDBC 안에서 최대 socketTimeout(15초) 만큼 늦어질 수 있다 — K8s 종료 유예(30초) 안이긴 하나, 그 사이 큐에 남은 메시지는 버려진다(아래 유실
   * 경고로 확인).
   */
  @PreDestroy
  public void close() {
    closed = true;
    firstListenAttempt.countDown(); // 아직 한 번도 시도하지 않았어도 대기 중인 onMessage 를 깨운다
    Thread listen;
    synchronized (listenerLock) {
      listen = listenerThread;
    }
    if (listen != null) {
      listen.interrupt();
      joinQuietly(listen);
    }
    publisherThread.interrupt();
    joinQuietly(publisherThread);
    int leftover = publishQueue.size();
    if (leftover > 0) {
      // 닫히는 순간 큐에 남은 메시지(닫힘 신호 포함) 는 보내지 않는다 — 배포 시 유실이 보이게 경고로 남긴다.
      log.warn("SSE 중계 종료 — 발행 큐의 메시지 {}건을 보내지 않고 버린다", leftover);
    }
    for (ThreadPoolExecutor stripe : deliveryStripes) stripe.shutdownNow();
    synchronized (lock) {
      discardConnection();
    }
  }

  /** 스레드가 끝날 때까지 기다린다 — 수신 대기(50ms)·발행 폴(200ms) 안에서 빠져나오므로 2초면 충분하다. */
  private static void joinQuietly(Thread thread) {
    try {
      thread.join(2_000L);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  /**
   * 전달 스트라이프 만들기 — 각 줄은 단일 스레드 + FIFO 큐라 같은 대상의 순서가 지켜지고, 한 줄이 멈춰도 나머지는 독립이다(리뷰 3). 큐가 가득 차면 예외를
   * 던지는 AbortPolicy 를 써서({@link #deliver} 로 예외가 넘어온다) target 을 적은 경고를 한 곳에서만 남긴다.
   */
  private static ThreadPoolExecutor[] newDeliveryStripes() {
    ThreadPoolExecutor[] stripes = new ThreadPoolExecutor[DELIVERY_STRIPES];
    for (int i = 0; i < DELIVERY_STRIPES; i++) {
      final int index = i;
      stripes[i] =
          new ThreadPoolExecutor(
              1,
              1,
              0L,
              TimeUnit.MILLISECONDS,
              new ArrayBlockingQueue<>(DELIVERY_QUEUE_CAPACITY),
              runnable -> {
                Thread thread = new Thread(runnable, "sse-relay-deliver-" + index);
                thread.setDaemon(true);
                return thread;
              },
              new ThreadPoolExecutor.AbortPolicy());
    }
    return stripes;
  }

  /**
   * 수신 스레드를 한 번만 뜬다 — 데몬 스레드라 JVM 종료를 붙잡지 않는다. 호출부를 막지 않는다(첫 LISTEN 대기는 {@link #awaitFirstListen} 이
   * 테스트에서만 한다).
   */
  private void startListener() {
    synchronized (listenerLock) {
      if (closed || listenerThread != null) return;
      listenerThread = new Thread(this::listenLoop, "sse-relay-listen");
      listenerThread.setDaemon(true);
      listenerThread.start();
    }
  }

  /**
   * 수신 루프 — 커넥션을 잡고 LISTEN 등록 후 통지를 읽는다. 끊김·실패는 닫고 지수 백오프(1s→30s 상한) 후 재등록하고, 닫힘(close) 또는 인터럽트에서만
   * 빠져나온다. 루프 밖 예외로 스레드가 죽지 않게 모든 실패를 안에서 받아 재시도한다.
   */
  private void listenLoop() {
    long listenBackoffMs = INITIAL_BACKOFF_MS;
    while (!closed && !Thread.currentThread().isInterrupted()) {
      Connection listen = null;
      try {
        listen = DriverManager.getConnection(url, username, password);
        try (Statement stmt = listen.createStatement()) {
          stmt.execute("LISTEN " + CHANNEL); // 채널 등록 — 세션 수준이라 Statement 를 닫아도 유지된다
        }
        listenerBackendPid = listen.unwrap(PGConnection.class).getBackendPID();
        firstListenAttempt.countDown();
        listenBackoffMs = INITIAL_BACKOFF_MS; // 성공했으니 다음 실패는 다시 1초부터
        receiveLoop(listen); // 끊김·닫힘에서 예외 또는 반환으로 빠져나온다
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      } catch (Exception e) {
        if (!closed) {
          log.warn("SSE 중계 수신 커넥션 실패 — {}ms 후 LISTEN 재등록: {}", listenBackoffMs, e.getMessage());
          firstListenAttempt.countDown(); // 실패도 「시도 끝」 — 대기자를 깨운다
        }
      } finally {
        closeQuietly(listen);
        listenerBackendPid = -1;
      }
      if (closed || Thread.currentThread().isInterrupted()) break;
      if (!sleepQuietly(listenBackoffMs)) break; // 인터럽트 = close — 재시도하지 않는다
      listenBackoffMs = Math.min(listenBackoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  /**
   * 통지 읽기 — 50ms 간격으로 소켓을 기다리고(통지가 오면 곧바로 깨어난다) 도착한 만큼 처리한다. 같은 채널의 도착 순서를 그대로 지므로 발행 순서가 수신 순서가
   * 된다. 30초마다 생존 확인을 얹어 반쯤 열린 죽음도 재연결로 보낸다(WP-1973 리뷰 2).
   */
  private void receiveLoop(Connection listen) throws SQLException, InterruptedException {
    PGConnection pg = listen.unwrap(PGConnection.class);
    long nextKeepaliveAt = System.currentTimeMillis() + listenKeepaliveMs;
    while (!closed && !Thread.currentThread().isInterrupted()) {
      PGNotification[] notes = pg.getNotifications(LISTEN_POLL_MS);
      for (PGNotification note : notes) handleNotification(listen, note);
      if (System.currentTimeMillis() >= nextKeepaliveAt) {
        keepAlive(listen); // 실패(SQLException)는 루프 밖 재연결 백오프로 그대로 넘어간다
        nextKeepaliveAt = System.currentTimeMillis() + listenKeepaliveMs;
      }
    }
  }

  /**
   * 수신 커넥션 생존 확인(WP-1973 리뷰 2) — LISTEN 커넥션은 읽기만 하기 때문에, 반쯤 열린 죽음(상대가 사라져도 읽기가 빈 배열만 돌려줌)을 끊기로 잡지
   * 못하고 그 파드는 이벤트·닫힘 신호를 영구히 놓친다. 주기 {@code SELECT 1} 이 그 죽음을 SQLException 으로 드러내 재연결 백오프로 보낸다(패키지
   * 전용 — 테스트가 끊긴 커넥션에서 실제로 던지는지 본다).
   */
  static void keepAlive(Connection listen) throws SQLException {
    try (Statement stmt = listen.createStatement()) {
      stmt.execute("SELECT 1");
    }
  }

  /**
   * 통지 하나 처리 — {@code #id} 면 아웃박스 행을 같은 커넥션에서 이어 읽고, 아니면 통지 값을 그대로 해석한다. 아웃박스 조회의 SQLException 도
   * 여기로 올라와 로그로 남는다(가져오기 안에서 삼키지 않는다 — 행 없음과 조회 실패를 구분할 수 있게). 해석 실패는 경고로 끝나고 스레드를 죽이지 않는다(수신은
   * best-effort). 전달 자체는 전달 스트라이프가 맡는다(리뷰 3).
   */
  private void handleNotification(Connection listen, PGNotification note) {
    try {
      String raw = note.getParameter();
      String source;
      if (raw != null && raw.startsWith("#")) {
        source = readOutboxPayload(listen, raw.substring(1));
        if (source == null) {
          log.warn("SSE 중계 아웃박스 행을 찾지 못했다({}) — 건너뛴다", raw);
          return;
        }
      } else {
        source = raw;
      }
      deliver(RelayMessage.decode(source));
    } catch (Exception e) {
      log.warn("SSE 중계 수신 메시지 처리 실패 — 건너뛴다: {}", e.getMessage());
    }
  }

  /**
   * 로컬 전달은 리스너 스레드에서 바로 하지 않는다(WP-1973 리뷰 3) — 받는 사람(키) 로 나뉜 전달 스트라이프의 FIFO 큐에 넘긴다. 리스너는 계속 통지만 읽고,
   * 같은 받는 사람은 같은 줄에 가서 그 사람 안의 순서는 그대로다. 한 메시지에 여러 받는 사람이 있으면 부분집합으로 나눠 각각 그 사람의 줄로 보낸다(WP-1973 리뷰
   * — 받는 사람 단위).
   *
   * <p>나눈 부분집합은 <b>줄 번호로 묶어 줄마다 작업 하나</b>로 넘긴다(WP-1973 리뷰 3차) — 받는 사람 수만큼 작업을 넣으면 채널·스레드 멤버 전체
   * fanOut 처럼 천 단위가 한 줄의 큐(1024)를 넘겨 조용히 버려지기 때문이다. 묶이면 통지 하나당 최대 작업 4개라 큐 점유가 받는 사람 수가 아니라 메시지 수로
   * 계산된다.
   *
   * <p>자기 파드가 보낸 닫힘 신호는 제외한다 — 발행 파드는 로컬을 발행 직전에 이미 닫았는데(리뷰 2차), NOTIFY 왕복 중 재연결한 스트림을 되돌아온 유선 닫힘이
   * 다시 닫는다. 파드 id({@link RelayMessage#publisher()})는 이 골라내기에만 쓰고 수신자에는 넘기지 않는다 — 받는 쪽의 메시지 모양은 예전
   * 그대로다. 수신자 실패·큐 넘침은 로그로 끝난다(중계 best-effort), 그중 닫힘 신호의 유실만 error 로 남겨 발행 쪽 계약과 레벨을 맞춘다.
   */
  private void deliver(RelayMessage message) {
    Consumer<RelayMessage> target = receiver;
    if (target == null) return;
    Map<Integer, List<RelayMessage>> byStripe = new LinkedHashMap<>();
    for (RelayMessage part : message.perRecipient()) {
      if (RelayMessage.isCloseTarget(part.target()) && publisherId.equals(part.publisher())) {
        continue; // 자기가 보낸 닫힘 — 로컬은 발행할 때 이미 닫았다
      }
      // 파드 id 는 자기 닫힘을 골라내는 데만 쓰고 수신자에는 넘기지 않는다 — 받는 쪽의 메시지 모양은 예전과 같다.
      RelayMessage deliveryMessage = part.publisher() == null ? part : part.withPublisher(null);
      byStripe.computeIfAbsent(stripeIndex(part), index -> new ArrayList<>()).add(deliveryMessage);
    }
    if (byStripe.isEmpty()) return;
    int rejected = 0;
    for (Map.Entry<Integer, List<RelayMessage>> entry : byStripe.entrySet()) {
      List<RelayMessage> group = entry.getValue();
      try {
        deliveryStripes[entry.getKey()].execute(() -> deliverGroup(target, group));
      } catch (RejectedExecutionException e) {
        rejected += group.size(); // 줄 하나가 통째로 밀려났다 — 받는 사람 수만큼 센다
      }
    }
    if (rejected == 0) return;
    if (RelayMessage.isCloseTarget(message.target())) {
      log.error("SSE 중계 전달 큐가 가득 차 닫힘 신호 {}개를 받지 못했다 — 유실됐다(타깃 {})", rejected, message.target());
    } else {
      log.warn("SSE 중계 전달 큐가 가득 찼다 — 메시지 {}개를 버린다(타깃 {})", rejected, message.target());
    }
  }

  /** 줄 하나에 묶인 부분집합을 순서대로 수신자에게 넘긴다 — 한 메시지의 실패가 그 줄의 뒤를 멈추지 않는다(중계 best-effort). */
  private void deliverGroup(Consumer<RelayMessage> target, List<RelayMessage> group) {
    for (RelayMessage part : group) {
      try {
        target.accept(part);
      } catch (Exception e) {
        log.warn("SSE 중계 로컬 전달 실패 — 건너뛴다(target {}): {}", part.target(), e.getMessage());
      }
    }
  }

  /**
   * 전달 줄 번호 — 같은 받는 사람(키)은 늘 같은 줄에 가 그 사람 안의 전달 순서를 지킨다(키 하나짜리 부분집합에 대해서만 계산한다 — {@link
   * RelayMessage#perRecipient()} 로 여러 사람 메시지를 나눈 뒤). 키는 정렬해 키 「집합」이 같으면 같은 줄로 가게 한다(WP-1973 리뷰 —
   * 테스트가 서로 다른 줄의 메시지를 고르는 데도 쓴다).
   *
   * <p>{@code target} 에서는 닫힘 접미사({@link RelayMessage#CLOSE_SUFFIX})만 뺀다(WP-1973 리뷰 3차) — 같은 userId
   * 의 {@code user} 와 {@code user.close} 가 다른 줄로 가면 닫힘이 앞선 이벤트를 앞질러 그 사이 재연결한 스트림을 닫는다. 받는 사람만으로 줄을
   * 정하면 같은 사람의 이벤트와 닫힘이 늘 한 줄에 묶인다(user 계열은 userId, runner 계열은 (테넌트, 위치) 쌍). 잘라내기는 {@link
   * RelayMessage#isCloseTarget(String)} 이 인정하는 닫힘 타깃에만 한다 — 두 정의가 갈리지 않게 RelayMessage 쪽 접미사 불변식 한
   * 곳으로 묶는다.
   */
  static int stripeIndex(RelayMessage message) {
    String target = message.target();
    if (RelayMessage.isCloseTarget(target)) {
      target = target.substring(0, target.length() - RelayMessage.CLOSE_SUFFIX.length());
    }
    return Math.floorMod(
        (target + "|" + RelayMessage.canonicalKeys(message.keysJson())).hashCode(),
        DELIVERY_STRIPES);
  }

  /**
   * 아웃박스 행의 payload 를 같은 수신 커넥션에서 읽는다 — 행이 없으면 null(호출부가 경고로 남긴다). 조회 실패는 삼키지 않고 예외를 그대로 밀어낸다 — 삼키면
   * 「행이 없다」 로 바뀌어 실제 원인(SQL 실패)이 로그에서 사라진다(WP-1973 리뷰).
   */
  private static String readOutboxPayload(Connection listen, String id) throws SQLException {
    try (PreparedStatement stmt = listen.prepareStatement(OUTBOX_READ_SQL)) {
      stmt.setLong(1, Long.parseLong(id));
      try (ResultSet rs = stmt.executeQuery()) {
        return rs.next() ? rs.getString(1) : null;
      }
    }
  }

  /** 지정 시간만큼 잔다 — 인터럽트가 오면(닫힘 신호) false 를 돌려 재시도를 멈춘다. */
  private static boolean sleepQuietly(long ms) {
    try {
      Thread.sleep(ms);
      return true;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return false;
    }
  }

  /** 수신 커넥션을 조용히 닫는다 — 닫기 실패는 이미 끊긴 것으로 보고 디버그 로그로만 남긴다. */
  private static void closeQuietly(Connection conn) {
    if (conn == null) return;
    try {
      conn.close();
    } catch (SQLException e) {
      log.debug("SSE 중계 수신 커넥션 닫기 실패(이미 끊긴 것으로 보임): {}", e.getMessage());
    }
  }

  /**
   * 발행 커넥션에서 실제로 발행한다 — 락 안에서 실행해 발행 순서를 지킨다(재진입 가능), 준비·SQL 실패도 예외로 밀어내지 않는다. 일반 이벤트는
   * best-effort(게이트에 걸리면 warn 한 줄로 버리고, SQL 실패는 scheduleRetry 경고로 족하다)고, 닫힘 신호만 백오프 게이트를 무시한 재연결과 한
   * 번의 즉시 재시도를 더 거쳐 최종 실패를 error 로 남긴다(닫힘을 받지 못한 파드가 스트림을 유지하면 보안 토큰 회수가 한 파드에서만 일어난다 — WP-1973 리뷰
   * finding 1). 죽은 커넥션으로 첫 발행이 실패한 일반 이벤트도 새 커넥션으로 한 번 더 보낸다(리뷰 4).
   */
  private void send(RelayMessage message) {
    synchronized (lock) {
      if (closed) {
        // 컨텍스트 종료 뒤의 발행 — 새 커넥션을 살려 아무도 닫지 못하게 하는 누수를 막는다(WP-1973 리뷰 finding 2).
        return;
      }
      if (RelayMessage.isCloseTarget(message.target())) {
        // 첫 시도부터 게이트를 무시하고, 첫 실패(SQL 실패 포함) 뒤에도 한 번 더 즉시 재시도한다(닫힘 신호 전용 큐는 없다 — 발행 안에서만).
        if (attemptClose(message) || attemptClose(message)) return;
        log.error("SSE 중계 닫힘 신호 발행 실패 — 재연결과 즉시 재시도에도 보내지 못해 유실됐다(타깃 {})", message.target());
        return;
      }
      if (!ensureConnection(false)) {
        log.warn("SSE 중계 발행 실패 — 커넥션이 준비되지 않아 이벤트를 버린다(타깃 {})", message.target());
        return;
      }
      if (executePublish(message)) return;
      // isClosed() 로는 알 수 없는 죽은 커넥션이었다 — 새 커넥션으로 한 번 더 시도한다(리뷰 4: 첫 이벤트를 버리지 않는다).
      if (ensureConnection(true) && executePublish(message)) return;
      log.warn("SSE 중계 발행 실패 — 재시도에도 보내지 못해 이벤트를 버린다(타깃 {})", message.target());
    }
  }

  /** 닫힘 신호 발행 한 번 — 백오프 게이트를 무시하고 재연결을 시도한 뒤 SQL 을 한 번 실행한다. 락 안에서만 부른다. */
  private boolean attemptClose(RelayMessage message) {
    return ensureConnection(true) && executePublish(message);
  }

  /**
   * SQL 한 번 실행 — 성공 true, 실패 시 끊긴 커넥션 정리·백오프 갱신(scheduleRetry) 후 false. 락 안에서만 부른다. 인코딩은 한 번만
   * 한다(아웃박스 판정도 같은 결과를 쓴다 — WP-1973 리뷰: 두 번 encode).
   */
  private boolean executePublish(RelayMessage message) {
    String payload = message.encode();
    String sql = RelayMessage.needsOutbox(payload) ? OUTBOX_SQL : NOTIFY_SQL;
    try (PreparedStatement stmt = connection.prepareStatement(sql)) {
      stmt.setString(1, payload);
      stmt.executeQuery();
      return true;
    } catch (SQLException e) {
      scheduleRetry(e); // 끊긴 커넥션은 정리하고 백오프 후 새로 잡는다
      return false;
    }
  }

  /**
   * 발행 커넥션을 지연 생성한다 — 첫 발행(또는 끊김 이후)에만 잡고, 실패하면 지수 백오프(1s→30s 상한)로 다음 시도를 미룬다. 대기 중에는 일반 이벤트를
   * 버린다(재연결 중 이벤트는 재생하지 않는다 — best-effort). {@code bypassBackoff} 는 닫힘 신호와 죽은 커넥션 재시도가 대기 중에도 지금
   * 재연결을 시도하게 하는 값이다.
   */
  private boolean ensureConnection(boolean bypassBackoff) {
    try {
      if (connection != null && !connection.isClosed()) return true;
    } catch (SQLException e) {
      discardConnection(); // 닫힘 확인조차 실패 — 닫고 새로 잡는다(참조만 덮어쓰면 커넥션이 새지 않는다)
    }
    if (!bypassBackoff && System.currentTimeMillis() < retryAfterMs)
      return false; // 백오프 대기 — 시도하지 않는다
    try {
      connection = DriverManager.getConnection(url, username, password);
      connection.setAutoCommit(true); // 발행은 즉시 반영 — 트랜잭션으로 묶지 않는다
      retryAfterMs = 0;
      backoffMs = INITIAL_BACKOFF_MS;
      return true;
    } catch (SQLException e) {
      scheduleRetry(e);
      return false;
    }
  }

  /** 연결·발행 실패를 정리하고 지수 백오프(상한 30초)로 다음 재시도를 미룬다 — 실패 상황은 warn 로 남긴다. */
  private void scheduleRetry(SQLException e) {
    discardConnection();
    retryAfterMs = System.currentTimeMillis() + backoffMs;
    log.warn("SSE 중계 발행 커넥션 실패 — {}ms 후 재시도한다: {}", backoffMs, e.getMessage());
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  /** 끊긴 커넥션을 닫아 버린다 — 다음 발행이 새 커넥션으로 다시 잡는다. lock 안에서만 부른다. */
  private void discardConnection() {
    if (connection == null) return;
    try {
      connection.close();
    } catch (SQLException e) {
      log.debug("SSE 중계 발행 커넥션 닫기 실패(이미 끊긴 것으로 보임): {}", e.getMessage());
    }
    connection = null;
  }
}

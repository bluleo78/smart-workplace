package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import com.workplace.support.TestFixtures;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 고친 회차(override) 잠금 순서 경합(WP-1737) — override 일정 id 를 회차 날짜 없이 지우는 요청(#816 갈래)이 override 행을 먼저,
 * 마스터를 나중에 잠그고, 마스터 경유 「이 회차만 수정」은 마스터를 먼저, override 행(UPDATE)을 나중에 잠가 서로 역순으로 기다리면 교착(40P01)이 났다.
 *
 * <p>순서를 결정적으로 맞춘다: 막는 tx(풀 밖 커넥션)가 마스터 행을 쥔 채 → 수정(B)이 마스터 잠금을 기다림(B 세션 pid 로 관측) → 삭제(A)를 보내 잠금을
 * 기다림(A pid 로 관측) → 막는 tx 커밋. 행 잠금 대기열은 먼저 온 쪽이 먼저 얻으므로 B 가 마스터를 얻고 override 를 고치러 간다. 고치기 전에는 A 가
 * 이미 override 를 쥔 채 마스터를 기다려 교착이었고, 고친 뒤에는 A 도 마스터부터 기다리므로 차례로 끝난다. 결과가 커밋돼야 하는 흐름이라 @AfterEach 로
 * 정리한다.
 *
 * <p>잠그기 전에 읽은 마스터 역조회가 잠금을 기다리는 사이 낡을 수 있어, 잠근 뒤 다시 보고 달라졌으면 409 로 끝내는 것도 여기서 고정한다.
 */
class CalendarOverrideLockOrderRaceTest extends IntegrationTestBase {

  @Autowired CalendarEventService service;
  @Autowired CalendarEventExceptionRepository exceptionRepo;

  private static final OffsetDateTime BASE = OffsetDateTime.parse("2026-06-10T09:00:00Z");
  private static final OffsetDateTime OCC3 = BASE.plusWeeks(2);

  private Long userId;

  @AfterEach
  void cleanup() {
    if (userId == null) return;
    long uid = userId;
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(uid)).execute();
          baseDsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.eq(uid)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.eq(uid)).execute();
  }

  @Test
  void override_삭제와_마스터_경유_이_회차만_수정이_겹쳐도_교착_없이_차례로_끝난다() throws Exception {
    long master = createSeries();
    long overrideId = inTenant(() -> editOccurrence(master, "먼저 고친 회차").id());

    ExecutorService pool = Executors.newFixedThreadPool(2);
    // 막는 tx — 테스트 풀(최대 2)은 두 요청이 써야 하므로 풀 밖 커넥션으로 마스터 행을 쥔다. 두 요청이 모두 잠금 대기에 들어선 뒤 놓는다.
    try (Connection blocker = ownerConnection()) {
      blocker.setAutoCommit(false);
      try (PreparedStatement ps =
          blocker.prepareStatement("select id from calendar_event where id = ? for update")) {
        ps.setLong(1, master);
        assertThat(ps.executeQuery().next()).isTrue();
      }

      // B — 마스터 경유 「이 회차만 수정」. 마스터 잠금을 먼저 기다리게 해 대기열 맨 앞에 세운다.
      CompletableFuture<Integer> updatePid = new CompletableFuture<>();
      Future<Object> update =
          pool.submit(() -> inTenant(updatePid, () -> editOccurrence(master, "나중에 고친 회차")));
      awaitLockWait(updatePid, update);
      // A — override id 를 회차 날짜 없이 삭제(#816 갈래).
      CompletableFuture<Integer> deletePid = new CompletableFuture<>();
      Future<Object> delete =
          pool.submit(
              () ->
                  inTenant(
                      deletePid,
                      () -> {
                        service.delete(userId, overrideId, EditScope.THIS, null);
                        return null;
                      }));
      awaitLockWait(deletePid, delete);

      blocker.commit();

      // 둘 다 정상으로 끝나야 한다 — 교착이면 한쪽이 DeadlockLoser/CannotAcquireLock(40P01)으로 실패한다.
      assertThat(outcome(update)).as("이 회차만 수정").isNull();
      assertThat(outcome(delete)).as("override 삭제").isNull();
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }

    // 차례로 보낸 것과 같다 — 수정이 먼저 반영된 뒤 삭제가 그 회차를 취소로 바꾸고 override 일정을 지웠다.
    assertThat(inTenant(() -> exceptionRepo.isCancelled(master, OCC3))).isTrue();
    assertThat(inTenant(() -> exceptionRepo.findOverrideEventId(master, OCC3))).isEmpty();
    assertThat(
            inTenant(() -> baseDsl.fetchExists(CALENDAR_EVENT, CALENDAR_EVENT.ID.eq(overrideId))))
        .isFalse();
  }

  @Test
  void 마스터_잠금을_기다리는_사이_회차_매핑이_바뀌면_낡은_매핑으로_취소하지_않고_409() throws Exception {
    long master = createSeries();
    long overrideId = inTenant(() -> editOccurrence(master, "먼저 고친 회차").id());
    OffsetDateTime occ4 = BASE.plusWeeks(3);

    ExecutorService pool = Executors.newFixedThreadPool(1);
    // 막는 tx — 마스터 행을 쥔 채 이 override 의 회차 매핑을 3번째 → 4번째 회차로 옮긴다(커밋 전이라 삭제 요청의 첫 역조회는 옛 매핑을 본다).
    try (Connection blocker = ownerConnection()) {
      blocker.setAutoCommit(false);
      try (PreparedStatement ps =
          blocker.prepareStatement("select id from calendar_event where id = ? for update")) {
        ps.setLong(1, master);
        assertThat(ps.executeQuery().next()).isTrue();
      }
      try (PreparedStatement ps =
          blocker.prepareStatement(
              "update calendar_event_exception set occurrence_date = ? where override_event_id = ?")) {
        ps.setObject(1, occ4);
        ps.setLong(2, overrideId);
        assertThat(ps.executeUpdate()).isEqualTo(1);
      }

      // override id 를 회차 날짜 없이 삭제(#816 갈래) — 옛 매핑(3번째 회차)으로 마스터를 찾아 그 잠금을 기다린다.
      CompletableFuture<Integer> deletePid = new CompletableFuture<>();
      Future<Object> delete =
          pool.submit(
              () ->
                  inTenant(
                      deletePid,
                      () -> {
                        service.delete(userId, overrideId, EditScope.THIS, null);
                        return null;
                      }));
      awaitLockWait(deletePid, delete);

      blocker.commit();

      // 잠근 뒤 다시 본 매핑이 달라 409(IllegalStateException) — 고치기 전에는 낡은 3번째 회차를 취소하고 override 를 지웠다.
      assertThat(outcome(delete)).isInstanceOf(IllegalStateException.class);
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }

    // 아무것도 바뀌지 않았다 — 3번째 회차는 취소되지 않았고, override 일정과 4번째 회차 매핑이 그대로다.
    assertThat(inTenant(() -> exceptionRepo.isCancelled(master, OCC3))).isFalse();
    assertThat(inTenant(() -> exceptionRepo.findOverrideEventId(master, occ4)))
        .contains(overrideId);
    assertThat(
            inTenant(() -> baseDsl.fetchExists(CALENDAR_EVENT, CALENDAR_EVENT.ID.eq(overrideId))))
        .isTrue();
  }

  /** 매주 5회 반복 일정을 만들어 id 를 돌려준다. */
  private long createSeries() {
    userId = TestFixtures.createHuman(baseDsl);
    return inTenant(
        () ->
            service
                .create(
                    userId,
                    new CalendarEventRequest(
                        "주간 회의",
                        null,
                        BASE,
                        BASE.plusHours(1),
                        false,
                        null,
                        null,
                        null,
                        "FREQ=WEEKLY;COUNT=5",
                        null,
                        null))
                .id());
  }

  /** 마스터의 3번째 회차만 제목을 바꾼다(「이 회차만 수정」 — override 일정을 만들거나 고친다). */
  private com.workplace.calendar.dto.CalendarEventResponse editOccurrence(
      long master, String title) {
    return service.update(
        userId,
        master,
        new CalendarEventRequest(
            title, null, OCC3, OCC3.plusHours(1), false, null, null, null, null, null, null),
        EditScope.THIS,
        OCC3);
  }

  /** 작업이 던진 예외(정상 종료면 null)를 돌려준다. */
  private static Throwable outcome(Future<?> f) throws Exception {
    try {
      f.get(20, TimeUnit.SECONDS);
      return null;
    } catch (ExecutionException e) {
      return e.getCause();
    }
  }

  /** 풀 밖의 컨테이너 소유자 롤 커넥션 — 테스트 풀(최대 2)을 두 요청에 남겨 두려고 쓴다. */
  private static Connection ownerConnection() throws Exception {
    var db = PostgresTestContainer.INSTANCE;
    return DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
  }

  /**
   * 그 요청의 DB 세션(pid)이 잠금을 얻지 못하고 기다리는 상태가 될 때까지 기다린다(최대 10초) — 대기열 순서를 결정적으로 세우려고 쓴다. 풀 밖 커넥션으로
   * pg_locks 를 본다(RowLockWaits.awaitLockWaiter 와 같은 이유).
   *
   * <p>DB 전체의 「잠금 못 얻음」 수를 세면 같은 컨테이너를 쓰는 다른 세션(병렬 테스트 등)의 대기에 속아 순서가 틀어질 수 있다. 그래서 요청이 자기 tx 커넥션에서
   * 알려 준 pg_backend_pid() 의 대기만 본다.
   */
  private static void awaitLockWait(CompletableFuture<Integer> pid, Future<?> waiter)
      throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    int backendPid;
    try {
      backendPid = pid.get(10, TimeUnit.SECONDS);
    } catch (TimeoutException e) {
      throw new AssertionError("요청이 DB 세션을 열지 못했다: " + (waiter.isDone() ? outcome(waiter) : ""));
    }
    try (Connection c = ownerConnection();
        PreparedStatement ps =
            c.prepareStatement("select count(*) from pg_locks where not granted and pid = ?")) {
      ps.setInt(1, backendPid);
      while (System.nanoTime() < deadline) {
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next() && rs.getLong(1) > 0) return;
        }
        // 잠금에 닿기 전에 끝났으면 기다릴 이유가 없다 — 결과(예외)를 그대로 보인다.
        if (waiter.isDone()) {
          throw new AssertionError("잠금 대기 전에 끝났다: " + outcome(waiter));
        }
        Thread.sleep(20); // 잠금 대기 진입을 관측하는 폴링 간격 — 조건 대기다.
      }
    }
    throw new AssertionError("세션 " + backendPid + " 이 잠금 대기에 들어서지 않았다");
  }

  /**
   * {@link #inTenant(Supplier)} 와 같되, 본문 전에 그 tx 커넥션의 pg_backend_pid() 를 pid 로 알린다 — 잠금 대기 관측을 이
   * 요청의 세션으로 좁히려고 쓴다. 서비스의 쓰기 tx 는 바깥 tx 에 합류하므로(REQUIRED) 같은 커넥션·같은 pid 에서 잠금을 기다린다.
   */
  private <T> T inTenant(CompletableFuture<Integer> pid, Supplier<T> body) {
    return inTenant(
        () -> {
          pid.complete(baseDsl.fetchSingle("select pg_backend_pid()").get(0, Integer.class));
          return body.get();
        });
  }

  /** 테넌트 1 트랜잭션에서 실행한다(서비스 호출 스레드마다 TenantContext 를 세운다). */
  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(1L);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}

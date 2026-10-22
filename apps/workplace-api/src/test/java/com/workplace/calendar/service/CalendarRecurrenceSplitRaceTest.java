package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 반복 일정 「이 일정 및 이후 일정」 동시 요청 경합(WP-761) — 같은 회차에 THIS_AND_FOLLOWING 수정이 동시에 들어오면 둘 다 사전검증(회차가 규칙에
 * 있는지)을 통과한 뒤 각자 꼬리 시리즈를 새로 만들어, 같은 날짜부터 일정이 두 벌 생겼다. 차례로 보내면 늦은 쪽은 원본이 이미 잘려 400 이다.
 *
 * <p>순서를 결정적으로 맞춘다: A 가 시리즈를 나누고 커밋 전에 멈춤 → B 가 같은 원본을 고치려다 원본 행 잠금을 기다림(관측) → A 커밋. 수정 결과가 커밋돼야 하는
 * 흐름이라 롤백 격리 대신 @AfterEach 로 정리한다.
 */
class CalendarRecurrenceSplitRaceTest extends IntegrationTestBase {

  @Autowired CalendarEventService service;

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
  void 같은_회차를_동시에_이후_일정까지_수정하면_꼬리_시리즈는_하나만_생기고_늦은_쪽은_400() throws Exception {
    long master = createSeries();
    Throwable late = race(() -> split(master, "앞선 수정"), () -> split(master, "늦은 수정"));

    assertThat(late)
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("반복 일정에 없는 회차입니다");
    // 원본 + 꼬리 시리즈 하나 — 늦은 쪽이 두 번째 꼬리를 만들지 않았다.
    assertThat(eventCount()).isEqualTo(2);
  }

  @Test
  void 시리즈를_나누는_중에_같은_회차부터_삭제하면_늦은_삭제는_400_이고_새_꼬리는_남는다() throws Exception {
    long master = createSeries();
    Throwable late =
        race(
            () -> split(master, "앞선 수정"),
            () -> {
              service.delete(userId, master, EditScope.THIS_AND_FOLLOWING, OCC3);
              return null;
            });

    // 차례로 보냈을 때와 같다 — 원본은 이미 OCC3 앞에서 잘려 그 회차가 없다. 조용히 「삭제 성공」하고 새 꼬리를 남기지 않는다.
    assertThat(late)
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("반복 일정에 없는 회차입니다");
    assertThat(eventCount()).isEqualTo(2);
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

  /** 3번째 회차부터 제목을 바꿔 시리즈를 나눈다. */
  private Object split(long master, String title) {
    return service.update(
        userId,
        master,
        new CalendarEventRequest(
            title,
            null,
            OCC3,
            OCC3.plusHours(1),
            false,
            null,
            null,
            null,
            "FREQ=WEEKLY;COUNT=5",
            null,
            null),
        EditScope.THIS_AND_FOLLOWING,
        OCC3);
  }

  /**
   * first 를 tx 안에서 실행하고 커밋 전에 멈춘 채 second 를 다른 스레드로 보내, second 가 잠금을 기다리는 것을 본 뒤 first 를 커밋한다.
   * second 가 던진 예외(없으면 null)를 돌려준다.
   */
  private Throwable race(Supplier<Object> first, Supplier<Object> second) throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch releaseFirst = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<Object> a =
          pool.submit(
              () ->
                  inTenant(
                      () -> {
                        Object r = first.get();
                        firstDone.countDown();
                        RowLockWaits.awaitQuietly(releaseFirst);
                        return r;
                      }));
      assertThat(firstDone.await(10, TimeUnit.SECONDS)).isTrue();
      Future<Object> b = pool.submit(() -> inTenant(second));
      RowLockWaits.awaitLockWaiter(b);
      releaseFirst.countDown();
      a.get(10, TimeUnit.SECONDS);
      try {
        b.get(10, TimeUnit.SECONDS);
        return null;
      } catch (ExecutionException e) {
        return e.getCause();
      }
    } finally {
      releaseFirst.countDown();
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
  }

  private long eventCount() {
    long uid = userId;
    return inTenant(
        () -> (long) baseDsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.OWNER_ID.eq(uid)));
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

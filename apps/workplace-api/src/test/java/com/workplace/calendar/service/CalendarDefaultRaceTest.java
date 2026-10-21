package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 기본 캘린더 첫 생성 경합(WP-757) — 일정이 없는 사용자의 첫 요청 둘이 동시에 기본 캘린더를 만들면, 늦은 쪽이 유일 인덱스(uq_calendar_default)에
 * 걸려 409 로 실패했다. 늦은 쪽은 먼저 만든 기본 캘린더를 그대로 써야 한다.
 *
 * <p>순서를 결정적으로 맞춘다: A 가 기본 캘린더를 넣고 커밋 전에 멈춤 → B 가 같은 기본 캘린더를 넣으려다 유일 인덱스 잠금을 기다림(관측) → A 커밋. 기본
 * 캘린더는 커밋돼야 하는 흐름이라 롤백 격리 대신 @AfterEach 로 정리한다.
 */
class CalendarDefaultRaceTest extends IntegrationTestBase {

  @Autowired CalendarService calendarService;

  private Long userId;

  @AfterEach
  void cleanup() {
    if (userId == null) return;
    long uid = userId;
    cleanupInTenant(
        1L, () -> baseDsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.eq(uid)).execute());
    baseDsl.deleteFrom(USER).where(USER.ID.eq(uid)).execute();
  }

  @Test
  void 동시에_기본_캘린더를_만들면_늦은_쪽도_실패하지_않고_같은_캘린더를_받는다() throws Exception {
    userId = TestFixtures.createHuman(baseDsl);
    long uid = userId;
    CountDownLatch aInserted = new CountDownLatch(1);
    CountDownLatch releaseA = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<Long> a =
          pool.submit(
              () ->
                  inTenant(
                      () -> {
                        long id = calendarService.ensureDefault(uid);
                        aInserted.countDown();
                        RowLockWaits.awaitQuietly(releaseA);
                        return id;
                      }));
      assertThat(aInserted.await(10, TimeUnit.SECONDS)).isTrue();
      // A 는 아직 커밋 전 — B 는 기본 캘린더를 못 보고 넣으려다 A 의 유일 인덱스 항목을 기다린다.
      Future<Long> b = pool.submit(() -> inTenant(() -> calendarService.ensureDefault(uid)));
      RowLockWaits.awaitLockWaiter(b);
      releaseA.countDown();

      long idA = a.get(10, TimeUnit.SECONDS);
      long idB = b.get(10, TimeUnit.SECONDS);
      assertThat(idB).isEqualTo(idA);
      long defaults =
          inTenant(
              () ->
                  (long)
                      baseDsl.fetchCount(
                          CALENDAR, CALENDAR.OWNER_ID.eq(uid).and(CALENDAR.IS_DEFAULT.isTrue())));
      assertThat(defaults).isEqualTo(1);
    } finally {
      releaseA.countDown();
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
  }

  /** 테넌트 1 트랜잭션에서 실행한다(서비스 호출 스레드마다 TenantContext 를 세운다). */
  private <T> T inTenant(java.util.function.Supplier<T> body) {
    TenantContext.set(1L);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}

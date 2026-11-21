package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.tables.UserDashboard.USER_DASHBOARD;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.DashboardDevice;
import com.workplace.home.dto.DashboardWidgetConfig;
import com.workplace.home.exception.DashboardConflictException;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 행이 아직 없는(기본 레이아웃) 계정의 첫 저장 둘이 동시에 올 때(WP-1953) — 하나만 저장되고 하나는 409 다.
 *
 * <p>두 스레드가 각자 트랜잭션·테넌트로 같은 사용자·기기에 version 0 으로 저장한다. 행이 없어 UPDATE 는 둘 다 0행이고, INSERT … ON
 * CONFLICT DO NOTHING 이 먼저 넣은 쪽만 성공시킨다. 커밋이 필요해 클래스 단위 롤백 트랜잭션을 쓰지 않고 직접 정리한다.
 */
class DashboardSaveRaceTest extends IntegrationTestBase {

  @Autowired DashboardService service;

  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    baseDsl.deleteFrom(USER_DASHBOARD).where(USER_DASHBOARD.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "dr-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "dr")
            .set(USER.EMAIL, "dr-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  @Test
  void 행_없음_첫_저장_동시_둘은_하나만() throws Exception {
    long userId = user();
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Callable<Object> task =
          () -> {
            TenantContext.set(1L);
            try {
              start.await(10, TimeUnit.SECONDS);
              return new TransactionTemplate(txManager)
                  .execute(
                      st ->
                          service.save(
                              userId,
                              DashboardDevice.DESKTOP,
                              List.of(new DashboardWidgetConfig("my_tasks", 5, false)),
                              0L));
            } catch (Exception e) {
              return e;
            } finally {
              TenantContext.clear();
            }
          };
      Future<Object> a = pool.submit(task);
      Future<Object> b = pool.submit(task);
      start.countDown();
      List<Object> results = List.of(a.get(30, TimeUnit.SECONDS), b.get(30, TimeUnit.SECONDS));
      long conflicts =
          results.stream().filter(r -> r instanceof DashboardConflictException).count();
      long successes = results.stream().filter(r -> !(r instanceof Exception)).count();
      assertThat(successes).as("결과: %s", results).isEqualTo(1);
      assertThat(conflicts).as("결과: %s", results).isEqualTo(1);
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }
}

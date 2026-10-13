package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-55 메모리 동시성 테스트의 공통 틀. 각 스레드가 자기 트랜잭션을 실제로 커밋해 경합해야 하므로 @Transactional 을 쓰지 않고, 정리는 tenant
 * 트랜잭션(cleanupInTenant)으로 한다. 상한 경합(AiMemoryConcurrencyTest)과 되돌리기 경합(AiMemoryUndoConcurrencyTest)이
 * 같은 틀을 쓴다.
 */
abstract class AiMemoryRaceTestSupport extends IntegrationTestBase {

  @Autowired protected DSLContext dsl;

  /** 테스트가 만든 사용자 — 테스트 끝에 메모리·대화·사용자를 지운다. */
  protected final List<Long> users = new ArrayList<>();

  /** 테스트 사용자 정리 — 커밋된 데이터라 직접 지운다(대화 → 메모리 → 사용자 순). */
  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (users.isEmpty()) return;
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute();
          dsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.in(users)).execute();
        });
    dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    users.clear();
  }

  /** tenant#1 트랜잭션 안에서 실행하고 커밋한다(RLS GUC 주입). */
  protected <T> T inTenant(Supplier<T> s) {
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(st -> s.get());
  }

  /**
   * 같은 작업을 두 스레드가 장벽에서 동시에 출발해 돌리고 결과 문자열을 모아 돌려준다. 각 스레드에 tenant#1 을 걸어 준다. 시간 단언은 없고 대기 상한(10초)은
   * 교착 방지용 liveness 안전장치다.
   */
  protected List<String> raceTwice(Callable<String> work) throws Exception {
    CyclicBarrier start = new CyclicBarrier(2);
    Callable<String> task =
        () -> {
          TenantContext.set(1L);
          try {
            start.await(5, TimeUnit.SECONDS);
            return work.call();
          } finally {
            TenantContext.clear();
          }
        };
    ExecutorService pool = Executors.newFixedThreadPool(2);
    List<String> results = new ArrayList<>();
    try {
      for (Future<String> f : pool.invokeAll(List.of(task, task))) {
        results.add(f.get(10, TimeUnit.SECONDS));
      }
    } finally {
      pool.shutdownNow();
    }
    return results;
  }
}

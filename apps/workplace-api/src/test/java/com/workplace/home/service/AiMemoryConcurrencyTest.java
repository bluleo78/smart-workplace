package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-55 Review Focus 2: 49개에서 두 요청이 동시에 와도 50개를 넘지 않는다. 각 스레드가 자기 트랜잭션을 커밋해야 하므로 @Transactional 을
 * 쓰지 않고, 정리는 tenant 트랜잭션(cleanupInTenant)으로 한다.
 */
class AiMemoryConcurrencyTest extends IntegrationTestBase {

  @Autowired AiMemoryService service;
  @Autowired AiMemoryRepository repo;
  @Autowired DSLContext dsl;

  private final List<Long> users = new ArrayList<>();

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (users.isEmpty()) return;
    cleanupInTenant(
        1L, () -> dsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute());
    dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    users.clear();
  }

  /** tenant#1 트랜잭션 안에서 실행한다(RLS GUC 주입). */
  private <T> T inTenant(java.util.function.Supplier<T> s) {
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(st -> s.get());
  }

  @Test
  void 마흔아홉개에서_동시에_두_건을_추가해도_하나만_저장된다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    users.add(uid);
    inTenant(
        () -> {
          for (int i = 0; i < 49; i++) repo.insert(uid, "PREFERENCE", "m" + i, "USER", null);
          return null;
        });

    CyclicBarrier start = new CyclicBarrier(2);
    Callable<String> task =
        () -> {
          TenantContext.set(1L);
          try {
            start.await(5, TimeUnit.SECONDS);
            service.create(uid, "PREFERENCE", "동시 " + Thread.currentThread().threadId());
            return "ok";
          } catch (AiMemoryException e) {
            return e.code();
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

    assertThat(results).containsExactlyInAnyOrder("ok", "AI_MEMORY_FULL");
    assertThat(inTenant(() -> repo.count(uid))).isEqualTo(50);
  }
}

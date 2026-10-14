package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-380: 만료 정리 배치 — 기한 + 30일이 지난 행만 지운다(오늘 11/10 → 10/10 만료 삭제, 10/11·10/12·기한 없음 유지 — 경계 하루 차이를
 * 가른다), 활성 테넌트마다 GUC 를 주입해 지운다(ai_memory FORCE RLS). 배치가 자체 트랜잭션을 쓰므로 @Transactional 없이 커밋하고 직접
 * 정리한다.
 */
class AiMemoryExpiryCleanupTest extends IntegrationTestBase {

  private static final LocalDate TODAY = LocalDate.of(2026, 11, 10);

  @Autowired AiMemoryRepository repo;
  @Autowired AiMemoryExpiryCleanupScheduler scheduler;
  @MockitoBean AiMemoryClock clock;

  private final List<Long> users = new ArrayList<>();
  private long tenant2;

  @BeforeEach
  void setUp() {
    when(clock.today()).thenReturn(TODAY);
    tenant2 = TestFixtures.createTenant(baseDsl, "ACTIVE");
  }

  @AfterEach
  void tearDown() {
    for (long t : List.of(1L, tenant2)) {
      cleanupInTenant(
          t, () -> baseDsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute());
    }
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    // 다른 테스트의 테넌트 순회에 끼지 않게 비활성으로 돌린다.
    baseDsl.update(TENANT).set(TENANT.STATUS, "SUSPENDED").where(TENANT.ID.eq(tenant2)).execute();
  }

  /** 지정 테넌트 GUC 트랜잭션에서 실행한다(시드·조회용). */
  private <T> T inTenant(long tenantId, Supplier<T> work) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager).execute(s -> work.get());
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  private long user() {
    long uid = TestFixtures.createHuman(baseDsl);
    users.add(uid);
    return uid;
  }

  private long seed(long tenantId, long uid, LocalDate expiresOn) {
    return inTenant(
        tenantId,
        () ->
            repo.insert(uid, new NewMemory("PREFERENCE", "m", "USER", null, null, expiresOn)).id());
  }

  private List<Long> ids(long tenantId, long uid) {
    return inTenant(
        tenantId,
        () ->
            AiMemoryTestFixtures.allMemories(baseDsl, uid).stream()
                .map(AiMemoryRepository.Row::id)
                .toList());
  }

  @Test
  void 기한_뒤_30일이_지난_행만_모든_활성_테넌트에서_지운다() {
    long a = user();
    long gone = seed(1L, a, LocalDate.of(2026, 10, 10));
    long keep30 = seed(1L, a, LocalDate.of(2026, 10, 11));
    long keep29 = seed(1L, a, LocalDate.of(2026, 10, 12));
    long forever = seed(1L, a, null);
    long b = user();
    long gone2 = seed(tenant2, b, LocalDate.of(2026, 9, 1));
    long keep2 = seed(tenant2, b, LocalDate.of(2026, 11, 9));

    assertThat(scheduler.purgeAllTenants()).isGreaterThanOrEqualTo(2);

    assertThat(ids(1L, a)).containsExactlyInAnyOrder(keep30, keep29, forever).doesNotContain(gone);
    assertThat(ids(tenant2, b)).containsExactly(keep2).doesNotContain(gone2);
  }
}

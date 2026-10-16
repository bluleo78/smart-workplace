package com.workplace.home.service;

import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_CHANGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.SharedAiMemoryChangeRepository;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-386 공간 기록 90일 보관 — 만료 정리 배치의 공용 진입점이 활성 테넌트마다 91일 지난 기록만 지운다. 배치가 자체 트랜잭션을 쓰므로 트랜잭션 없이 커밋하고 직접
 * 정리한다. 존재하지 않는 프로젝트 id 를 공간으로 쓴다(기록 표에는 공간 FK 가 없다).
 */
class SharedAiMemoryChangeRetentionTest extends IntegrationTestBase {

  private static final long FAKE_PROJECT = 987_654_321L;

  @Autowired AiMemoryExpiryCleanupScheduler scheduler;
  @Autowired SharedAiMemoryChangeLog changeLog;
  @Autowired SharedAiMemoryChangeRepository changes;

  private final SpaceKey k = SpaceKey.of("PROJECT", FAKE_PROJECT);

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
  }

  @AfterEach
  void tearDown() {
    cleanupInTenant(
        1L,
        () ->
            baseDsl
                .deleteFrom(SHARED_AI_MEMORY_CHANGE)
                .where(SHARED_AI_MEMORY_CHANGE.SPACE_ID.eq(FAKE_PROJECT))
                .execute());
    TenantContext.clear();
  }

  private void record(String action, OffsetDateTime at) {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> changeLog.record(k, null, action, null, 1L, List.of(), null, at));
  }

  @Test
  void 배치_진입점은_91일_지난_공용_기록만_지운다() {
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    record(SharedAiMemoryChangeLog.ADDED, now.minusDays(91));
    record(SharedAiMemoryChangeLog.UPDATED, now.minusDays(89));

    assertThat(scheduler.purgeSharedChangesAllTenants()).isEqualTo(1);

    var left = new TransactionTemplate(txManager).execute(s -> changes.page(k, null, 10));
    assertThat(left).extracting(r -> r.action()).containsExactly(SharedAiMemoryChangeLog.UPDATED);
  }
}

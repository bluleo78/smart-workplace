package com.workplace.airun.capacity;

import static com.workplace.jooq.Tables.AI_CAPACITY_SAMPLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-1830 ai_capacity_sample 저장소·90일 보관 통합 시험. 보관 스케줄러가 자기 트랜잭션을 열어 미커밋 시드가 보이지 않으므로
 * {@code @Transactional} 없이 커밋된 행으로 검증한다.
 */
class AiCapacitySampleRepositoryTest extends IntegrationTestBase {

  @Autowired AiCapacitySampleRepository repo;
  @Autowired AiCapacitySampleRetentionScheduler retention;

  private static AiCapacitySample sample(OffsetDateTime at, int slotUsed) {
    return new AiCapacitySample(at, slotUsed, 8, 0, null, "[]", "{}");
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(1L, () -> baseDsl.deleteFrom(AI_CAPACITY_SAMPLE).execute());
  }

  @Test
  void insert_sameMinuteTwice_oneRow() {
    OffsetDateTime at = OffsetDateTime.now().truncatedTo(ChronoUnit.MINUTES);
    callInTenant(
        1L,
        () -> {
          repo.insert(sample(at, 3));
          return null;
        });
    callInTenant(
        1L,
        () -> {
          repo.insert(sample(at, 7));
          return null;
        });

    var rows = callInTenant(1L, () -> baseDsl.selectFrom(AI_CAPACITY_SAMPLE).fetch());
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getSlotUsed()).isEqualTo(3);
  }

  @Test
  void purge_91DaysOld_deleted_89DaysKept() {
    OffsetDateTime now = OffsetDateTime.now().truncatedTo(ChronoUnit.MINUTES);
    callInTenant(
        1L,
        () -> {
          repo.insert(sample(now.minusDays(91), 1));
          repo.insert(sample(now.minusDays(89), 2));
          return null;
        });

    retention.purge();

    var rows = callInTenant(1L, () -> baseDsl.selectFrom(AI_CAPACITY_SAMPLE).fetch());
    assertThat(rows).extracting(r -> r.getSlotUsed()).containsExactly(2);
  }

  @Test
  void rls_otherTenantRowInvisible() {
    long tid2 =
        baseDsl
            .fetchOne(
                "INSERT INTO tenant (slug, name, status) VALUES (?, 'RLS-CAP', 'ACTIVE') RETURNING id",
                "rls-cap-" + System.nanoTime())
            .get("id", Long.class);
    try {
      OffsetDateTime at = OffsetDateTime.now().truncatedTo(ChronoUnit.MINUTES);
      callInTenant(
          tid2,
          () -> {
            repo.insert(sample(at, 5));
            return null;
          });

      assertThat(callInTenant(1L, () -> baseDsl.fetchCount(AI_CAPACITY_SAMPLE))).isZero();
      assertThat(callInTenant(tid2, () -> baseDsl.fetchCount(AI_CAPACITY_SAMPLE))).isEqualTo(1);
    } finally {
      cleanupInTenant(tid2, () -> baseDsl.deleteFrom(AI_CAPACITY_SAMPLE).execute());
    }
  }
}

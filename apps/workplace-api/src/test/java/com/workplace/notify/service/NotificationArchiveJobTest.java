package com.workplace.notify.service;

import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 알림 자동 보관·90일 정리 작업 시험(WP-1690). 러너가 테넌트마다 REQUIRES_NEW 트랜잭션을 열어 미커밋 시드가 보이지 않으므로
 * {@code @Transactional} 없이 커밋된 행으로 검증하고, 끝에 시드 행을 지운다.
 */
class NotificationArchiveJobTest extends IntegrationTestBase {

  @Autowired NotificationArchiveJob job;

  private long tenant2;
  private long user;

  /** 시험이 남긴 알림을 두 테넌트에서 비운다. */
  @AfterEach
  void cleanup() {
    job.batchSize = NotificationArchiveJob.BATCH;
    for (long t : new long[] {1L, tenant2}) {
      if (t == 0) continue;
      cleanupInTenant(t, () -> baseDsl.deleteFrom(NOTIFICATION).execute());
    }
  }

  /** 시험용 두 번째 활성 테넌트(없으면 만든다 — tenant 행은 지울 수 없어 고정 slug 로 재사용). */
  private long ensureTenant2() {
    String slug = "notify-archive-job-2";
    Long existing =
        baseDsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(slug)).fetchOne(TENANT.ID);
    if (existing != null) return existing;
    return baseDsl
        .insertInto(TENANT)
        .set(TENANT.SLUG, slug)
        .set(TENANT.NAME, "Notify Archive Job 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return baseDsl
        .insertInto(USER)
        .set(USER.USERNAME, "naj_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Naj" + s)
        .set(USER.EMAIL, "naj_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 지정 테넌트에 알림 1건을 read_at·archived_at(일 전, null 이면 비움)과 함께 커밋해 넣고 id 를 돌려준다. */
  private long seed(long tenantId, Integer readDaysAgo, Integer archivedDaysAgo) {
    OffsetDateTime now = OffsetDateTime.now();
    return callInTenant(
        tenantId,
        () ->
            baseDsl
                .insertInto(NOTIFICATION)
                .set(NOTIFICATION.RECIPIENT_ID, user)
                .set(NOTIFICATION.ACTOR_ID, user)
                .set(NOTIFICATION.TYPE, NotificationType.PERSONAL_ASSISTANT_REVOKED.name())
                .set(NOTIFICATION.READ_AT, readDaysAgo == null ? null : now.minusDays(readDaysAgo))
                .set(
                    NOTIFICATION.ARCHIVED_AT,
                    archivedDaysAgo == null ? null : now.minusDays(archivedDaysAgo))
                .returning(NOTIFICATION.ID)
                .fetchOne()
                .getId());
  }

  private OffsetDateTime archivedAt(long tenantId, long id) {
    return callInTenant(
        tenantId,
        () ->
            baseDsl
                .select(NOTIFICATION.ARCHIVED_AT)
                .from(NOTIFICATION)
                .where(NOTIFICATION.ID.eq(id))
                .fetchOne(NOTIFICATION.ARCHIVED_AT));
  }

  private boolean exists(long tenantId, long id) {
    return callInTenant(
        tenantId,
        () ->
            baseDsl.fetchExists(
                baseDsl.selectOne().from(NOTIFICATION).where(NOTIFICATION.ID.eq(id))));
  }

  /** 모든 활성 테넌트에서 7일 지난 읽은 알림은 보관하고 91일 지난 보관 알림은 지운다. */
  @Test
  void job_archivesAndPurgesInEveryTenant() {
    tenant2 = ensureTenant2();
    user = seedUser();
    long[] tenants = {1L, tenant2};
    long[] toArchive = new long[2];
    long[] toPurge = new long[2];
    for (int i = 0; i < 2; i++) {
      toArchive[i] = seed(tenants[i], 8, null);
      toPurge[i] = seed(tenants[i], 100, 91);
    }

    job.run();

    for (int i = 0; i < 2; i++) {
      assertThat(archivedAt(tenants[i], toArchive[i])).isNotNull();
      assertThat(exists(tenants[i], toPurge[i])).isFalse();
    }
  }

  /** 묶음 크기(2)보다 대상(5)이 많아도 run() 한 번에 모두 보관한다. */
  @Test
  void job_drainsMoreThanOneBatch() {
    user = seedUser();
    job.batchSize = 2;
    List<Long> ids = new java.util.ArrayList<>();
    for (int i = 0; i < 5; i++) ids.add(seed(1L, 8, null));

    job.run();

    for (long id : ids) assertThat(archivedAt(1L, id)).isNotNull();
  }
}

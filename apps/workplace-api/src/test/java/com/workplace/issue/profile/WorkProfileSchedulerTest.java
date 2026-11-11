package com.workplace.issue.profile;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WORK_PROFILE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.support.AsyncPools;
import com.workplace.support.ExternalClientMockedTestBase;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.Executor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * WP-1485 — 업무 프로파일 매일 갱신 스케줄러. 활성 구성원의 저장된 프로파일만 스케줄러 스레드에서 차례로(동기) 다시 분석하고(행 없는 사람·떠난 사람은 건드리지
 * 않음), 08:00 서울 + ShedLock(2시간) 으로 선언됐는지 고정한다. 비-@Transactional — 러너가 REQUIRES_NEW 로 커밋된 데이터만 본다.
 *
 * <p>기본 테넌트에는 다른 테스트가 커밋한 행이 있을 수 있어 AI 호출 횟수 같은 전역 단언은 하지 않고, 이 테스트 사용자의 행으로만 확인한다.
 */
class WorkProfileSchedulerTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired WorkProfileScheduler scheduler;
  @Autowired WorkProfileRepository repository;

  @Autowired
  @Qualifier("workProfileExecutor")
  Executor workProfileExecutor;

  private long a;
  private long b;
  private long gone;

  @BeforeEach
  void seed() {
    a = withMembership(user("wfs-a"));
    b = withMembership(user("wfs-b"));
    // 워크스페이스 멤버십이 없는(떠난) 사람 — 행이 남아 있어도 갱신하지 않는다.
    gone = user("wfs-gone");
    // A·떠난 사람에만 저장본(FAILED)을 커밋한다 — B 는 행이 없다.
    for (long u : new long[] {a, gone}) {
      callInTenant(
          defaultTenantId(),
          () -> {
            OffsetDateTime now = OffsetDateTime.now().truncatedTo(ChronoUnit.MICROS);
            repository.claimPending(u, MeOverviewPeriod.MONTH, now, now.minusMinutes(10));
            repository.markFailed(
                u,
                MeOverviewPeriod.MONTH,
                now,
                MeOverviewPeriod.MONTH.resolve(LocalDate.parse("2026-11-11")),
                "old");
            return null;
          });
    }
  }

  @AfterEach
  void cleanup() {
    AsyncPools.awaitIdle(workProfileExecutor);
    cleanupInTenant(
        defaultTenantId(),
        () -> {
          dsl.deleteFrom(WORK_PROFILE).where(WORK_PROFILE.USER_ID.in(a, b, gone)).execute();
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(a, b, gone)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(a, b, gone)).execute();
        });
  }

  private long user(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return callInTenant(
        defaultTenantId(),
        () -> {
          Long id =
              dsl.insertInto(USER)
                  .set(USER.USERNAME, prefix + "-" + suffix)
                  .set(USER.PASSWORD, "pw")
                  .set(USER.NAME, prefix)
                  .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
                  .returning(USER.ID)
                  .fetchOne()
                  .getId();
          Long roleId =
              dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
          dsl.insertInto(USER_ROLE)
              .set(USER_ROLE.USER_ID, id)
              .set(USER_ROLE.ROLE_ID, roleId)
              .execute();
          return id;
        });
  }

  @Test
  void refreshAllTenants_refreshesStoredProfilesOfActiveMembersInline() {
    WorkProfileScheduler.Summary summary = scheduler.refreshAllTenants();

    assertThat(summary.targets()).isGreaterThanOrEqualTo(1);
    assertThat(summary.refreshed()).isGreaterThanOrEqualTo(1);
    // 워커 풀을 기다리지 않는다 — 스케줄러 스레드에서 동기로 처리해 돌아왔을 때 이미 결과가 저장돼 있다.
    var rowA = callInTenant(defaultTenantId(), () -> repository.find(a, MeOverviewPeriod.MONTH));
    var rowB = callInTenant(defaultTenantId(), () -> repository.find(b, MeOverviewPeriod.MONTH));
    var rowGone =
        callInTenant(defaultTenantId(), () -> repository.find(gone, MeOverviewPeriod.MONTH));
    assertThat(rowA).isPresent();
    // 끝낸 이슈가 없으니 AI 없이 빈 결과로 READY — 목 AI 를 불렀다면 빈 요약이라 FAILED 가 됐다.
    assertThat(rowA.get().status()).isEqualTo(WorkProfileStatus.READY);
    assertThat(rowA.get().totalCount()).isZero();
    assertThat(rowA.get().summary()).isNull();
    assertThat(rowB).isEmpty();
    // 떠난 사람의 행은 갱신하지 않아 그대로 FAILED.
    assertThat(rowGone).isPresent();
    assertThat(rowGone.get().status()).isEqualTo(WorkProfileStatus.FAILED);
    assertThat(rowGone.get().error()).isEqualTo("old");
  }

  @Test
  void refreshDaily_isLockedAndScheduledAt0800Seoul() throws Exception {
    var m = WorkProfileScheduler.class.getMethod("refreshDaily");
    Scheduled s = m.getAnnotation(Scheduled.class);
    assertThat(s.cron()).isEqualTo("0 0 8 * * *");
    assertThat(s.zone()).isEqualTo("Asia/Seoul");
    SchedulerLock lock = m.getAnnotation(SchedulerLock.class);
    assertThat(lock).isNotNull();
    // 차례로 도는 긴 회차 도중 잠금이 풀리지 않게 넉넉히.
    assertThat(lock.lockAtMostFor()).isEqualTo("PT2H");
  }
}

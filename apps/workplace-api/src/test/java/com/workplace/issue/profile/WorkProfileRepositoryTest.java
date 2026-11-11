package com.workplace.issue.profile;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WORK_PROFILE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.metrics.MetricsPeriod;
import com.workplace.issue.profile.WorkProfileCalc.Count;
import com.workplace.issue.profile.WorkProfileRepository.Key;
import com.workplace.issue.profile.WorkProfileRepository.WorkProfileReady;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 업무 프로파일 저장 리포지토리(WP-1485) — 점유·저장·실패 보존·하루 계수·사람별 분리·테넌트 격리. */
@Transactional
class WorkProfileRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WorkProfileRepository repository;

  private static final MeOverviewPeriod MONTH = MeOverviewPeriod.MONTH;

  /** 이번 달(2026-11-01 ~ 11-11) — 실패 기록에 함께 적는 점유 기간. */
  private static final MetricsPeriod NOV =
      new MetricsPeriod(LocalDate.parse("2026-11-01"), LocalDate.parse("2026-11-11"));

  /** 테스트용 사용자 — USER 역할 포함. */
  private Long user(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private WorkProfileReady ready(OffsetDateTime at) {
    return new WorkProfileReady(
        new MetricsPeriod(LocalDate.parse("2026-11-01"), LocalDate.parse("2026-11-11")),
        "fp1",
        5,
        4,
        "요약",
        List.of(new Count("기능 개발", 2)),
        List.of(new Count("백엔드", 3)),
        List.of("Spring Boot"),
        at);
  }

  @Test
  void claimPending_insertsThenRejectsSecondUntilStale() {
    long a = user("wp-a");
    OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");

    assertThat(repository.claimPending(a, MONTH, now, now.minusMinutes(10))).isTrue();
    assertThat(repository.find(a, MONTH).orElseThrow().status())
        .isEqualTo(WorkProfileStatus.PENDING);
    // 신선한 PENDING — 두 번째는 거절.
    assertThat(repository.claimPending(a, MONTH, now, now.minusMinutes(10))).isFalse();
    // pending_since 가 staleBefore 보다 앞이면 재점유.
    assertThat(repository.claimPending(a, MONTH, now.plusMinutes(11), now.plusMinutes(1))).isTrue();
  }

  @Test
  void saveReady_roundTripsJsonAndClearsPending() {
    long a = user("wp-a");
    OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");
    repository.claimPending(a, MONTH, now, now.minusMinutes(10));

    assertThat(repository.saveReady(a, MONTH, now, ready(now))).isTrue();

    WorkProfileRow row = repository.find(a, MONTH).orElseThrow();
    assertThat(row.status()).isEqualTo(WorkProfileStatus.READY);
    assertThat(row.pendingSince()).isNull();
    assertThat(row.error()).isNull();
    assertThat(row.tasks()).containsExactly(new Count("기능 개발", 2));
    assertThat(row.areas()).containsExactly(new Count("백엔드", 3));
    assertThat(row.skills()).containsExactly("Spring Boot");
    assertThat(row.summary()).isEqualTo("요약");
    assertThat(row.fingerprint()).isEqualTo("fp1");
    assertThat(row.totalCount()).isEqualTo(5);
    assertThat(row.analyzedCount()).isEqualTo(4);
    assertThat(row.periodFrom()).isEqualTo(LocalDate.parse("2026-11-01"));
    assertThat(row.periodTo()).isEqualTo(LocalDate.parse("2026-11-11"));
    assertThat(row.analyzedAt().toInstant()).isEqualTo(now.toInstant());
    assertThat(repository.findForUpdate(a, MONTH)).isPresent();
  }

  @Test
  void markUnchanged_updatesRangeAndTotalOnly() {
    long a = user("wp-a");
    OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");
    repository.claimPending(a, MONTH, now, now.minusMinutes(10));
    repository.saveReady(a, MONTH, now, ready(now));
    OffsetDateTime again = now.plusMinutes(30);
    repository.claimPending(a, MONTH, again, now.plusMinutes(20));

    repository.markUnchanged(
        a,
        MONTH,
        again,
        new MetricsPeriod(LocalDate.parse("2026-11-01"), LocalDate.parse("2026-11-12")),
        7);

    WorkProfileRow row = repository.find(a, MONTH).orElseThrow();
    assertThat(row.status()).isEqualTo(WorkProfileStatus.READY);
    assertThat(row.pendingSince()).isNull();
    assertThat(row.periodTo()).isEqualTo(LocalDate.parse("2026-11-12"));
    // 전체 건수는 새로 쓰고, 분석한 건수는 그대로.
    assertThat(row.totalCount()).isEqualTo(7);
    assertThat(row.analyzedCount()).isEqualTo(4);
    assertThat(row.summary()).isEqualTo("요약");
    assertThat(row.analyzedAt().toInstant()).isEqualTo(now.toInstant());
  }

  @Test
  void markFailed_keepsPreviousContent() {
    long a = user("wp-a");
    OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");
    repository.claimPending(a, MONTH, now, now.minusMinutes(10));
    repository.saveReady(a, MONTH, now, ready(now));
    OffsetDateTime again = now.plusMinutes(30);
    repository.claimPending(a, MONTH, again, now.plusMinutes(20));

    MetricsPeriod dec =
        new MetricsPeriod(LocalDate.parse("2026-12-01"), LocalDate.parse("2026-12-02"));
    assertThat(repository.markFailed(a, MONTH, again, dec, "x")).isTrue();

    WorkProfileRow row = repository.find(a, MONTH).orElseThrow();
    assertThat(row.status()).isEqualTo(WorkProfileStatus.FAILED);
    // 실패한 점유의 기간은 적는다 — 기간이 바뀐 것으로 보고 카드 조회마다 다시 점유하지 않게.
    assertThat(row.periodFrom()).isEqualTo(dec.from());
    assertThat(row.periodTo()).isEqualTo(dec.to());
    assertThat(row.summary()).isEqualTo("요약");
    assertThat(row.tasks()).containsExactly(new Count("기능 개발", 2));
    assertThat(row.error()).isEqualTo("x");
    assertThat(row.pendingSince()).isNull();
  }

  @Test
  void workerWrites_requireMatchingClaimToken() {
    long a = user("wp-a");
    OffsetDateTime first = OffsetDateTime.parse("2026-11-11T03:00:00Z");
    repository.claimPending(a, MONTH, first, first.minusMinutes(10));
    OffsetDateTime second = first.plusMinutes(11);
    repository.claimPending(a, MONTH, second, first.plusMinutes(1));

    // 옛 점유(first)의 저장은 모두 0행 — 새 점유를 덮지 않는다.
    assertThat(repository.saveReady(a, MONTH, first, ready(first))).isFalse();
    assertThat(
            repository.markUnchanged(
                a,
                MONTH,
                first,
                new MetricsPeriod(LocalDate.parse("2026-11-01"), LocalDate.parse("2026-11-11")),
                1))
        .isFalse();
    assertThat(repository.markFailed(a, MONTH, first, NOV, "늦은 실패")).isFalse();
    WorkProfileRow row = repository.find(a, MONTH).orElseThrow();
    assertThat(row.status()).isEqualTo(WorkProfileStatus.PENDING);
    assertThat(row.pendingSince()).isEqualTo(second);

    // 점유가 끝난(READY) 행에는 같은 토큰으로도 다시 쓰지 않는다.
    assertThat(repository.saveReady(a, MONTH, second, ready(second))).isTrue();
    assertThat(repository.markFailed(a, MONTH, second, NOV, "두 번째")).isFalse();
    assertThat(repository.find(a, MONTH).orElseThrow().status()).isEqualTo(WorkProfileStatus.READY);
  }

  @Test
  void countManualRun_resetsOnNewDay() {
    long a = user("wp-a");
    OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");
    repository.claimPending(a, MONTH, now, now.minusMinutes(10));
    LocalDate day = LocalDate.parse("2026-11-11");

    repository.countManualRun(a, MONTH, day);
    repository.countManualRun(a, MONTH, day);
    repository.countManualRun(a, MONTH, day);
    WorkProfileRow same = repository.find(a, MONTH).orElseThrow();
    assertThat(same.manualCount()).isEqualTo(3);
    assertThat(same.manualDate()).isEqualTo(day);

    repository.countManualRun(a, MONTH, day.plusDays(1));
    WorkProfileRow next = repository.find(a, MONTH).orElseThrow();
    assertThat(next.manualCount()).isEqualTo(1);
    assertThat(next.manualDate()).isEqualTo(day.plusDays(1));
  }

  @Test
  void rows_are_per_user() {
    long a = withMembership(user("wp-a"));
    long b = withMembership(user("wp-b"));
    OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");
    repository.claimPending(a, MONTH, now, now.minusMinutes(10));

    assertThat(repository.find(b, MONTH)).isEmpty();
    List<Key> keys = repository.findAllKeys();
    assertThat(keys).contains(new Key(a, MONTH));
    assertThat(keys).doesNotContain(new Key(b, MONTH));
  }

  /** 매일 갱신 대상은 그 워크스페이스에서 활성인 사람(계정 활성 + 멤버십 ACTIVE)의 행만 — 떠났거나 정지된 사람의 행은 남아 있어도 빠진다. */
  @Test
  void findAllKeys_onlyActiveMembers() {
    long active = withMembership(user("wp-act"));
    long noMember = user("wp-gone");
    long suspended = withMembership(user("wp-susp"));
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(suspended))
        .execute();
    long deactivated = withMembership(user("wp-off"));
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(deactivated)).execute();
    OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");
    for (long u : List.of(active, noMember, suspended, deactivated)) {
      repository.claimPending(u, MONTH, now, now.minusMinutes(10));
    }

    List<Key> keys = repository.findAllKeys();

    assertThat(keys).contains(new Key(active, MONTH));
    assertThat(keys)
        .doesNotContain(
            new Key(noMember, MONTH), new Key(suspended, MONTH), new Key(deactivated, MONTH));
  }

  /**
   * 한 사람이 두 테넌트에 속하면 테넌트마다 따로 한 행 — 키가 (테넌트, 사람, 기간)이라 다른 테넌트의 행과 부딪치지 않는다. 키에 테넌트가 없으면 두 번째 점유의 ON
   * CONFLICT 가 다른 테넌트(RLS 로 안 보이는) 행에 걸려 실패한다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void sameUserInTwoTenants_getsIndependentRows() {
    long home = defaultTenantId();
    long other = ensureFixtureTenant("wp-other");
    long a = callInTenant(home, () -> user("wp-a"));
    try {
      OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");
      assertThat(
              callInTenant(
                  home, () -> repository.claimPending(a, MONTH, now, now.minusMinutes(10))))
          .isTrue();
      assertThat(
              callInTenant(
                  other, () -> repository.claimPending(a, MONTH, now, now.minusMinutes(10))))
          .isTrue();
      callInTenant(home, () -> repository.saveReady(a, MONTH, now, ready(now)));

      assertThat(callInTenant(home, () -> repository.find(a, MONTH)).orElseThrow().status())
          .isEqualTo(WorkProfileStatus.READY);
      assertThat(callInTenant(other, () -> repository.find(a, MONTH)).orElseThrow().status())
          .isEqualTo(WorkProfileStatus.PENDING);
    } finally {
      cleanupInTenant(
          other, () -> dsl.deleteFrom(WORK_PROFILE).where(WORK_PROFILE.USER_ID.eq(a)).execute());
      cleanupInTenant(home, () -> dsl.deleteFrom(USER).where(USER.ID.eq(a)).execute());
    }
  }

  /**
   * 다른 테넌트에서는 같은 키의 행이 보이지 않는다(RLS). 클래스가 @Transactional 이면 callInTenant 가 기존 트랜잭션(기본 테넌트 GUC)에 합류해
   * 격리를 검증할 수 없으므로, 이 테스트만 트랜잭션 밖에서 커밋하고 끝나면 사용자(CASCADE)를 회수한다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void tenant_isolation() {
    long home = defaultTenantId();
    long other = ensureFixtureTenant("wp-other");
    long a = callInTenant(home, () -> user("wp-a"));
    try {
      OffsetDateTime now = OffsetDateTime.parse("2026-11-11T03:00:00Z");
      callInTenant(home, () -> repository.claimPending(a, MONTH, now, now.minusMinutes(10)));

      assertThat(callInTenant(home, () -> repository.find(a, MONTH))).isPresent();
      assertThat(callInTenant(other, () -> repository.find(a, MONTH))).isEmpty();
      assertThat(callInTenant(other, () -> repository.findAllKeys()))
          .doesNotContain(new Key(a, MONTH));
    } finally {
      cleanupInTenant(home, () -> dsl.deleteFrom(USER).where(USER.ID.eq(a)).execute());
    }
  }
}

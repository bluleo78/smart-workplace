package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Clock;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * 개인 보고 실행기(WP-1486) — 여러 테넌트에서 켜져 있고 때가 된 사람만, 회차당 상한(10명)까지 처리하고, 한 사람의 실패가 다른 사람을 막지 않으며, 끝나면
 * TenantContext 를 비운다. 5분 간격 + ShedLock 선언도 고정한다.
 *
 * <p>비-@Transactional — 러너가 테넌트마다 새 트랜잭션으로 커밋된 데이터를 본다. 「지금」을 2025-01-15 09:00 KST 로 아주 옛날에 두어, 다른
 * 테스트가 남긴 설정 행(실제 시각 기준)이 이 회차의 대상에 끼지 않게 한다. 시드한 사람에게는 이슈가 없어 AI·노트 없이 「한 일 없음」(SKIPPED)으로 끝나며, 처리
 * 여부는 next_run_at 이 다음 날로 밀렸는지로 본다.
 */
class PersonalReportSchedulerTest extends ExternalClientMockedTestBase {

  /** 2025-01-15(수) 09:00 KST. */
  private static final OffsetDateTime NOW = OffsetDateTime.parse("2025-01-15T00:00:00Z");

  private static final Clock CLOCK = Clock.fixed(NOW.toInstant(), ZoneOffset.UTC);

  /** 다음 예정 — 다음 날 09:00 KST. */
  private static final OffsetDateTime NEXT = OffsetDateTime.parse("2025-01-16T00:00:00Z");

  @Autowired DSLContext dsl;
  @Autowired PersonalReportScheduler scheduler;
  @Autowired AssistantResolver assistantResolver;
  @Autowired AiAgentIssueClient client;

  private long fixtureTenant;

  /** (테넌트, 사용자) — 정리용. */
  private final List<long[]> seeded = new ArrayList<>();

  @BeforeEach
  void seed() {
    fixtureTenant = ensureFixtureTenant("personal-report-scheduler");
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(1L, "m", "low", 4, 60_000)));
  }

  @AfterEach
  void cleanup() {
    for (long[] s : seeded) {
      cleanupInTenant(
          s[0],
          () -> {
            dsl.deleteFrom(table(name("personal_report")))
                .where(field(name("user_id"), Long.class).eq(s[1]))
                .execute();
            dsl.deleteFrom(table(name("personal_report_setting")))
                .where(field(name("user_id"), Long.class).eq(s[1]))
                .execute();
          });
      cleanupInTenant(
          defaultTenantId(), () -> dsl.deleteFrom(USER).where(USER.ID.eq(s[1])).execute());
    }
    TenantContext.clear();
  }

  /** 테넌트에 사람과 일일 보고 설정(켬 여부·다음 실행)을 커밋하고 id 를 돌려준다. */
  private long person(long tenantId, boolean enabled, OffsetDateTime nextRunAt) {
    long userId = callInTenant(defaultTenantId(), () -> TestFixtures.createHuman(dsl));
    seeded.add(new long[] {tenantId, userId});
    // 실행 대상은 그 워크스페이스의 ACTIVE 멤버뿐이다(membership 은 RLS 비대상 전역 테이블).
    callInTenant(
        tenantId,
        () -> {
          TestFixtures.ensureActiveMember(dsl, userId, tenantId);
          return null;
        });
    callInTenant(
        tenantId,
        () -> {
          dsl.insertInto(table(name("personal_report_setting")))
              .set(field(name("user_id"), Long.class), userId)
              .set(field(name("daily_enabled"), Boolean.class), enabled)
              .set(field(name("time_of_day"), LocalTime.class), LocalTime.of(9, 0))
              .set(field(name("next_run_at"), OffsetDateTime.class), nextRunAt)
              .execute();
          return null;
        });
    return userId;
  }

  private OffsetDateTime nextRunAt(long tenantId, long userId) {
    return callInTenant(
        tenantId,
        () ->
            dsl.select(field(name("next_run_at"), OffsetDateTime.class))
                .from(table(name("personal_report_setting")))
                .where(field(name("user_id"), Long.class).eq(userId))
                .fetchOne(0, OffsetDateTime.class));
  }

  private String reportStatus(long tenantId, long userId) {
    return callInTenant(
        tenantId,
        () ->
            dsl.select(field(name("status"), String.class))
                .from(table(name("personal_report")))
                .where(field(name("user_id"), Long.class).eq(userId))
                .fetchOne(0, String.class));
  }

  private boolean processed(long tenantId, long userId) {
    return nextRunAt(tenantId, userId).toInstant().equals(NEXT.toInstant());
  }

  @Test
  void runOnce_processesDueUsersAcrossTenants() {
    long inDefault = person(defaultTenantId(), true, NOW.minusMinutes(1));
    long inFixture = person(fixtureTenant, true, NOW.minusMinutes(1));
    long notYet = person(fixtureTenant, true, NOW.plusHours(1));
    long off = person(fixtureTenant, false, NOW.minusMinutes(1));

    PersonalReportScheduler.Summary summary = scheduler.runOnce(CLOCK);

    assertThat(summary).isEqualTo(new PersonalReportScheduler.Summary(2, 0, 0));
    assertThat(processed(defaultTenantId(), inDefault)).isTrue();
    assertThat(processed(fixtureTenant, inFixture)).isTrue();
    // 한 일이 없는 날 — 페이지 없이 SKIPPED 로 남는다.
    assertThat(reportStatus(fixtureTenant, inFixture)).isEqualTo("SKIPPED");
    assertThat(nextRunAt(fixtureTenant, notYet).toInstant())
        .isEqualTo(NOW.plusHours(1).toInstant());
    assertThat(reportStatus(fixtureTenant, notYet)).isNull();
    assertThat(reportStatus(fixtureTenant, off)).isNull();
    verify(client, never()).writePersonalReport(any());
  }

  @Test
  void runOnce_respectsMaxPerRun() {
    List<Long> users = new ArrayList<>();
    for (int i = 0; i < 12; i++) {
      users.add(person(fixtureTenant, true, NOW.minusMinutes(20 - i)));
    }

    assertThat(scheduler.runOnce(CLOCK).processed()).isEqualTo(10);
    assertThat(users.stream().filter(u -> processed(fixtureTenant, u)).count()).isEqualTo(10);
    // 이른 순으로 처리하므로 마지막 두 사람이 남는다.
    assertThat(processed(fixtureTenant, users.get(10))).isFalse();
    assertThat(processed(fixtureTenant, users.get(11))).isFalse();

    assertThat(scheduler.runOnce(CLOCK).processed()).isEqualTo(2);
    assertThat(users.stream().filter(u -> processed(fixtureTenant, u)).count()).isEqualTo(12);
    assertThat(PersonalReportScheduler.MAX_PER_RUN).isEqualTo(10);
  }

  @Test
  void runOnce_oneFailureDoesNotStopOthers() {
    long broken = person(fixtureTenant, true, NOW.minusMinutes(2));
    long fine = person(fixtureTenant, true, NOW.minusMinutes(1));
    when(assistantResolver.resolveOrEmpty(broken)).thenThrow(new IllegalStateException("고장"));

    PersonalReportScheduler.Summary summary = scheduler.runOnce(CLOCK);

    assertThat(summary).isEqualTo(new PersonalReportScheduler.Summary(2, 0, 1));
    // 실패한 사람은 30분 뒤 재시도, 다른 사람은 정상 처리.
    assertThat(nextRunAt(fixtureTenant, broken).toInstant())
        .isEqualTo(NOW.plusMinutes(30).toInstant());
    assertThat(processed(fixtureTenant, fine)).isTrue();
    assertThat(reportStatus(fixtureTenant, fine)).isEqualTo("SKIPPED");
  }

  @Test
  void runOnce_clearsTenantContext() {
    person(fixtureTenant, true, NOW.minusMinutes(1));
    TenantContext.clear();

    scheduler.runOnce(CLOCK);

    assertThat(TenantContext.get()).isNull();
  }

  @Test
  void runOnce_isLockedAndScheduledEveryFiveMinutes() throws Exception {
    var m = PersonalReportScheduler.class.getMethod("runOnce");
    Scheduled s = m.getAnnotation(Scheduled.class);
    assertThat(s.fixedDelay()).isEqualTo(300_000L);
    assertThat(s.initialDelay()).isEqualTo(120_000L);
    SchedulerLock lock = m.getAnnotation(SchedulerLock.class);
    assertThat(lock.name()).isEqualTo("PersonalReportScheduler.runOnce");
    assertThat(lock.lockAtMostFor()).isEqualTo("PT40M");
  }
}

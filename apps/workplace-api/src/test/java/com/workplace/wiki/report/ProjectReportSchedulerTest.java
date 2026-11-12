package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.support.ExternalClientMockedTestBase;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * 프로젝트 리포트 실행기(WP-1483) — 공통 비서가 없는 테넌트는 건너뛰고, 있는 테넌트에서는 켜져 있고 때가 된 프로젝트만, 회차당 상한까지만 처리한다. 5분 간격 +
 * ShedLock 선언도 고정한다.
 *
 * <p>비-@Transactional — 러너가 테넌트마다 새 트랜잭션으로 커밋된 데이터를 본다. 비서 목은 fixture 테넌트에서만 사양을 돌려준다(기본 테넌트 = 「비서
 * 없는 테넌트」). 시드 프로젝트에는 이슈가 없어 AI·노트 없이 「변화 없음」(SKIPPED 회차)으로 끝나며, 회차 행과 next_run_at 으로 처리 여부를 본다.
 */
class ProjectReportSchedulerTest extends ExternalClientMockedTestBase {

  /** 2026-11-16(월) 09:00 KST. */
  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-16T00:00:00Z");

  private static final Clock CLOCK = Clock.fixed(NOW.toInstant(), ZoneOffset.UTC);

  /** 다음 예정 — 다음 월요일 09:00 KST. */
  private static final OffsetDateTime NEXT = OffsetDateTime.parse("2026-11-23T00:00:00Z");

  @Autowired DSLContext dsl;
  @Autowired ProjectReportScheduler scheduler;
  @Autowired AssistantResolver assistantResolver;
  @Autowired AiAgentIssueClient client;

  private long fixtureTenant;
  private long owner;
  private final List<long[]> seeded = new ArrayList<>();

  @BeforeEach
  void seed() {
    fixtureTenant = ensureFixtureTenant("prs-scheduler");
    String s = UUID.randomUUID().toString().substring(0, 8);
    owner =
        callInTenant(
            defaultTenantId(),
            () ->
                dsl.insertInto(USER)
                    .set(USER.USERNAME, "prs-" + s)
                    .set(USER.PASSWORD, "pw")
                    .set(USER.NAME, "prs")
                    .set(USER.EMAIL, "prs-" + s + "@example.com")
                    .returning(USER.ID)
                    .fetchOne()
                    .getId());
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenAnswer(
            inv ->
                Long.valueOf(fixtureTenant).equals(TenantContext.get())
                    ? Optional.of(new AssistantSpec(owner, "m", "low", 4, 60_000))
                    : Optional.empty());
  }

  @AfterEach
  void cleanup() {
    for (long[] p : seeded) {
      cleanupInTenant(p[0], () -> dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(p[1])).execute());
    }
    cleanupInTenant(
        defaultTenantId(), () -> dsl.deleteFrom(USER).where(USER.ID.eq(owner)).execute());
  }

  /** 테넌트에 TEAM 프로젝트와 리포트 설정(켬 여부·다음 실행)을 커밋하고 id 를 돌려준다. */
  private long project(long tenantId, boolean enabled, OffsetDateTime nextRunAt) {
    String key =
        ("PR" + UUID.randomUUID().toString().replace("-", "").toUpperCase()).substring(0, 8);
    long id =
        callInTenant(
            tenantId,
            () -> {
              long pid =
                  dsl.insertInto(PROJECT)
                      .set(PROJECT.KEY, key)
                      .set(PROJECT.NAME, "리포트실행-" + key)
                      .set(PROJECT.OWNER_ID, owner)
                      .set(PROJECT.TYPE, "TEAM")
                      .set(PROJECT.IS_DEFAULT, false)
                      .returning(PROJECT.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(table(name("project_report_setting")))
                  .set(field(name("project_id"), Long.class), pid)
                  .set(field(name("enabled"), Boolean.class), enabled)
                  .set(field(name("next_run_at"), OffsetDateTime.class), nextRunAt)
                  .execute();
              return pid;
            });
    seeded.add(new long[] {tenantId, id});
    return id;
  }

  private OffsetDateTime nextRunAt(long tenantId, long projectId) {
    return callInTenant(
        tenantId,
        () ->
            dsl.select(field(name("next_run_at"), OffsetDateTime.class))
                .from(table(name("project_report_setting")))
                .where(field(name("project_id"), Long.class).eq(projectId))
                .fetchOne(0, OffsetDateTime.class));
  }

  private int reports(long tenantId, long projectId) {
    return callInTenant(
        tenantId,
        () ->
            dsl.fetchCount(
                table(name("project_report")),
                field(name("project_id"), Long.class).eq(projectId)));
  }

  @Test
  void runOnce_processesDueProjectsOnly() {
    long due = project(fixtureTenant, true, NOW.minusMinutes(1));
    long notYet = project(fixtureTenant, true, NOW.plusHours(1));
    long off = project(fixtureTenant, false, NOW.minusMinutes(1));

    ProjectReportScheduler.Summary summary = scheduler.runOnce(CLOCK);

    assertThat(summary).isEqualTo(new ProjectReportScheduler.Summary(1, 0, 0));
    assertThat(nextRunAt(fixtureTenant, due).toInstant()).isEqualTo(NEXT.toInstant());
    assertThat(reports(fixtureTenant, due)).isEqualTo(1);
    assertThat(nextRunAt(fixtureTenant, notYet).toInstant())
        .isEqualTo(NOW.plusHours(1).toInstant());
    assertThat(reports(fixtureTenant, notYet)).isZero();
    assertThat(reports(fixtureTenant, off)).isZero();
    verify(client, never()).writeProjectReport(any());
  }

  @Test
  void runOnce_respectsMaxPerRun() {
    long first = project(fixtureTenant, true, NOW.minusMinutes(3));
    long second = project(fixtureTenant, true, NOW.minusMinutes(2));
    long third = project(fixtureTenant, true, NOW.minusMinutes(1));

    assertThat(scheduler.runOnce(CLOCK, 2).processed()).isEqualTo(2);
    assertThat(reports(fixtureTenant, first)).isEqualTo(1);
    assertThat(reports(fixtureTenant, second)).isEqualTo(1);
    assertThat(reports(fixtureTenant, third)).isZero();

    assertThat(scheduler.runOnce(CLOCK, 2).processed()).isEqualTo(1);
    assertThat(reports(fixtureTenant, third)).isEqualTo(1);
    assertThat(ProjectReportScheduler.MAX_PER_RUN).isEqualTo(5);
  }

  @Test
  void runOnce_skipsTenantWithoutAssistant() {
    long p = project(defaultTenantId(), true, NOW.minusMinutes(1));

    scheduler.runOnce(CLOCK);

    assertThat(nextRunAt(defaultTenantId(), p).toInstant())
        .isEqualTo(NOW.minusMinutes(1).toInstant());
    assertThat(reports(defaultTenantId(), p)).isZero();
  }

  @Test
  void runOnce_isLockedAndScheduledEveryFiveMinutes() throws Exception {
    var m = ProjectReportScheduler.class.getMethod("runOnce");
    Scheduled s = m.getAnnotation(Scheduled.class);
    assertThat(s.fixedDelay()).isEqualTo(300_000L);
    assertThat(s.initialDelay()).isEqualTo(90_000L);
    SchedulerLock lock = m.getAnnotation(SchedulerLock.class);
    assertThat(lock.name()).isEqualTo("ProjectReportScheduler.runOnce");
    assertThat(lock.lockAtMostFor()).isEqualTo("PT40M");
  }
}

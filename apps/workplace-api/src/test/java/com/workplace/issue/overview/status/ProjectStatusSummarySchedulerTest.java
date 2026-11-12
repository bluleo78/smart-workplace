package com.workplace.issue.overview.status;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
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
 * 프로젝트 상태 요약 스케줄러(WP-1479) — 공통 비서가 없는 테넌트는 건너뛰고, 있는 테넌트에서는 점검 시각이 된 프로젝트만 처리한다. 5분 간격 + ShedLock
 * 선언도 고정한다.
 *
 * <p>비-@Transactional — 러너가 테넌트마다 새 트랜잭션으로 커밋된 데이터를 본다. 기본 테넌트(1)에는 다른 테스트가 커밋한 프로젝트가 많아, 비서 목은 이
 * 테스트의 fixture 테넌트에서만 사양을 돌려준다 — 그래서 기본 테넌트 프로젝트는 건드리지 않는다(= 「비서 없는 테넌트 건너뜀」). 시드 프로젝트에는 이슈가 없어 AI
 * 없이 SKIPPED_EMPTY 로 끝나지만, 점유 행(next_run_at)이 생겼는지로 처리 여부를 본다.
 */
class ProjectStatusSummarySchedulerTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-11T03:00:00Z");

  /** 「지금」을 NOW 로 고정한 시계 — 대상 선별과 프로젝트마다 읽는 「지금」이 같아 결과가 정해진다. */
  private static final Clock CLOCK = Clock.fixed(NOW.toInstant(), ZoneOffset.UTC);

  @Autowired DSLContext dsl;
  @Autowired ProjectStatusSummaryScheduler scheduler;
  @Autowired ProjectStatusSummaryRepository repository;
  @Autowired AssistantResolver assistantResolver;
  @Autowired AiAgentIssueClient client;

  private long fixtureTenant;
  private long owner;
  private final List<long[]> seeded = new ArrayList<>();

  @BeforeEach
  void seed() {
    fixtureTenant = ensureFixtureTenant("pss-scheduler");
    String s = UUID.randomUUID().toString().substring(0, 8);
    owner =
        callInTenant(
            defaultTenantId(),
            () ->
                dsl.insertInto(USER)
                    .set(USER.USERNAME, "pss-" + s)
                    .set(USER.PASSWORD, "pw")
                    .set(USER.NAME, "pss")
                    .set(USER.EMAIL, "pss-" + s + "@example.com")
                    .returning(USER.ID)
                    .fetchOne()
                    .getId());
    // 비서는 fixture 테넌트에만 있다.
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

  /** 테넌트에 TEAM 프로젝트를 커밋하고 id 를 돌려준다(정리 목록에 넣는다). */
  private long project(long tenantId) {
    String key =
        ("PZ" + UUID.randomUUID().toString().replace("-", "").toUpperCase()).substring(0, 8);
    long id =
        callInTenant(
            tenantId,
            () ->
                dsl.insertInto(PROJECT)
                    .set(PROJECT.KEY, key)
                    .set(PROJECT.NAME, "스케줄-" + key)
                    .set(PROJECT.OWNER_ID, owner)
                    .set(PROJECT.TYPE, "TEAM")
                    .set(PROJECT.IS_DEFAULT, false)
                    .returning(PROJECT.ID)
                    .fetchOne()
                    .getId());
    seeded.add(new long[] {tenantId, id});
    return id;
  }

  private Optional<StatusSummaryRow> row(long tenantId, long projectId) {
    return callInTenant(tenantId, () -> repository.find(projectId));
  }

  @Test
  void skipsTenantWithoutAssistant() {
    long p = project(defaultTenantId());

    scheduler.runOnce(CLOCK);

    assertThat(row(defaultTenantId(), p)).isEmpty();
    verify(client, never()).summarizeProjectStatus(any());
  }

  @Test
  void processesOnlyDueProjects() {
    long due = project(fixtureTenant);
    long notYet = project(fixtureTenant);
    // 다음 점검이 1시간 뒤인 프로젝트 — 이번 회차 대상이 아니다.
    callInTenant(fixtureTenant, () -> repository.claim(notYet, NOW, NOW.plusHours(1)));

    ProjectStatusSummaryScheduler.Summary summary = scheduler.runOnce(CLOCK);

    // fixture 테넌트에서 점검 시각이 된 것은 due 하나뿐 — 이슈가 없어 「이슈 없음」으로 끝난다.
    assertThat(summary).isEqualTo(new ProjectStatusSummaryScheduler.Summary(1, 0, 0, 1, 0, 0));
    // 대상은 점유돼 다음 점검이 기본 간격(2시간) 뒤로 밀렸다.
    assertThat(row(fixtureTenant, due).orElseThrow().nextRunAt().toInstant())
        .isEqualTo(NOW.plusHours(2).toInstant());
    // 대상이 아니면 그대로.
    assertThat(row(fixtureTenant, notYet).orElseThrow().nextRunAt().toInstant())
        .isEqualTo(NOW.plusHours(1).toInstant());
  }

  @Test
  void processesAtMostLimitPerRun() {
    long first = project(fixtureTenant);
    long second = project(fixtureTenant);
    long third = project(fixtureTenant);

    // 한 회차 상한 2 — 대상 셋 중 앞(프로젝트 id 순) 둘만 처리하고 나머지는 다음 회차로 남긴다.
    ProjectStatusSummaryScheduler.Summary summary = scheduler.runOnce(CLOCK, 2);

    assertThat(summary).isEqualTo(new ProjectStatusSummaryScheduler.Summary(2, 0, 0, 2, 0, 0));
    assertThat(row(fixtureTenant, first)).isPresent();
    assertThat(row(fixtureTenant, second)).isPresent();
    assertThat(row(fixtureTenant, third)).isEmpty();

    // 다음 회차에 남은 하나를 처리한다.
    assertThat(scheduler.runOnce(CLOCK, 2).targets()).isEqualTo(1);
    assertThat(row(fixtureTenant, third)).isPresent();
  }

  @Test
  void runLimitIsThirty() {
    // 첫 배포 때 모든 프로젝트가 한꺼번에 대상이 되어도 한 회차가 잠금(30분)을 넘지 않게 묶는 상한.
    assertThat(ProjectStatusSummaryScheduler.MAX_PER_RUN).isEqualTo(30);
  }

  @Test
  void runOnceIsLockedAndScheduledEveryFiveMinutes() throws Exception {
    var m = ProjectStatusSummaryScheduler.class.getMethod("runOnce");
    Scheduled s = m.getAnnotation(Scheduled.class);
    assertThat(s.fixedDelay()).isEqualTo(300_000L);
    assertThat(s.initialDelay()).isEqualTo(60_000L);
    SchedulerLock lock = m.getAnnotation(SchedulerLock.class);
    assertThat(lock.name()).isEqualTo("ProjectStatusSummaryScheduler.runOnce");
    assertThat(lock.lockAtMostFor()).isEqualTo("PT30M");
  }
}

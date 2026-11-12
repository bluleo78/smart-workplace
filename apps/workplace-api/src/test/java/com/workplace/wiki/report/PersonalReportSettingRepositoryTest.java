package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 개인 보고 설정 저장소(WP-1486) — 기본값, 점유(claim), 실패 기록, 실행 대상 조회. */
@Transactional
class PersonalReportSettingRepositoryTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-12T09:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired PersonalReportSettingRepository repository;
  @Autowired WikiSystemPageWriter writer;

  private long userA;
  private long userB;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    userA = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(userA);
    userB = withMembership(TestFixtures.createHuman(dsl));
  }

  @Test
  void find_noRow_empty_defaultsAreOff0900Skip() {
    assertThat(repository.find(userA)).isEmpty();
    SettingRow d = SettingRow.defaults(userA);
    assertThat(d.dailyEnabled()).isFalse();
    assertThat(d.timeOfDay()).isEqualTo(LocalTime.of(9, 0));
    assertThat(d.skipEmpty()).isTrue();
  }

  @Test
  void save_upsert_and_disableClearsNextRun() {
    repository.save(userA, true, LocalTime.of(18, 0), false, NOW.plusDays(1));
    SettingRow s = repository.find(userA).orElseThrow();
    assertThat(s.dailyEnabled()).isTrue();
    assertThat(s.timeOfDay()).isEqualTo(LocalTime.of(18, 0));
    assertThat(s.skipEmpty()).isFalse();
    assertThat(s.nextRunAt()).isEqualTo(NOW.plusDays(1));
    repository.save(userA, false, LocalTime.of(18, 0), false, NOW.plusDays(1));
    assertThat(repository.find(userA).orElseThrow().nextRunAt()).isNull();
  }

  @Test
  void setTemplate_insertsDefaultsRow_andRoutesByKind() {
    String key =
        "PS" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    long projectId =
        projectService.create(userA, new CreateProjectRequest(key, "설정-" + key, null, "TEAM")).id();
    long page = writer.ensureReportsHome(projectId, userA).orElseThrow().reportsPageId();
    repository.setTemplate(userA, PersonalReportKind.DAILY, page);
    SettingRow s = repository.find(userA).orElseThrow();
    assertThat(s.dailyTemplatePageId()).isEqualTo(page);
    assertThat(s.weeklyTemplatePageId()).isNull();
    assertThat(s.dailyEnabled()).isFalse();
    repository.setTemplate(userA, PersonalReportKind.MONTHLY, page);
    assertThat(repository.find(userA).orElseThrow().weeklyTemplatePageId()).isEqualTo(page);
  }

  @Test
  void claim_onlyWhenEnabledAndDue_once() {
    repository.save(userA, true, LocalTime.of(9, 0), true, NOW.minusMinutes(1));
    assertThat(repository.claim(userA, NOW, NOW.plusDays(1))).isTrue();
    assertThat(repository.claim(userA, NOW, NOW.plusDays(1))).isFalse();
    // 꺼진 사람·행 없는 사람은 점유되지 않는다.
    repository.save(userB, false, LocalTime.of(9, 0), true, null);
    assertThat(repository.claim(userB, NOW, NOW.plusDays(1))).isFalse();
  }

  @Test
  void recordFailure_incrementsAndTrimsError500() {
    repository.save(userA, true, LocalTime.of(9, 0), true, NOW);
    assertThat(repository.recordFailure(userA, NOW.plusMinutes(30), "e".repeat(700))).isEqualTo(1);
    assertThat(repository.recordFailure(userA, NOW.plusMinutes(30), "boom")).isEqualTo(2);
    SettingRow s = repository.find(userA).orElseThrow();
    assertThat(s.consecutiveFailures()).isEqualTo(2);
    assertThat(s.lastError()).isEqualTo("boom");
    assertThat(s.nextRunAt()).isEqualTo(NOW.plusMinutes(30));

    repository.recordFailure(userA, NOW, "e".repeat(700));
    assertThat(repository.find(userA).orElseThrow().lastError()).hasSize(500);

    repository.skipToNext(userA, NOW.plusDays(1), "gave up");
    s = repository.find(userA).orElseThrow();
    assertThat(s.consecutiveFailures()).isZero();
    assertThat(s.nextRunAt()).isEqualTo(NOW.plusDays(1));
    repository.recordFailure(userA, NOW, "x");
    repository.resetFailures(userA);
    s = repository.find(userA).orElseThrow();
    assertThat(s.consecutiveFailures()).isZero();
    assertThat(s.lastError()).isNull();
  }

  @Test
  void dueUserIds_respectsLimitAndOrder() {
    repository.save(userA, true, LocalTime.of(9, 0), true, NOW.minusMinutes(5));
    repository.save(userB, true, LocalTime.of(9, 0), true, NOW.minusMinutes(10));
    assertThat(repository.dueUserIds(NOW, 10)).containsSubsequence(userB, userA);
    assertThat(repository.dueUserIds(NOW, 1)).hasSize(1);
    List<Long> none = repository.dueUserIds(NOW.minusHours(1), 10);
    assertThat(none).doesNotContain(userA, userB);
  }

  /** 정지된 멤버(membership SUSPENDED)·비활성 계정(user.is_active=false)·이 워크스페이스 멤버가 아닌 사람은 실행 대상이 아니다. */
  @Test
  void dueUserIds_skipsSuspendedInactiveAndNonMembers() {
    long suspended = withMembership(TestFixtures.createHuman(dsl));
    long inactive = withMembership(TestFixtures.createHuman(dsl));
    long outsider = TestFixtures.createHuman(dsl);
    for (long u : List.of(userA, suspended, inactive, outsider)) {
      repository.save(u, true, LocalTime.of(9, 0), true, NOW.minusMinutes(5));
    }
    TestFixtures.suspendMember(dsl, suspended, 1L);
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(inactive)).execute();

    List<Long> due = repository.dueUserIds(NOW, 100);

    assertThat(due).contains(userA).doesNotContain(suspended, inactive, outsider);
  }
}

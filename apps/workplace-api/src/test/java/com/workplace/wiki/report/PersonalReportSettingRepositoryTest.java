package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
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
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 개인 보고 설정 저장소(WP-1486) — 기본값, 점유(claim), 실패 기록, 실행 대상 조회, 템플릿 표시·저장 위치(WP-1655). */
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
    String key = uniqueProjectKey("PS");
    long projectId =
        projectService.create(userA, new CreateProjectRequest(key, "설정-" + key, null, "TEAM")).id();
    long page = writer.ensureReportsHome(projectId, userA).orElseThrow().reportsPageId();
    repository.setTemplate(userA, PersonalReportKind.DAILY, page, false);
    SettingRow s = repository.find(userA).orElseThrow();
    assertThat(s.dailyTemplatePageId()).isEqualTo(page);
    assertThat(s.weeklyTemplatePageId()).isNull();
    assertThat(s.dailyEnabled()).isFalse();
    repository.setTemplate(userA, PersonalReportKind.MONTHLY, page, false);
    assertThat(repository.find(userA).orElseThrow().weeklyTemplatePageId()).isEqualTo(page);
  }

  /** 다시 만든 템플릿(WP-1655) — 그 종류 id·「만든 적 있음」을 적고 다시 만든 시각을 남긴다. 다른 종류의 표시는 그대로. */
  @Test
  void setTemplate_recreated_setsMadeAndRecreatedAt() {
    long page = reportsPage();
    repository.setTemplate(userA, PersonalReportKind.DAILY, page, true);
    SettingRow s = repository.find(userA).orElseThrow();
    assertThat(s.dailyTemplatePageId()).isEqualTo(page);
    assertThat(s.dailyTemplateMade()).isTrue();
    assertThat(s.weeklyTemplateMade()).isFalse();
    assertThat(s.templateRecreatedAt()).isNotNull();
    assertThat(s.templateInitialized()).isFalse();
  }

  /** 처음 만든 템플릿(WP-1655) — 「만든 적 있음」만 적고 다시 만든 시각은 비워 둔다. 월간은 주간 칸. */
  @Test
  void setTemplate_notRecreated_keepsRecreatedAtNull() {
    long page = reportsPage();
    repository.setTemplate(userA, PersonalReportKind.MONTHLY, page, false);
    SettingRow s = repository.find(userA).orElseThrow();
    assertThat(s.weeklyTemplatePageId()).isEqualTo(page);
    assertThat(s.weeklyTemplateMade()).isTrue();
    assertThat(s.dailyTemplateMade()).isFalse();
    assertThat(s.templateRecreatedAt()).isNull();
    // 이미 있는 행에 다시 적어도(recreated=false) 앞서 남은 알림 시각은 건드리지 않는다.
    repository.setTemplate(userA, PersonalReportKind.DAILY, page, true);
    repository.setTemplate(userA, PersonalReportKind.WEEKLY, page, false);
    assertThat(repository.find(userA).orElseThrow().templateRecreatedAt()).isNotNull();
  }

  /** 「템플릿을 다시 만들었어요」 알림 지우기(WP-1655) — 값이 있으면 비우고, 행이 없어도 아무 일 없다. */
  @Test
  void clearTemplateRecreated_clears() {
    repository.clearTemplateRecreated(userA);
    assertThat(repository.find(userA)).isEmpty();
    repository.setTemplate(userA, PersonalReportKind.DAILY, reportsPage(), true);
    repository.clearTemplateRecreated(userA);
    SettingRow s = repository.find(userA).orElseThrow();
    assertThat(s.templateRecreatedAt()).isNull();
    assertThat(s.dailyTemplateMade()).isTrue();
  }

  /** 옛 템플릿 옮기기를 마친 표시(WP-1655) — 행이 없어도 기본값 행을 만들어 적는다. */
  @Test
  void markTemplateInitialized_upsertsRow() {
    repository.markTemplateInitialized(userA);
    SettingRow s = repository.find(userA).orElseThrow();
    assertThat(s.templateInitialized()).isTrue();
    assertThat(s.dailyEnabled()).isFalse();
    repository.markTemplateInitialized(userA);
    assertThat(repository.find(userA).orElseThrow().templateInitialized()).isTrue();
  }

  /** 저장 위치(WP-1655) — upsert 로 적고, 조건부 지우기는 아직 그 값일 때만 비운다. */
  @Test
  void setLocation_andClearLocationIf_onlyWhenSameValue() {
    long page = reportsPage();
    repository.setLocation(userA, page);
    assertThat(repository.find(userA).orElseThrow().reportLocationPageId()).isEqualTo(page);
    repository.clearLocationIf(userA, page + 1);
    assertThat(repository.find(userA).orElseThrow().reportLocationPageId()).isEqualTo(page);
    repository.clearLocationIf(userA, page);
    assertThat(repository.find(userA).orElseThrow().reportLocationPageId()).isNull();
    repository.setLocation(userA, page);
    repository.setLocation(userA, null);
    assertThat(repository.find(userA).orElseThrow().reportLocationPageId()).isNull();
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

  /** FK 를 만족하는 아무 노트 페이지 — 새 프로젝트 노트 공간의 「리포트」. */
  private long reportsPage() {
    String key = uniqueProjectKey("PS");
    long projectId =
        projectService.create(userA, new CreateProjectRequest(key, "설정-" + key, null, "TEAM")).id();
    return writer.ensureReportsHome(projectId, userA).orElseThrow().reportsPageId();
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

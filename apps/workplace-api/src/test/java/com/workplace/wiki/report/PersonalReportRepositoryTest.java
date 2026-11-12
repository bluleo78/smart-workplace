package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.PersonalReportRepository.Reservation;
import com.workplace.wiki.report.PersonalReportRepository.ReserveStatus;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 개인 보고 회차 저장소(WP-1486) — 예약(이어받기·중복·진행 중), 조회, 개수. */
@Transactional
class PersonalReportRepositoryTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-12T09:00:00+09:00");
  private static final PersonalReportPeriod DAY =
      PersonalReportPeriod.daily(LocalDate.parse("2026-11-11"));

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired PersonalReportRepository repository;
  @Autowired WikiSystemPageWriter writer;

  private long userA;
  private long userB;
  private long pageId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    userA = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(userA);
    userB = withMembership(TestFixtures.createHuman(dsl));
    String key =
        "PR" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    ProjectResponse p =
        projectService.create(userA, new CreateProjectRequest(key, "개인-" + key, null, "TEAM"));
    // page_id 는 wiki_page 외래 키라 실제 노트를 하나 빌린다.
    pageId = writer.ensureReportsHome(p.id(), userA).orElseThrow().reportsPageId();
  }

  @Test
  void reserve_manualTwice_secondInProgress() {
    Reservation first = repository.reserve(userA, DAY, "MANUAL", NOW);
    Reservation second = repository.reserve(userA, DAY, "MANUAL", NOW.plusMinutes(1));
    assertThat(first.status()).isEqualTo(ReserveStatus.RESERVED);
    assertThat(second.status()).isEqualTo(ReserveStatus.IN_PROGRESS);
    assertThat(second.id()).isEqualTo(first.id());
  }

  @Test
  void reserve_takesOverStalePending() {
    Reservation first = repository.reserve(userA, DAY, "MANUAL", NOW);
    dsl.update(table(name("personal_report")))
        .set(field(name("reserved_at"), OffsetDateTime.class), NOW.minusMinutes(31))
        .where(field(name("id"), Long.class).eq(first.id()))
        .execute();
    Reservation again = repository.reserve(userA, DAY, "MANUAL", NOW);
    assertThat(again.status()).isEqualTo(ReserveStatus.RESERVED);
    assertThat(again.id()).isEqualTo(first.id());
  }

  @Test
  void reserve_autoAfterAutoDone_duplicate() {
    Reservation first = repository.reserve(userA, DAY, "AUTO", NOW);
    repository.markSkipped(first.id(), 0, 0, 0, NOW);
    assertThat(repository.reserve(userA, DAY, "AUTO", NOW).status())
        .isEqualTo(ReserveStatus.DUPLICATE);
    // 자동이 건너뛴 날도 수동으로는 만들 수 있다.
    assertThat(repository.reserve(userA, DAY, "MANUAL", NOW).status())
        .isEqualTo(ReserveStatus.RESERVED);
  }

  /**
   * 수동 GENERATED 는 그날이 끝난 뒤(다음 날 0시 KST 이후) 만든 것만 자동 일일을 막는다 — 11/11 15:00 에 만든 11/11 일일은 그날 내용이 덜
   * 끝난 것이라 11/12 09:00 자동은 예약되고, 11/12 08:00 에 만든 것이면 DUPLICATE.
   */
  @Test
  void reserve_autoAfterManualGenerated_onlyClosedWhenMadeAfterDayEnded() {
    Reservation duringDay = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.markGenerated(duringDay.id(), pageId, 1, 2, 3, NOW);
    setCreatedAt(duringDay.id(), OffsetDateTime.parse("2026-11-11T15:00:00+09:00"));
    Reservation auto = repository.reserve(userA, DAY, "AUTO", NOW);
    assertThat(auto.status()).isEqualTo(ReserveStatus.RESERVED);
    repository.release(auto.id());

    Reservation nextMorning = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.markGenerated(nextMorning.id(), pageId, 1, 2, 3, NOW);
    setCreatedAt(nextMorning.id(), OffsetDateTime.parse("2026-11-12T08:00:00+09:00"));
    assertThat(repository.reserve(userA, DAY, "AUTO", NOW).status())
        .isEqualTo(ReserveStatus.DUPLICATE);
  }

  /** mark 셋은 PENDING 행만 바꾼다 — 이미 GENERATED 인 행에 늦게 온 markFailed·markSkipped 는 아무 것도 하지 않는다. */
  @Test
  void mark_onFinishedRow_noop() {
    Reservation r = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.markGenerated(r.id(), pageId, 1, 2, 3, NOW);

    repository.markFailed(r.id(), "늦은 실패", NOW);
    repository.markSkipped(r.id(), 0, 0, 0, NOW);
    repository.markGenerated(r.id(), pageId, 9, 9, 9, NOW);

    var row = repository.findById(r.id()).orElseThrow();
    assertThat(row.status()).isEqualTo("GENERATED");
    assertThat(row.pageId()).isEqualTo(pageId);
    assertThat(row.error()).isNull();
    assertThat(
            dsl.select(field(name("completed"), Integer.class))
                .from(table(name("personal_report")))
                .where(field(name("id"), Long.class).eq(r.id()))
                .fetchOne(0, Integer.class))
        .isEqualTo(1);
  }

  @Test
  void latestGenerated_ignoresDeletedPage() {
    Reservation r = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.markGenerated(r.id(), pageId, 1, 0, 0, NOW);
    assertThat(repository.latestGenerated(userA, DAY)).isPresent();
    assertThat(repository.latestGenerated(userA, DAY).get().pageId()).isEqualTo(pageId);
    assertThat(repository.countGenerated(userA, DAY)).isEqualTo(1);
    dsl.update(table(name("personal_report")))
        .setNull(field(name("page_id"), Long.class))
        .where(field(name("id"), Long.class).eq(r.id()))
        .execute();
    assertThat(repository.latestGenerated(userA, DAY)).isEmpty();
    assertThat(repository.countGenerated(userA, DAY)).isEqualTo(1);
  }

  @Test
  void find_otherUsersId_empty() {
    Reservation r = repository.reserve(userA, DAY, "MANUAL", NOW);
    assertThat(repository.find(userA, r.id())).isPresent();
    assertThat(repository.find(userB, r.id())).isEmpty();
    assertThat(repository.findById(r.id())).isPresent();
  }

  @Test
  void countManualSince_countsOnlyManual() {
    repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.reserve(
        userA, PersonalReportPeriod.daily(LocalDate.parse("2026-11-10")), "AUTO", NOW);
    assertThat(repository.countManualSince(userA, NOW.minusHours(1))).isEqualTo(1);
    assertThat(repository.countManualSince(userA, NOW.plusHours(1))).isZero();
    assertThat(repository.countManualSince(userB, NOW.minusHours(1))).isZero();
  }

  @Test
  void release_deletesWithoutPage_keepsWithPage() {
    Reservation a = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.release(a.id());
    assertThat(repository.findById(a.id())).isEmpty();

    Reservation b = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.attachPage(b.id(), pageId);
    assertThat(repository.pendingPageId(b.id())).contains(pageId);
    repository.release(b.id());
    assertThat(repository.reserve(userA, DAY, "MANUAL", NOW).status())
        .isEqualTo(ReserveStatus.RESERVED);
  }

  @Test
  void insertFailed_closesAutoDay() {
    repository.insertFailed(userA, DAY, "x".repeat(600), NOW.minusDays(1));
    // 만든 시각은 부른 쪽이 준 시각이다(JVM 시계가 아니다).
    assertThat(
            dsl.select(field(name("created_at"), OffsetDateTime.class))
                .from(table(name("personal_report")))
                .where(field(name("user_id"), Long.class).eq(userA))
                .fetchOne(0, OffsetDateTime.class)
                .toInstant())
        .isEqualTo(NOW.minusDays(1).toInstant());
    assertThat(repository.reserve(userA, DAY, "AUTO", NOW).status())
        .isEqualTo(ReserveStatus.DUPLICATE);
  }

  /** FAILED 행은 페이지가 있을 때만 「(n)」 번호 개수에 들어간다. */
  @Test
  void countGenerated_countsFailedOnlyWithPage() {
    Reservation withPage = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.attachPage(withPage.id(), pageId);
    repository.markFailed(withPage.id(), "boom", NOW);
    assertThat(repository.countGenerated(userA, DAY)).isEqualTo(1);

    Reservation noPage = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.markFailed(noPage.id(), "boom", NOW);
    assertThat(repository.countGenerated(userA, DAY)).isEqualTo(1);
  }

  /** 자동 비-PENDING 행이 같은 날 둘이면 uq_personal_report_auto 가 막는다(경쟁에 진 쪽이 크게 실패). */
  @Test
  void uniqueAuto_secondNonPendingAutoRowViolates() {
    insertRaw("AUTO", "SKIPPED");
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> insertRaw("AUTO", "FAILED"))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class)
        .hasMessageContaining("uq_personal_report_auto");
  }

  /** 같은 회차 PENDING 이 둘이면 uq_personal_report_pending 이 막는다. */
  @Test
  void uniquePending_secondPendingRowViolates() {
    insertRaw("MANUAL", "PENDING");
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> insertRaw("MANUAL", "PENDING"))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class)
        .hasMessageContaining("uq_personal_report_pending");
  }

  /** 예약 행에 markGenerated 하면 상태·페이지·숫자와 부른 쪽이 준 만든 시각이 남는다. */
  @Test
  void markGenerated_persistsFields() {
    Reservation r = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.markGenerated(r.id(), pageId, 4, 5, 6, NOW.plusMinutes(3));
    var row = repository.findById(r.id()).orElseThrow();
    assertThat(row.status()).isEqualTo("GENERATED");
    assertThat(row.createdAt().toInstant()).isEqualTo(NOW.plusMinutes(3).toInstant());
    assertThat(row.pageId()).isEqualTo(pageId);
    var rec =
        dsl.select(
                field(name("completed"), Integer.class),
                field(name("created"), Integer.class),
                field(name("status_changed"), Integer.class))
            .from(table(name("personal_report")))
            .where(field(name("id"), Long.class).eq(r.id()))
            .fetchOne();
    assertThat(rec.value1()).isEqualTo(4);
    assertThat(rec.value2()).isEqualTo(5);
    assertThat(rec.value3()).isEqualTo(6);
  }

  /** markFailed 는 상태 FAILED·오류 앞 500자·페이지 유지와 부른 쪽이 준 시각을 남긴다. */
  @Test
  void markFailed_persistsTrimmedErrorAndKeepsPage() {
    Reservation r = repository.reserve(userA, DAY, "MANUAL", NOW);
    repository.attachPage(r.id(), pageId);
    repository.markFailed(r.id(), "e".repeat(700), NOW.plusMinutes(4));
    var row = repository.findById(r.id()).orElseThrow();
    assertThat(row.createdAt().toInstant()).isEqualTo(NOW.plusMinutes(4).toInstant());
    assertThat(row.status()).isEqualTo("FAILED");
    assertThat(row.pageId()).isEqualTo(pageId);
    assertThat(row.error()).hasSize(500);
  }

  /** 회차의 만든 시각을 덮어쓴다(그날 안/뒤에 만든 경우를 만든다). */
  private void setCreatedAt(long id, OffsetDateTime at) {
    dsl.update(table(name("personal_report")))
        .set(field(name("created_at"), OffsetDateTime.class), at)
        .where(field(name("id"), Long.class).eq(id))
        .execute();
  }

  /** unique 가드 검증용 직접 insert. */
  private void insertRaw(String trigger, String status) {
    dsl.insertInto(table(name("personal_report")))
        .columns(
            field(name("user_id"), Long.class),
            field(name("kind"), String.class),
            field(name("period_start"), LocalDate.class),
            field(name("period_end"), LocalDate.class),
            field(name("trigger"), String.class),
            field(name("status"), String.class))
        .values(userA, "DAILY", DAY.start(), DAY.end(), trigger, status)
        .execute();
  }
}

package com.workplace.wiki.report;

import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.ReportCadence;
import com.workplace.issue.report.ReportPeriod;
import com.workplace.issue.report.ReportSnapshot;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.ProjectReportRepository.Reserve;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 리포트 회차 저장소(WP-1483) — 같은 회차 예약은 한 번만(만들었으면 DUPLICATE), 30분 넘게 묵은 PENDING 은 이어받는다, 지난 스냅숏·최근
 * GENERATED 목록.
 */
@Transactional
class ProjectReportRepositoryTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");
  private static final ReportPeriod PERIOD =
      new ReportPeriod(
          LocalDate.parse("2026-11-09"), LocalDate.parse("2026-11-15"), ReportCadence.WEEKLY);

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired ProjectReportRepository repository;
  @Autowired WikiSystemPageWriter writer;

  private long projectId;
  private long pageId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    long owner = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(owner);
    String key = uniqueProjectKey("RR");
    ProjectResponse p =
        projectService.create(owner, new CreateProjectRequest(key, "회차-" + key, null, "TEAM"));
    projectId = p.id();
    // 만듦 기록에 쓸 실제 노트 페이지(page_id 는 wiki_page 외래 키) — 「리포트」 페이지를 빌려 쓴다.
    pageId = writer.ensureReportsHome(projectId, owner).orElseThrow().reportsPageId();
  }

  /** 예약 → 만듦 기록 뒤 같은 회차를 다시 예약하면 DUPLICATE. 만들기 전 PENDING 이 살아 있어도 DUPLICATE. */
  @Test
  void reserve_duplicateAfterGenerated() {
    assertThat(repository.reserve(projectId, PERIOD, NOW)).isEqualTo(Reserve.RESERVED);
    // 아직 PENDING(30분 안) — 다른 실행이 잡고 있다.
    assertThat(repository.reserve(projectId, PERIOD, NOW.plusMinutes(5)))
        .isEqualTo(Reserve.DUPLICATE);

    repository.markGenerated(
        projectId, PERIOD, pageId, "ON_TRACK", new ReportSnapshot(1, 2, 3, 0, "ON_TRACK"), NOW);
    // 30분이 지나도 GENERATED 는 이어받지 않는다.
    assertThat(repository.reserve(projectId, PERIOD, NOW.plusHours(2)))
        .isEqualTo(Reserve.DUPLICATE);
  }

  /** 같은 날 시작해도 끝날이 다르면(주기 변경) 다른 회차다 — 각각 예약된다. */
  @Test
  void reserve_sameStartDifferentEnd_isAnotherPeriod() {
    ReportPeriod biweekly =
        new ReportPeriod(PERIOD.start(), PERIOD.start().plusDays(13), ReportCadence.BIWEEKLY);
    assertThat(repository.reserve(projectId, PERIOD, NOW)).isEqualTo(Reserve.RESERVED);
    assertThat(repository.reserve(projectId, biweekly, NOW)).isEqualTo(Reserve.RESERVED);
  }

  /** 30분 넘게 묵은 PENDING(실행 중 파드가 죽음)은 이어받는다. 지운(release) 회차는 다시 예약할 수 있다. */
  @Test
  void reserve_takesOverStalePending() {
    assertThat(repository.reserve(projectId, PERIOD, NOW)).isEqualTo(Reserve.RESERVED);
    assertThat(repository.reserve(projectId, PERIOD, NOW.plusMinutes(31)))
        .isEqualTo(Reserve.RESERVED);
    // 이어받은 시각부터 다시 30분.
    assertThat(repository.reserve(projectId, PERIOD, NOW.plusMinutes(40)))
        .isEqualTo(Reserve.DUPLICATE);

    repository.release(projectId, PERIOD);
    assertThat(repository.reserve(projectId, PERIOD, NOW.plusMinutes(41)))
        .isEqualTo(Reserve.RESERVED);
  }

  /** 지난 스냅숏은 그 회차 앞의 GENERATED/SKIPPED 중 최신, 최근 목록은 GENERATED 만 최신순. */
  @Test
  void lastSnapshot_andRecentGenerated() {
    ReportPeriod prev = PERIOD.previous();
    ReportPeriod prev2 = prev.previous();
    repository.reserve(projectId, prev2, NOW);
    repository.markSkipped(projectId, prev2, new ReportSnapshot(0, 0, 5, 1, "WARN"), NOW);
    repository.reserve(projectId, prev, NOW);
    repository.markSkipped(projectId, prev, new ReportSnapshot(0, 0, 7, 2, "RISK"), NOW);
    repository.reserve(projectId, PERIOD, NOW);

    assertThat(repository.lastSnapshot(projectId, PERIOD.start()))
        .contains(new ReportSnapshot(0, 0, 7, 2, "RISK"));
    assertThat(repository.lastSnapshot(projectId, prev2.start())).isEmpty();
    assertThat(repository.recentGenerated(projectId, 10)).isEmpty();
    assertThat(repository.lastGeneratedBadge(projectId, PERIOD.start())).isEmpty();

    repository.markGenerated(
        projectId, PERIOD, pageId, "WARN", new ReportSnapshot(1, 1, 7, 2, "WARN"), NOW);
    assertThat(repository.recentGenerated(projectId, 10))
        .extracting(
            ProjectReportRepository.ReportRow::pageId, ProjectReportRepository.ReportRow::badge)
        .containsExactly(tuple(pageId, "WARN"));
    assertThat(repository.lastGeneratedBadge(projectId, PERIOD.start().plusDays(7)))
        .contains("WARN");
  }

  // ───────────── 「지금 생성」(WP-1630) ─────────────

  /**
   * 새로 넣은 행에서 페이지를 만든 뒤 실패하면 한 번 실패로 회차를 닫지 않는다 — 곧바로 이어받을 수 있는 PENDING 으로 남아 정기 실행이 그 페이지를 다시
   * 쓴다(코드 리뷰: 첫 실패에 FAILED 로 닫아 정기 재시도가 막히던 것).
   */
  @Test
  void restoreNow_newRowWithPage_leavesTakeoverablePending() {
    var takeover = repository.reserveNow(projectId, PERIOD, NOW).orElseThrow();
    repository.attachPage(projectId, PERIOD, pageId);

    repository.restoreNow(projectId, PERIOD, takeover);

    assertThat(repository.inProgress(projectId, PERIOD, NOW)).isFalse();
    assertThat(repository.reserve(projectId, PERIOD, NOW.plusMinutes(1)))
        .isEqualTo(Reserve.RESERVED);
    assertThat(repository.pendingPageId(projectId, PERIOD)).contains(pageId);
  }

  /**
   * 리포트 페이지가 지워졌던 GENERATED 회차는 실패 뒤 페이지 id 까지 되돌린다 — 이번에 만든 빈 페이지가 개요 카드의 최신 리포트로 보이지 않게(코드 리뷰).
   */
  @Test
  void restoreNow_generated_restoresStatusAndPage() {
    repository.reserve(projectId, PERIOD, NOW);
    repository.markGenerated(
        projectId, PERIOD, pageId, "ON_TRACK", new ReportSnapshot(1, 2, 3, 0, "ON_TRACK"), NOW);
    // 페이지를 지운 것처럼(외래 키 ON DELETE SET NULL 과 같은 상태).
    dsl.update(table(name("project_report")))
        .setNull(field(name("page_id")))
        .where(field(name("project_id"), Long.class).eq(projectId))
        .execute();
    var takeover = repository.reserveNow(projectId, PERIOD, NOW.plusHours(1)).orElseThrow();
    assertThat(takeover.previousStatus()).isEqualTo("GENERATED");
    assertThat(repository.inProgress(projectId, PERIOD, NOW.plusHours(1))).isTrue();
    repository.attachPage(projectId, PERIOD, pageId);

    repository.restoreNow(projectId, PERIOD, takeover);

    assertThat(repository.recentGenerated(projectId, 10)).isEmpty();
    assertThat(repository.reserve(projectId, PERIOD, NOW.plusHours(2)))
        .isEqualTo(Reserve.DUPLICATE);
  }

  /** 만드는 중 판정은 30분 안의 PENDING 만 — 묵은 예약은 만드는 중이 아니다. */
  @Test
  void inProgress_onlyFreshPending() {
    repository.reserveNow(projectId, PERIOD, NOW);
    assertThat(repository.inProgress(projectId, PERIOD, NOW.plusMinutes(29))).isTrue();
    assertThat(repository.inProgress(projectId, PERIOD, NOW.plusMinutes(31))).isFalse();
    assertThat(repository.reserveNow(projectId, PERIOD, NOW.plusMinutes(5))).isEmpty();
  }
}

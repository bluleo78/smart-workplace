package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.ReportCadence;
import com.workplace.issue.report.ReportPeriod;
import com.workplace.issue.report.ReportSnapshot;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.dto.ProjectReportCardResponse;
import com.workplace.wiki.report.dto.ReportListItem;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.ReportsHome;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개요 카드 리포트 줄(WP-1483) — 최신 리포트의 배지·한 줄은 페이지 본문을 그때 읽고(고치면 바뀜, 수정됨 표시), 못 읽으면 저장 배지. 지난 목록은 최신부터
 * 10개·지워진 페이지 제외. 노트 공간 멤버가 아니면 숨김(프로젝트 ADMIN 이라도), 프로젝트를 못 읽으면 404, 리포트가 없으면 빈 응답.
 */
@Transactional
class ProjectReportCardServiceTest extends ExternalClientMockedTestBase {

  /** 11월 9일 ~ 15일 회차, 16일 09:00 KST 생성. */
  private static final LocalDate START = LocalDate.parse("2026-11-09");

  private static final OffsetDateTime RUN = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");

  private static final String BODY =
      """
      ## 상태와 한 줄

      **주의** · 순조로움 → 주의

      검토 대기가 늘어 일정이 밀렸어요.
      """;

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired WikiPageService pageService;
  @Autowired WikiSystemPageWriter writer;
  @Autowired ProjectReportRepository reports;
  @Autowired ProjectReportCardService service;

  private long ownerId;
  private ProjectResponse project;
  private ReportsHome home;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    String key =
        "RC" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    project =
        projectService.create(ownerId, new CreateProjectRequest(key, "카드-" + key, null, "TEAM"));
    home = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
  }

  /** 최신 리포트 줄은 본문을 그때 읽는다 — 사람이 한 줄을 고치면 카드 줄이 바뀌고 「수정됨」(edited)이 된다. */
  @Test
  void card_latestReadsEditedPageLive() {
    long pageId = report(START, BODY, "ON_TRACK");

    ProjectReportCardResponse before = service.card(ownerId, project.key());
    assertThat(before.latest().pageId()).isEqualTo(pageId);
    assertThat(before.latest().title()).isEqualTo("11월 3주차 주간 리포트");
    assertThat(before.latest().badge()).isEqualTo("WARN");
    assertThat(before.latest().line()).isEqualTo("검토 대기가 늘어 일정이 밀렸어요.");
    assertThat(before.latest().edited()).isFalse();
    assertThat(before.latest().periodStart()).isEqualTo(START);
    assertThat(before.latest().periodEnd()).isEqualTo(START.plusDays(6));
    assertThat(before.latest().createdAt().toInstant()).isEqualTo(RUN.toInstant());
    assertThat(before.cadenceLabel()).isEqualTo("주간");
    assertThat(before.reportsPageId()).isEqualTo(home.reportsPageId());

    WikiPageDetail page = pageService.get(ownerId, pageId);
    pageService.save(
        ownerId,
        pageId,
        new SavePageRequest(null, BODY.replace("검토 대기가 늘어", "사람이 고친 줄:"), page.version(), false));
    // 같은 트랜잭션 안의 now() 는 같은 값이라, AI 작성 시각을 고친 시각보다 앞으로 둔다(사람이 나중에 고침).
    aiUsedAt(pageId, pageService.get(ownerId, pageId).updatedAt().minusMinutes(5));

    ProjectReportCardResponse after = service.card(ownerId, project.key());
    assertThat(after.latest().line()).isEqualTo("사람이 고친 줄: 일정이 밀렸어요.");
    assertThat(after.latest().edited()).isTrue();
    assertThat(after.past()).first().extracting(ReportListItem::edited).isEqualTo(true);
  }

  /** 본문에서 배지를 못 읽으면(배지 줄을 지움) 생성 때 저장한 배지를 쓴다. */
  @Test
  void card_badgeFallsBackToStored_whenUnparseable() {
    report(START, "## 상태와 한 줄\n\n배지 없이 쓴 한 줄.\n", "RISK");

    ProjectReportCardResponse r = service.card(ownerId, project.key());
    assertThat(r.latest().badge()).isEqualTo("RISK");
    assertThat(r.latest().line()).isEqualTo("배지 없이 쓴 한 줄.");
  }

  /** 지난 목록 — 최신 회차부터, 최대 10개, 지워진 페이지는 뺀다. 목록 배지는 저장값. */
  @Test
  void card_pastNewestFirst_max10_excludesDeletedPages() {
    long deleted = 0;
    for (int i = 0; i < 12; i++) {
      long id = report(START.minusWeeks(i), BODY, i % 2 == 0 ? "ON_TRACK" : "RISK");
      if (i == 1) {
        deleted = id;
      }
    }
    pageService.delete(ownerId, deleted);

    ProjectReportCardResponse r = service.card(ownerId, project.key());
    assertThat(r.past()).hasSize(10);
    assertThat(r.past()).extracting(ReportListItem::pageId).doesNotContain(deleted);
    assertThat(r.past())
        .extracting(ReportListItem::periodStart)
        .containsExactly(
            START,
            START.minusWeeks(2),
            START.minusWeeks(3),
            START.minusWeeks(4),
            START.minusWeeks(5),
            START.minusWeeks(6),
            START.minusWeeks(7),
            START.minusWeeks(8),
            START.minusWeeks(9),
            START.minusWeeks(10));
    assertThat(r.past().get(0).badge()).isEqualTo("ON_TRACK");
    assertThat(r.past().get(1).badge()).isEqualTo("ON_TRACK");
    assertThat(r.past().get(2).badge()).isEqualTo("RISK");
    assertThat(r.latest().pageId()).isEqualTo(r.past().get(0).pageId());
  }

  /** 공간 멤버가 아닌 프로젝트 ADMIN — 프로젝트는 읽지만 노트를 볼 수 없어 latest=null, past=[]. */
  @Test
  void card_hiddenForNonSpaceMember() {
    report(START, BODY, "ON_TRACK");
    long admin = human();
    TestFixtures.grantRole(dsl, admin, "ADMIN");

    ProjectReportCardResponse r = service.card(admin, project.key());
    assertThat(r.latest()).isNull();
    assertThat(r.past()).isEmpty();
    assertThat(r.reportsPageId()).isNull();
  }

  /** 프로젝트를 못 읽는 사람 — 404(존재 은닉). */
  @Test
  void card_unreadableProject_404() {
    long stranger = human();
    assertThatThrownBy(() -> service.card(stranger, project.key()))
        .isInstanceOf(ProjectNotFoundException.class);
  }

  /** 리포트가 하나도 없으면 빈 응답. */
  @Test
  void card_noReports_empty() {
    ProjectReportCardResponse r = service.card(ownerId, project.key());
    assertThat(r.latest()).isNull();
    assertThat(r.past()).isEmpty();
    assertThat(r.cadenceLabel()).isNull();
  }

  /** 생성기처럼 리포트 한 편을 만든다 — 「리포트」 아래 페이지, 본문, AI 작성 표지(수정 시각과 같게), GENERATED 회차. */
  private long report(LocalDate start, String body, String storedBadge) {
    ReportPeriod period = new ReportPeriod(start, start.plusDays(6), ReportCadence.WEEKLY);
    WikiPageDetail page =
        writer.createPage(ownerId, home.spaceId(), home.reportsPageId(), period.title());
    WikiPageDetail written =
        writer.writeBody(ownerId, page.id(), page.version(), body, true, false);
    writer.markAiReport(page.id(), written.updatedAt());
    reports.reserve(project.id(), period, RUN);
    reports.markGenerated(
        project.id(),
        period,
        page.id(),
        storedBadge,
        new ReportSnapshot(1, 1, 1, 0, storedBadge),
        RUN);
    return page.id();
  }

  private void aiUsedAt(long pageId, OffsetDateTime at) {
    dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.AI_LAST_USED_AT, at)
        .where(WIKI_PAGE.ID.eq(pageId))
        .execute();
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }
}

package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.ProjectReportAiRequest;
import com.workplace.issue.outbound.dto.ProjectReportAiResult;
import com.workplace.issue.report.ProjectReportFactsService;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.ProjectReportGenerator.Outcome;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.report.dto.UpdateProjectReportSettingsRequest;
import com.workplace.wiki.repository.ProjectNoteSpaceRepository;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.test.util.AopTestUtils;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 리포트 생성기(WP-1483) — 「리포트」 아래 최신이 위로 페이지를 만들고, AI 글의 지시 상자·틀린 숫자·배지를 바로잡고, 「AI 작성」
 * 표지·작성자(「리포트」와 같은 규칙)를 남긴다. 회차 중복 방지, 변화 없음 건너뜀, 실패 재시도(30분)·3회째 다음 예정, 비서 없음·꺼짐, 「리포트」·템플릿 복구, 긴
 * 정지 뒤 최신 회차 하나, 사람이 고친 템플릿 전달, 상한(템플릿·AI 출력)을 고정한다.
 *
 * <p>「지금」은 2026-11-16(월) 09:00 KST — 회차는 11/9~15(11월 3주차). AI 클라이언트·비서 해석은 목이다.
 */
@Transactional
class ProjectReportGeneratorTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired WikiPageService pageService;
  @Autowired WikiSystemPageWriter writer;
  @Autowired ProjectReportSettingsService settingsService;
  @Autowired ProjectReportSettingRepository settings;
  @Autowired ProjectReportGenerator generator;
  @Autowired AiAgentIssueClient client;
  @Autowired AssistantResolver assistantResolver;

  @Value("${workplace.public-base-url:}")
  String baseUrl;

  private long owner;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = human();
    String key =
        "RG" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    project =
        projectService.create(owner, new CreateProjectRequest(key, "리포트-" + key, null, "TEAM"));
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(owner, "m", "low", 4, 60_000)));
    settingsService.update(
        owner,
        project.key(),
        new UpdateProjectReportSettingsRequest(true, "WEEKLY", "MONDAY", "09:00"));
    dueAt(NOW);
  }

  // ───────────── 헬퍼 ─────────────

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }

  private static OffsetDateTime kst(String localDateTime) {
    return OffsetDateTime.parse(localDateTime + "+09:00");
  }

  /** next_run_at 을 정한다(테스트가 「때가 됐다」를 만든다). */
  private void dueAt(OffsetDateTime at) {
    dsl.update(table(name("project_report_setting")))
        .set(field(name("next_run_at"), OffsetDateTime.class), at)
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .execute();
  }

  /** 기간 안에 생기고 닫힌(DONE) 이슈 하나 — 완료 1·새로 생김 1. 이슈 번호를 돌려준다. */
  private int activity(OffsetDateTime createdAt) {
    var created =
        issueService.create(
            owner,
            project.key(),
            new CreateIssueRequest("리포트 이슈", null, null, null, null, null, null, null));
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(created.id())).execute();
    dsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.eq(created.id())).execute();
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .set(ISSUE.CREATED_AT, createdAt)
        .set(ISSUE.UPDATED_AT, createdAt)
        .set(ISSUE.CLOSED_AT, createdAt.plusHours(2))
        .where(ISSUE.ID.eq(created.id()))
        .execute();
    return dsl.select(ISSUE.NUMBER)
        .from(ISSUE)
        .where(ISSUE.ID.eq(created.id()))
        .fetchOne(ISSUE.NUMBER);
  }

  private int activity() {
    return activity(kst("2026-11-10T10:00:00"));
  }

  private String issueUrl(int number) {
    String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    return base + "/projects/" + project.key() + "/issues/" + number;
  }

  /** AI 목 — 맨 앞 h1·지시 상자·틀린 배지·틀린 숫자·글이 붙은 이슈 링크를 담은 마크다운. */
  private void aiReturnsMessy(int issueNumber) {
    String md =
        """
        # 엉뚱한 제목

        <div class="wp-ai-instruction">

        지시 상자가 새어 나옴

        </div>

        ## 상태와 한 줄

        **위험** · 순조로움 → 위험

        이번 주는 일이 잘 끝났어요.

        ## 지난 리포트 이후

        | 지난 리포트 이후 | 이번 | 변화 |
        |---|---|---|
        | 완료 | 999 | +500 |
        | 새로 생김 | 1 | +1 |

        ## 한 일

        - [리포트 이슈](%s) 완료
        """
            .formatted(issueUrl(issueNumber));
    doReturn(new ProjectReportAiResult(md)).when(client).writeProjectReport(any());
  }

  private long reportsPageId() {
    return writer.ensureReportsHome(project.id(), owner).orElseThrow().reportsPageId();
  }

  private SettingRow setting() {
    return settings.find(project.id()).orElseThrow();
  }

  private int reportRows() {
    return dsl.fetchCount(
        table(name("project_report")), field(name("project_id"), Long.class).eq(project.id()));
  }

  private String rowStatus(LocalDate periodStart) {
    return dsl.select(field(name("status"), String.class))
        .from(table(name("project_report")))
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .and(field(name("period_start"), LocalDate.class).eq(periodStart))
        .fetchOne(0, String.class);
  }

  private Long rowPageId(LocalDate periodStart) {
    return dsl.select(field(name("page_id"), Long.class))
        .from(table(name("project_report")))
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .and(field(name("period_start"), LocalDate.class).eq(periodStart))
        .fetchOne(0, Long.class);
  }

  private WikiPageDetail page(long id) {
    return writer.findPage(id).orElseThrow();
  }

  private static final LocalDate PERIOD_START = LocalDate.parse("2026-11-09");

  // ───────────── 테스트 ─────────────

  /** 「리포트」 아래 템플릿 바로 밑에 「11월 3주차 주간 리포트」, 다음 회차는 그보다 위. */
  @Test
  void run_createsReportPageUnderReports_newestOnTop() {
    aiReturnsMessy(activity());
    long template = setting().templatePageId();

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.GENERATED);

    long first = rowPageId(PERIOD_START);
    WikiPageDetail p = page(first);
    assertThat(p.title()).isEqualTo("11월 3주차 주간 리포트");
    WikiPageDetail parent = page(p.parentId());
    assertThat(parent.title()).isEqualTo("리포트");
    assertThat(writer.childIdsOrdered(parent.id())).containsExactly(template, first);
    assertThat(rowStatus(PERIOD_START)).isEqualTo("GENERATED");

    // 다음 주 — 새 회차(11/16~22)가 지난 것보다 위.
    activity(kst("2026-11-17T10:00:00"));
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(NOW.plusDays(7).toInstant());
    assertThat(generator.run(project.id(), NOW.plusDays(7))).isEqualTo(Outcome.GENERATED);
    long second = rowPageId(LocalDate.parse("2026-11-16"));
    assertThat(page(second).title()).isEqualTo("11월 4주차 주간 리포트");
    assertThat(writer.childIdsOrdered(parent.id())).containsExactly(template, second, first);
  }

  @Test
  void run_stripsInstructionBoxes() {
    aiReturnsMessy(activity());
    generator.run(project.id(), NOW);
    String body = page(rowPageId(PERIOD_START)).body();
    assertThat(body).doesNotContain("wp-ai-instruction").doesNotContain("지시 상자가 새어 나옴");
    assertThat(body).doesNotContain("# 엉뚱한 제목");
    assertThat(body).contains("이번 주는 일이 잘 끝났어요.");
  }

  @Test
  void run_fixesWrongNumbersFromAi() {
    aiReturnsMessy(activity());
    generator.run(project.id(), NOW);
    String body = page(rowPageId(PERIOD_START)).body();
    assertThat(body).doesNotContain("999").doesNotContain("+500");
    assertThat(body)
        .contains("| 완료 | 1 | +1 |")
        .contains("| 새로 생김 | 1 | +1 |")
        .contains("| 열린 이슈 | 0 | — |")
        .contains("| 기한 지남 | 0 | — |");
  }

  /** 배지는 시스템 규칙(사이클 없음 → 순조로움)으로 — AI 가 쓴 「위험」은 고쳐진다. 저장 배지도 시스템 값. */
  @Test
  void run_fixesBadgeFromSystemRule() {
    aiReturnsMessy(activity());
    generator.run(project.id(), NOW);
    String body = page(rowPageId(PERIOD_START)).body();
    assertThat(body).contains("**순조로움**").doesNotContain("**위험**");
    assertThat(
            dsl.select(field(name("badge"), String.class))
                .from(table(name("project_report")))
                .where(field(name("project_id"), Long.class).eq(project.id()))
                .fetchOne(0, String.class))
        .isEqualTo("ON_TRACK");
  }

  /** OWNER 멤버 행을 넣는다(멤버가 된 시각 지정). */
  private void addOwner(long userId, OffsetDateTime since) {
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, project.id())
        .set(PROJECT_MEMBER.USER_ID, userId)
        .set(PROJECT_MEMBER.ROLE, "OWNER")
        .set(PROJECT_MEMBER.CREATED_AT, since)
        .execute();
  }

  /**
   * 「AI 작성」 표지(report) + 작성자는 「리포트」와 같은 규칙 — 프로젝트 소유자가 직접 멤버면 소유자(더 먼저 OWNER 가 된 사람이 있어도). 표지 시각은
   * 마지막 수정 시각보다 늦거나 같다(코드 리뷰 #7).
   */
  @Test
  void run_marksAiReportAndAuthorIsProjectOwner() {
    addOwner(human(), kst("2020-01-01T00:00:00"));
    aiReturnsMessy(activity());

    generator.run(project.id(), NOW);

    WikiPageDetail p = page(rowPageId(PERIOD_START));
    assertThat(p.aiLastAction()).isEqualTo("report");
    assertThat(p.updatedBy()).isEqualTo(owner);
    assertThat(p.aiLastUsedAt()).isAfterOrEqualTo(p.updatedAt());
  }

  /** 소유자가 프로젝트를 떠났으면 지금 OWNER 중 가장 작은 id 가 작성자다 — 멤버가 된 시각 순이 아니다(코드 리뷰 #7). */
  @Test
  void run_authorIsSmallestOwnerId_whenProjectOwnerLeft() {
    long smaller = human();
    long larger = human();
    addOwner(smaller, kst("2021-01-01T00:00:00"));
    addOwner(larger, kst("2020-01-01T00:00:00"));
    // 활동은 소유자가 아직 멤버일 때 만든다(이슈 생성 권한).
    aiReturnsMessy(activity());
    dsl.deleteFrom(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(project.id()))
        .and(PROJECT_MEMBER.USER_ID.eq(owner))
        .execute();

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.GENERATED);

    assertThat(page(rowPageId(PERIOD_START)).updatedBy()).isEqualTo(smaller);
  }

  @Test
  void run_issueLinksAreBareAppUrls() {
    int number = activity();
    aiReturnsMessy(number);
    generator.run(project.id(), NOW);
    String body = page(rowPageId(PERIOD_START)).body();
    assertThat(body).contains("- " + issueUrl(number) + " 완료").doesNotContain("](");
  }

  /** next_run_at 을 되돌려 같은 회차를 다시 돌려도 페이지는 하나(DUPLICATE). */
  @Test
  void run_samePeriodTwice_createsOnePage() {
    aiReturnsMessy(activity());
    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.GENERATED);
    dueAt(NOW);
    assertThat(generator.run(project.id(), NOW.plusHours(1))).isEqualTo(Outcome.DUPLICATE);
    assertThat(reportRows()).isEqualTo(1);
    assertThat(writer.childIdsOrdered(reportsPageId())).hasSize(2);
    verify(client, times(1)).writeProjectReport(any());
  }

  /**
   * 주기를 바꿔 새 회차가 지난 회차와 같은 날 시작해도(매주 11/9~15 → 격주 11/9~22) 겹친 회차로 보지 않고 새 리포트를 쓴다 — 회차는 시작일과 끝날로
   * 구분한다(최종 리뷰 #1).
   */
  @Test
  void run_cadenceChangeWithSameStart_writesNewPeriod() {
    aiReturnsMessy(activity());
    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.GENERATED);

    settingsService.update(
        owner, project.key(), new UpdateProjectReportSettingsRequest(true, "BIWEEKLY", null, null));
    activity(kst("2026-11-17T10:00:00"));
    OffsetDateTime later = NOW.plusWeeks(1);
    dueAt(later);

    assertThat(generator.run(project.id(), later)).isEqualTo(Outcome.GENERATED);
    assertThat(reportRows()).isEqualTo(2);
    String status =
        dsl.select(field(name("status"), String.class))
            .from(table(name("project_report")))
            .where(field(name("project_id"), Long.class).eq(project.id()))
            .and(field(name("period_start"), LocalDate.class).eq(PERIOD_START))
            .and(field(name("period_end"), LocalDate.class).eq(LocalDate.parse("2026-11-22")))
            .fetchOne(0, String.class);
    assertThat(status).isEqualTo("GENERATED");
  }

  /** 완료·새로 생김이 없으면 페이지 없이 SKIPPED 로 기록하고 다음 예정(다음 월요일)으로 넘긴다. */
  @Test
  void run_noChange_skipsWithoutPage_andAdvancesNextRun() {
    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.SKIPPED_NO_CHANGE);
    assertThat(rowStatus(PERIOD_START)).isEqualTo("SKIPPED");
    assertThat(rowPageId(PERIOD_START)).isNull();
    assertThat(writer.childIdsOrdered(reportsPageId())).containsExactly(setting().templatePageId());
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(NOW.plusDays(7).toInstant());
    verify(client, never()).writeProjectReport(any());
  }

  /** AI 가 실패하면 예약을 지우고 30분 뒤 같은 회차를 다시 시도한다. */
  @Test
  void run_aiFailure_releasesAndRetriesIn30Minutes() {
    activity();
    when(client.writeProjectReport(any()))
        .thenThrow(new IssueAiException("AI 리포트 작성 요청에 실패했어요.", null));

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.FAILED);

    assertThat(reportRows()).isZero();
    SettingRow s = setting();
    assertThat(s.nextRunAt().toInstant()).isEqualTo(NOW.plusMinutes(30).toInstant());
    assertThat(s.consecutiveFailures()).isEqualTo(1);
    assertThat(lastError()).contains("AI 리포트 작성 요청에 실패했어요.");
    assertThat(writer.childIdsOrdered(reportsPageId())).containsExactly(s.templatePageId());
  }

  /** 연속 세 번째 실패면 그 회차를 버리고 다음 예정(다음 월요일 09:00)으로, 카운터 0. */
  @Test
  void run_thirdFailure_movesToNextSlot() {
    activity();
    when(client.writeProjectReport(any()))
        .thenThrow(new IssueAiException("AI 리포트 작성 요청에 실패했어요.", null));

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.FAILED);
    assertThat(generator.run(project.id(), NOW.plusMinutes(30))).isEqualTo(Outcome.FAILED);
    assertThat(setting().consecutiveFailures()).isEqualTo(2);
    assertThat(generator.run(project.id(), NOW.plusMinutes(60))).isEqualTo(Outcome.FAILED);

    SettingRow s = setting();
    assertThat(s.nextRunAt().toInstant()).isEqualTo(kst("2026-11-23T09:00:00").toInstant());
    assertThat(s.consecutiveFailures()).isZero();
    assertThat(reportRows()).isZero();
  }

  /** 성공하면 실패 카운터와 오류를 지운다. */
  @Test
  void run_successAfterFailure_resetsFailures() {
    int number = activity();
    when(client.writeProjectReport(any()))
        .thenThrow(new IssueAiException("AI 리포트 작성 요청에 실패했어요.", null));
    generator.run(project.id(), NOW);
    aiReturnsMessy(number);

    assertThat(generator.run(project.id(), NOW.plusMinutes(30))).isEqualTo(Outcome.GENERATED);
    assertThat(setting().consecutiveFailures()).isZero();
    assertThat(lastError()).isNull();
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(NOW.plusDays(7).toInstant());
  }

  @Test
  void run_noWorkspaceAssistant_skips() {
    activity();
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.SKIPPED_NO_ASSISTANT);
    assertThat(reportRows()).isZero();
    verify(client, never()).writeProjectReport(any());
  }

  @Test
  void run_disabled_notDue() {
    activity();
    settingsService.update(
        owner, project.key(), new UpdateProjectReportSettingsRequest(false, null, null, null));
    dueAt(NOW);

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.NOT_DUE);
    // 때가 안 된 것도 NOT_DUE.
    settingsService.update(
        owner, project.key(), new UpdateProjectReportSettingsRequest(true, null, null, null));
    dueAt(NOW.plusMinutes(1));
    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.NOT_DUE);
    assertThat(reportRows()).isZero();
  }

  /** 사람이 템플릿과 「리포트」를 지웠어도 새 「리포트」·기본 템플릿을 만들고 계속한다. */
  @Test
  void run_recreatesReportsPageAndTemplate_whenDeleted() {
    aiReturnsMessy(activity());
    long oldTemplate = setting().templatePageId();
    long oldReports = page(oldTemplate).parentId();
    pageService.delete(owner, oldTemplate);
    pageService.delete(owner, oldReports);

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.GENERATED);

    long report = rowPageId(PERIOD_START);
    long reports = page(report).parentId();
    assertThat(reports).isNotEqualTo(oldReports);
    assertThat(page(reports).title()).isEqualTo("리포트");
    long template = setting().templatePageId();
    assertThat(template).isNotEqualTo(oldTemplate);
    assertThat(page(template).title()).isEqualTo("템플릿 · 주간 리포트");
    assertThat(writer.childIdsOrdered(reports)).containsExactly(template, report);
  }

  /** 3주 꺼졌다 켜져도 밀린 회차를 여러 편 만들지 않고 직전 완전 주 하나만. */
  @Test
  void run_afterLongDowntime_writesOnlyLatestPeriod() {
    activity();
    aiReturnsMessy(activity(kst("2026-12-01T10:00:00")));
    OffsetDateTime later = NOW.plusWeeks(3);

    assertThat(generator.run(project.id(), later)).isEqualTo(Outcome.GENERATED);
    assertThat(generator.run(project.id(), later.plusMinutes(5))).isEqualTo(Outcome.NOT_DUE);

    assertThat(reportRows()).isEqualTo(1);
    LocalDate start = LocalDate.parse("2026-11-30");
    assertThat(rowStatus(start)).isEqualTo("GENERATED");
    assertThat(page(rowPageId(start)).title()).isEqualTo("12월 1주차 주간 리포트");
    assertThat(writer.childIdsOrdered(reportsPageId())).hasSize(2);
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(later.plusWeeks(1).toInstant());
  }

  /** 사람이 고친 템플릿 본문(지시 상자 포함)이 AI 요청으로 간다. 회차 문구·배지·표 행도 함께. */
  @Test
  void run_usesEditedTemplate() {
    aiReturnsMessy(activity());
    long template = setting().templatePageId();
    String edited =
        """
        사람이 고친 템플릿

        <div class="wp-ai-instruction">

        짧게 씁니다

        </div>
        """;
    writer.writeBody(owner, template, page(template).version(), edited, false, false);

    generator.run(project.id(), NOW);

    ArgumentCaptor<ProjectReportAiRequest> req =
        ArgumentCaptor.forClass(ProjectReportAiRequest.class);
    verify(client).writeProjectReport(req.capture());
    ProjectReportAiRequest r = req.getValue();
    assertThat(r.templateMarkdown()).contains("사람이 고친 템플릿").contains("짧게 씁니다");
    assertThat(r.title()).isEqualTo("11월 3주차 주간 리포트");
    assertThat(r.periodLabel()).isEqualTo("11월 9일 ~ 15일");
    assertThat(r.cadenceLabel()).isEqualTo("주간");
    assertThat(r.badge()).isEqualTo("ON_TRACK");
    assertThat(r.previousBadge()).isNull();
    assertThat(r.tableRows()).hasSize(4);
    assertThat(r.issues()).hasSize(1);
    assertThat(r.assistantAgentId()).isEqualTo(owner);
    // 리포트는 비서 기본 예산(60초)이 아니라 리포트 전용 예산(180초)으로 쓴다.
    assertThat(r.timeoutMs()).isEqualTo(AiAgentIssueClient.PROJECT_REPORT_TIMEOUT_MS);
    // AI 가 쓴 표는 템플릿에 표가 없어도 계산값으로 바로잡는다.
    assertThat(page(rowPageId(PERIOD_START)).body()).contains("| 완료 | 1 | +1 |");
  }

  /** 템플릿이 20,000자를 넘으면 AI 를 부르지 않고 실패로 본다. */
  @Test
  void run_templateTooLong_fails() {
    activity();
    long template = setting().templatePageId();
    writer.writeBody(owner, template, page(template).version(), "가".repeat(20_001), false, false);

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.FAILED);
    verify(client, never()).writeProjectReport(any());
    assertThat(setting().consecutiveFailures()).isEqualTo(1);
  }

  /** AI 출력이 20,000자를 넘으면 실패 — 페이지를 만들지 않는다. */
  @Test
  void run_tooLongAiOutput_fails() {
    activity();
    when(client.writeProjectReport(any()))
        .thenReturn(new ProjectReportAiResult("가".repeat(20_001)));

    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.FAILED);
    assertThat(reportRows()).isZero();
    assertThat(writer.childIdsOrdered(reportsPageId())).hasSize(1);
  }

  /** 지난 배지는 지난 GENERATED 회차의 배지 — 그 뒤 SKIPPED 회차가 있어도. */
  @Test
  void run_previousBadgeFromLastGenerated() {
    aiReturnsMessy(activity());
    generator.run(project.id(), NOW);
    dsl.update(table(name("project_report")))
        .set(field(name("badge"), String.class), "WARN")
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .execute();
    // 다음 주는 변화 없음 → SKIPPED(배지 ON_TRACK 스냅숏).
    assertThat(generator.run(project.id(), NOW.plusWeeks(1))).isEqualTo(Outcome.SKIPPED_NO_CHANGE);
    activity(kst("2026-11-24T10:00:00"));

    assertThat(generator.run(project.id(), NOW.plusWeeks(2))).isEqualTo(Outcome.GENERATED);

    ArgumentCaptor<ProjectReportAiRequest> req =
        ArgumentCaptor.forClass(ProjectReportAiRequest.class);
    verify(client, times(2)).writeProjectReport(req.capture());
    List<ProjectReportAiRequest> all = req.getAllValues();
    assertThat(all.get(1).previousBadge()).isEqualTo("WARN");
  }

  // ───────────── 페이지를 만든 뒤 실패(Fix round 1) ─────────────

  @Autowired ProjectRepository projectRepository;
  @Autowired ProjectReportRepository reportRepository;
  @Autowired ProjectReportFactsService factsService;
  @Autowired ProjectNoteSpaceRepository noteSpaces;
  @Autowired ProjectReportTemplate reportTemplate;

  /** 노트 쓰기·회차 저장소를 Mockito 스파이로 바꾼 생성기 — 페이지를 만든 뒤의 실패를 만든다(실제 빈의 대상 객체를 감싸 동작은 그대로). */
  private ProjectReportGenerator generatorWith(
      WikiSystemPageWriter spyWriter, ProjectReportRepository spyReports) {
    return new ProjectReportGenerator(
        projectRepository,
        settings,
        spyReports,
        factsService,
        noteSpaces,
        spyWriter,
        reportTemplate,
        assistantResolver,
        client,
        txManager,
        baseUrl);
  }

  private WikiSystemPageWriter spyWriter() {
    return spy((WikiSystemPageWriter) AopTestUtils.getUltimateTargetObject(writer));
  }

  private ProjectReportRepository spyReports() {
    return spy((ProjectReportRepository) AopTestUtils.getUltimateTargetObject(reportRepository));
  }

  /** 템플릿 말고 「리포트」 아래 리포트 페이지 수. */
  private int reportPages() {
    return writer.childIdsOrdered(reportsPageId()).size() - 1;
  }

  /** 페이지를 만든 뒤 회차 저장(markGenerated)이 실패해도 회차 행을 지우지 않는다 — 30분 뒤 재시도는 그 페이지를 다시 써서 회차당 페이지는 하나. */
  @Test
  void run_markGeneratedFails_retryReusesPage() {
    aiReturnsMessy(activity());
    ProjectReportRepository reportsSpy = spyReports();
    doThrow(new IllegalStateException("저장 실패"))
        .doCallRealMethod()
        .when(reportsSpy)
        .markGenerated(anyLong(), any(), anyLong(), any(), any(), any());
    ProjectReportGenerator g = generatorWith(writer, reportsSpy);

    assertThat(g.run(project.id(), NOW)).isEqualTo(Outcome.FAILED);
    Long firstPage = rowPageId(PERIOD_START);
    assertThat(firstPage).isNotNull();
    assertThat(rowStatus(PERIOD_START)).isEqualTo("PENDING");
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(NOW.plusMinutes(30).toInstant());
    assertThat(setting().consecutiveFailures()).isEqualTo(1);
    assertThat(lastError()).contains("저장 실패");

    assertThat(g.run(project.id(), NOW.plusMinutes(30))).isEqualTo(Outcome.GENERATED);
    assertThat(rowPageId(PERIOD_START)).isEqualTo(firstPage);
    assertThat(rowStatus(PERIOD_START)).isEqualTo("GENERATED");
    assertThat(reportPages()).isEqualTo(1);
    assertThat(lastError()).isNull();
  }

  /** 본문 쓰기가 실패하면(페이지는 있음) 실패로 기록한다 — last_error·실패 수·30분 재시도. 재시도는 같은 페이지에 본문을 쓰고 표지를 남긴다. */
  @Test
  void run_writeBodyFails_recordsFailureAndRetryReusesPage() {
    aiReturnsMessy(activity());
    WikiSystemPageWriter writerSpy = spyWriter();
    doThrow(new IllegalStateException("본문 쓰기 실패"))
        .doCallRealMethod()
        .when(writerSpy)
        .writeBody(anyLong(), anyLong(), anyInt(), any(), anyBoolean(), anyBoolean());
    ProjectReportGenerator g = generatorWith(writerSpy, reportRepository);

    assertThat(g.run(project.id(), NOW)).isEqualTo(Outcome.FAILED);
    Long page = rowPageId(PERIOD_START);
    assertThat(page).isNotNull();
    assertThat(setting().consecutiveFailures()).isEqualTo(1);
    assertThat(lastError()).contains("본문 쓰기 실패");
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(NOW.plusMinutes(30).toInstant());
    assertThat(reportPages()).isEqualTo(1);

    assertThat(g.run(project.id(), NOW.plusMinutes(30))).isEqualTo(Outcome.GENERATED);
    assertThat(rowPageId(PERIOD_START)).isEqualTo(page);
    assertThat(reportPages()).isEqualTo(1);
    WikiPageDetail p = page(page);
    assertThat(p.aiLastAction()).isEqualTo("report");
    assertThat(p.body()).contains("| 완료 | 1 | +1 |");
    assertThat(writer.childIdsOrdered(reportsPageId()).get(1)).isEqualTo(page);
  }

  /**
   * 페이지가 있는 회차가 세 번째로 실패하면 다음 예정으로 넘기되, 페이지는 남기고 회차는 FAILED 로 닫는다(행을 지우지 않는다). 리포트가 아니라서 개요 카드에는
   * 나오지 않는다(코드 리뷰 #2).
   */
  @Test
  void run_thirdFailureWithPage_closesRowKeepingPage() {
    aiReturnsMessy(activity());
    WikiSystemPageWriter writerSpy = spyWriter();
    doThrow(new IllegalStateException("본문 쓰기 실패"))
        .when(writerSpy)
        .writeBody(anyLong(), anyLong(), anyInt(), any(), anyBoolean(), anyBoolean());
    ProjectReportGenerator g = generatorWith(writerSpy, reportRepository);

    assertThat(g.run(project.id(), NOW)).isEqualTo(Outcome.FAILED);
    assertThat(g.run(project.id(), NOW.plusMinutes(30))).isEqualTo(Outcome.FAILED);
    assertThat(g.run(project.id(), NOW.plusMinutes(60))).isEqualTo(Outcome.FAILED);

    assertThat(reportPages()).isEqualTo(1);
    assertThat(rowStatus(PERIOD_START)).isEqualTo("FAILED");
    assertThat(rowPageId(PERIOD_START)).isNotNull();
    assertThat(cardService.card(owner, project.key()).latest()).isNull();
    assertThat(cardService.card(owner, project.key()).past()).isEmpty();
    // 닫힌 회차는 다시 만들지 않는다.
    dueAt(NOW.plusMinutes(90));
    assertThat(g.run(project.id(), NOW.plusMinutes(90))).isEqualTo(Outcome.DUPLICATE);
    assertThat(setting().consecutiveFailures()).isZero();
    assertThat(lastError()).contains("본문 쓰기 실패");
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(kst("2026-11-23T09:00:00").toInstant());
  }

  /**
   * 페이지를 만든 뒤 실패한 회차를 다시 시도할 때 계산값이 「변화 없음」이 됐어도(그새 이슈가 기간 밖으로 옮겨짐) 건너뛰지 않는다 — 이미 쓰던 페이지에 이어 쓴다.
   * 페이지를 버리고 SKIPPED 로 적으면 남은 페이지가 회차와 끊긴다(코드 리뷰 #1).
   */
  @Test
  void run_retryWithPage_noChange_stillGeneratesIntoExistingPage() {
    aiReturnsMessy(activity());
    WikiSystemPageWriter writerSpy = spyWriter();
    doThrow(new IllegalStateException("본문 쓰기 실패"))
        .doCallRealMethod()
        .when(writerSpy)
        .writeBody(anyLong(), anyLong(), anyInt(), any(), anyBoolean(), anyBoolean());
    ProjectReportGenerator g = generatorWith(writerSpy, reportRepository);

    assertThat(g.run(project.id(), NOW)).isEqualTo(Outcome.FAILED);
    Long page = rowPageId(PERIOD_START);
    assertThat(page).isNotNull();
    // 기간 안 활동을 기간 밖으로 — 다시 계산하면 「변화 없음」.
    OffsetDateTime old = kst("2026-10-01T10:00:00");
    dsl.update(ISSUE)
        .set(ISSUE.CREATED_AT, old)
        .set(ISSUE.CLOSED_AT, old)
        .where(ISSUE.PROJECT_ID.eq(project.id()))
        .execute();

    assertThat(g.run(project.id(), NOW.plusMinutes(30))).isEqualTo(Outcome.GENERATED);
    assertThat(rowStatus(PERIOD_START)).isEqualTo("GENERATED");
    assertThat(rowPageId(PERIOD_START)).isEqualTo(page);
    assertThat(reportPages()).isEqualTo(1);
    assertThat(page(page).aiLastAction()).isEqualTo("report");
  }

  @Autowired ProjectReportCardService cardService;

  private String lastError() {
    return dsl.select(field(name("last_error"), String.class))
        .from(table(name("project_report_setting")))
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .fetchOne(0, String.class);
  }
}

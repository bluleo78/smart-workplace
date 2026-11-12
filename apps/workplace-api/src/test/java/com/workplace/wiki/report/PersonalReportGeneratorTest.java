package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.PersonalReportAiRequest;
import com.workplace.issue.outbound.dto.PersonalReportAiResult;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.PersonalReportGenerator.Outcome;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 생성기(WP-1486) — 완료 기준과 1:1. 자동 일일의 건너뜀 조건(끝냄·새로 만듦·상태 바꿈, 「한 일이 없는 날은 건너뜀」, KST 자정 경계), 회차
 * 중복(같은 날 두 번·수동 뒤 자동·「새로 만들기」 (2)), 본인 PERSONAL 공간 › 「보고」 › 「2026년 11월」 에 본인 이름으로 「AI 작성」 표지, 템플릿
 * 복사·재복사·고친 템플릿 전달, 후처리(지시 상자·h1·표 숫자·월간 표 머리·뺀 표), 실패(30분 재시도·3회째 다음 날·비서 없음·수동 FAILED·상한)를 고정한다.
 *
 * <p>「지금」은 2026-11-12(목) 09:00 KST — 자동 일일의 대상은 11/11(수). AI 클라이언트·비서 해석은 목이다. 이슈는 담당자·이력 없이 만든 뒤
 * 상태·시각을 직접 덮어쓴다({@code PersonalReportFactsServiceTest} 와 같은 방식).
 */
@Transactional
class PersonalReportGeneratorTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-12T09:00:00+09:00");
  private static final LocalDate DAY = LocalDate.parse("2026-11-11");
  private static final PersonalReportPeriod YESTERDAY = PersonalReportPeriod.daily(DAY);
  private static final String DAILY_TITLE = "11월 11일 (수) 일일 보고";

  /** 어느 회차에도 들지 않는 생성 시각. */
  private static final OffsetDateTime OLD = OffsetDateTime.parse("2026-06-01T12:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired WikiSystemPageWriter writer;
  @Autowired PersonalReportTemplate template;
  @Autowired PersonalReportSettingRepository settings;
  @Autowired PersonalReportRepository reports;
  @Autowired PersonalReportGenerator generator;
  @Autowired AiAgentIssueClient client;
  @Autowired AssistantResolver assistantResolver;

  private long me;
  private long ai;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(me);
    ai = createAgentUser("prg-ai");
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    project =
        projectService.create(
            me, new CreateProjectRequest("PG" + suffix, "보고-" + suffix, null, "TEAM"));
    when(assistantResolver.resolveOrEmpty(me))
        .thenReturn(Optional.of(new AssistantSpec(ai, "m", "low", 4, 60_000)));
    enableDaily(LocalTime.of(9, 0), true, NOW);
    aiReturnsDaily();
  }

  // ───────────── 헬퍼 ─────────────

  private static OffsetDateTime kst(String localDateTime) {
    return OffsetDateTime.parse(localDateTime + "+09:00");
  }

  /** 자동 일일을 켜고 next_run_at 을 정한다(테스트가 「때가 됐다」를 만든다). */
  private void enableDaily(LocalTime time, boolean skipEmpty, OffsetDateTime nextRunAt) {
    settings.save(me, true, time, skipEmpty, nextRunAt);
  }

  private void dueAt(OffsetDateTime at) {
    dsl.update(table(name("personal_report_setting")))
        .set(field(name("next_run_at"), OffsetDateTime.class), at)
        .where(field(name("user_id"), Long.class).eq(me))
        .execute();
  }

  /** 내 프로젝트에 내가 만든 담당자·이력 없는 이슈 — 범주·생성 시각·닫힌 시각을 덮어쓴다. */
  private long issue(String status, OffsetDateTime createdAt, OffsetDateTime closedAt) {
    var created =
        issueService.create(
            me,
            project.key(),
            new CreateIssueRequest("보고 이슈", null, null, null, null, null, null, null));
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(created.id())).execute();
    dsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.eq(created.id())).execute();
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, status))
        .set(ISSUE.CREATED_AT, createdAt)
        .set(ISSUE.UPDATED_AT, createdAt)
        .set(ISSUE.CLOSED_AT, closedAt)
        .where(ISSUE.ID.eq(created.id()))
        .execute();
    return created.id();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, userId)
        .execute();
  }

  /** 내가 담당한 채 11/11 에 닫힌 오래된 이슈 — 끝냄 1(status 가 CANCELED 면 끝냄 아님). */
  private long closedYesterday(String status) {
    long id = issue(status, OLD, kst("2026-11-11T10:00:00"));
    assign(id, me);
    return id;
  }

  /** actor 가 11/11 에 상태를 바꾼 이력 한 줄. */
  private void statusChangedYesterday(long issueId, long actor) {
    dsl.insertInto(ISSUE_HISTORY)
        .set(ISSUE_HISTORY.ISSUE_ID, issueId)
        .set(ISSUE_HISTORY.ACTOR_ID, actor)
        .set(ISSUE_HISTORY.EVENT_TYPE, "STATUS_CHANGED")
        .set(ISSUE_HISTORY.FROM_VALUE, "TODO")
        .set(ISSUE_HISTORY.TO_VALUE, "IN_PROGRESS")
        .set(ISSUE_HISTORY.CREATED_AT, kst("2026-11-11T10:00:00"))
        .execute();
  }

  /** AI 목 — 템플릿을 흉내 내되 맨 앞 h1·지시 상자·틀린 숫자 줄을 담은 일일 마크다운. */
  private void aiReturnsDaily() {
    aiReturns(
        """
        # 엉뚱한 제목

        <div class="wp-ai-instruction">

        지시 상자가 새어 나옴

        </div>

        ## 한 줄

        어제는 로그인 오류를 고쳤습니다.

        ## 어제 숫자

        | 끝냄 | 새로 만듦 | 상태 바꿈 | 기한 지남 |
        |---|---|---|---|
        | 9 | 9 | 9 | 9 |

        ## 어제 한 일

        - 로그인 오류 — 완료

        ## 막힌 것

        없음
        """);
  }

  /** AI 목 — 주간 템플릿 모양(「지난주 대비」 표, 틀린 숫자)을 그대로 쓴 글. 월간에도 이 글을 돌려준다. */
  private void aiReturnsPeriod() {
    aiReturns(
        """
        ## 한 줄

        이번 기간은 로그인 오류를 끝냈습니다.

        ## 지난주 대비

        | 지난주 대비 | 이번 주 | 변화 |
        |---|---|---|
        | 끝냄 | 99 | +99 |

        ## 한 일

        - 로그인 오류 — 완료
        """);
  }

  private void aiReturns(String markdown) {
    doReturn(new PersonalReportAiResult(markdown)).when(client).writePersonalReport(any());
  }

  private SettingRow setting() {
    return settings.find(me).orElseThrow();
  }

  private int reportRows() {
    return dsl.fetchCount(
        table(name("personal_report")), field(name("user_id"), Long.class).eq(me));
  }

  private String rowStatus(LocalDate start) {
    return dsl.select(field(name("status"), String.class))
        .from(table(name("personal_report")))
        .where(field(name("user_id"), Long.class).eq(me))
        .and(field(name("period_start"), LocalDate.class).eq(start))
        .fetchOne(0, String.class);
  }

  private Long rowPageId(LocalDate start) {
    return dsl.select(field(name("page_id"), Long.class))
        .from(table(name("personal_report")))
        .where(field(name("user_id"), Long.class).eq(me))
        .and(field(name("period_start"), LocalDate.class).eq(start))
        .fetchOne(0, Long.class);
  }

  private WikiPageDetail page(long id) {
    return writer.findPage(id).orElseThrow();
  }

  private WikiPageDetail yesterdayPage() {
    return page(rowPageId(DAY));
  }

  /** 수동 회차를 예약한다(Task 6 서비스가 할 일 — 여기서는 저장소로 바로). */
  private long reserveManual(PersonalReportPeriod p) {
    var r = reports.reserve(me, p, "MANUAL", NOW);
    assertThat(r.status()).isEqualTo(PersonalReportRepository.ReserveStatus.RESERVED);
    return r.id();
  }

  private void failAi() {
    when(client.writePersonalReport(any()))
        .thenThrow(new IssueAiException("AI 보고 작성 요청에 실패했어요.", null));
  }

  // ───────────── 일일 자동 건너뜀 조건 ─────────────

  /** 어제 끝냄·새로 만듦·상태 바꿈이 모두 0 이면 SKIPPED 행만 — 페이지·AI 호출 없음, 다음은 내일 09:00. */
  @Test
  void daily_noActivity_skipsWithoutPageOrAiCall() {
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.SKIPPED_EMPTY);

    assertThat(rowStatus(DAY)).isEqualTo("SKIPPED");
    assertThat(rowPageId(DAY)).isNull();
    verify(client, never()).writePersonalReport(any());
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(kst("2026-11-13T09:00:00").toInstant());
  }

  @Test
  void daily_onlyCompleted_generates() {
    closedYesterday("DONE");
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);
    assertThat(rowStatus(DAY)).isEqualTo("GENERATED");
  }

  @Test
  void daily_onlyCreated_generates() {
    issue("TODO", kst("2026-11-11T11:00:00"), null);
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);
  }

  @Test
  void daily_onlyStatusChanged_generates() {
    long id = issue("TODO", OLD, null);
    statusChangedYesterday(id, me);
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);
  }

  @Test
  void daily_skipEmptyOff_generatesEvenWhenEmpty() {
    enableDaily(LocalTime.of(9, 0), false, NOW);
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);
    verify(client, times(1)).writePersonalReport(any());
  }

  /** AI 가 내 담당 이슈의 상태를 바꾼 날도 「한 일 있는 날」. */
  @Test
  void daily_statusChangeByAiOnMyIssue_generates() {
    long id = issue("TODO", OLD, null);
    assign(id, me);
    statusChangedYesterday(id, ai);
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);
  }

  /** 내 담당이 아닌 이슈를 남이 바꾼 것은 내 활동이 아니다. */
  @Test
  void daily_statusChangeByOtherOnNotMine_skips() {
    long id = issue("TODO", OLD, null);
    statusChangedYesterday(id, ai);
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.SKIPPED_EMPTY);
  }

  /** 취소(CANCELED)로 닫힌 것은 끝냄이 아니다. */
  @Test
  void daily_canceledOnly_skips() {
    closedYesterday("CANCELED");
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.SKIPPED_EMPTY);
  }

  /** 시각 00:00 이면 00:30 KST(= 전날 15:30 UTC) 실행은 방금 끝난 어제(11/11)를 만든다. */
  @Test
  void daily_kstMidnight_0030RunTargetsPreviousDay() {
    OffsetDateTime at = OffsetDateTime.parse("2026-11-11T15:30:00Z");
    enableDaily(LocalTime.MIDNIGHT, false, at);

    assertThat(generator.runDaily(me, at)).isEqualTo(Outcome.GENERATED);

    assertThat(yesterdayPage().title()).isEqualTo(DAILY_TITLE);
    assertThat(setting().nextRunAt().toInstant()).isEqualTo(kst("2026-11-13T00:00:00").toInstant());
  }

  // ───────────── 회차 중복 ─────────────

  /** 같은 날 두 번 — 두 번째는 점유 실패(NOT_DUE), 점유를 되돌려도 DUPLICATE. 페이지는 하나. */
  @Test
  void daily_runTwiceSameDay_onePage() {
    closedYesterday("DONE");
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);
    assertThat(generator.runDaily(me, NOW.plusHours(1))).isEqualTo(Outcome.NOT_DUE);
    dueAt(NOW);
    assertThat(generator.runDaily(me, NOW.plusHours(1))).isEqualTo(Outcome.DUPLICATE);

    assertThat(reportRows()).isEqualTo(1);
    long folder = yesterdayPage().parentId();
    assertThat(writer.childIdsOrdered(folder)).hasSize(1);
    verify(client, times(1)).writePersonalReport(any());
  }

  /** 그날이 끝난 뒤(여기서는 실제 시각) 그날 일일을 수동으로 이미 만들었으면 자동은 DUPLICATE. */
  @Test
  void daily_afterManualGenerated_duplicate() {
    assertThat(generator.runManual(reserveManual(YESTERDAY), NOW)).isEqualTo(Outcome.GENERATED);

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.DUPLICATE);
    assertThat(reportRows()).isEqualTo(1);
  }

  /** 같은 회차 GENERATED 뒤 「새로 만들기」 — 제목 끝 「(2)」, 같은 월 폴더 맨 위. 앞 보고는 그대로. */
  @Test
  void manual_forceSecond_titleSuffix2() {
    closedYesterday("DONE");
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);
    long first = rowPageId(DAY);

    long second = reserveManual(YESTERDAY);
    assertThat(generator.runManual(second, NOW)).isEqualTo(Outcome.GENERATED);

    long secondPage = reports.findById(second).orElseThrow().pageId();
    assertThat(page(secondPage).title()).isEqualTo(DAILY_TITLE + " (2)");
    assertThat(page(first).title()).isEqualTo(DAILY_TITLE);
    long folder = page(first).parentId();
    assertThat(page(secondPage).parentId()).isEqualTo(folder);
    assertThat(writer.childIdsOrdered(folder)).containsExactly(secondPage, first);
  }

  // ───────────── 월 폴더 순서(최신 달이 위) ─────────────

  /** 11월 → 9월 → 10월 순으로 만들어도 「보고」 아래는 템플릿 다음 11월·10월·9월(최신 달이 위). */
  @Test
  void monthFolders_novemberThenOlder_latestMonthFirst() {
    template.ensureBoth(me);
    closedYesterday("DONE");
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);
    aiReturnsPeriod();
    PersonalReportPeriod sep = PersonalReportPeriod.monthly(YearMonth.of(2026, 9));
    assertThat(generator.runManual(reserveManual(sep), NOW)).isEqualTo(Outcome.GENERATED);
    PersonalReportPeriod oct = PersonalReportPeriod.monthly(YearMonth.of(2026, 10));
    assertThat(generator.runManual(reserveManual(oct), NOW)).isEqualTo(Outcome.GENERATED);

    assertReportsChildren("2026년 11월", "2026년 10월", "2026년 9월");
  }

  /** 10월(월간 수동) 뒤 11월(자동 일일) — 새로 만든 11월이 10월 위에 온다. */
  @Test
  void monthFolders_octoberThenNovember_latestMonthFirst() {
    template.ensureBoth(me);
    aiReturnsPeriod();
    PersonalReportPeriod oct = PersonalReportPeriod.monthly(YearMonth.of(2026, 10));
    assertThat(generator.runManual(reserveManual(oct), NOW)).isEqualTo(Outcome.GENERATED);
    aiReturnsDaily();
    closedYesterday("DONE");
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);

    assertReportsChildren("2026년 11월", "2026년 10월");
  }

  /** 「보고」 자식이 템플릿 둘 다음 주어진 월 폴더 순서인지. */
  private void assertReportsChildren(String... monthFolders) {
    long reportsPage = writer.findPersonalReportsHome(me).orElseThrow().reportsPageId();
    List<Long> children = writer.childIdsOrdered(reportsPage);
    assertThat(children.subList(0, 2))
        .containsExactlyInAnyOrder(
            setting().dailyTemplatePageId(), setting().weeklyTemplatePageId());
    assertThat(children.subList(2, children.size()).stream().map(id -> page(id).title()))
        .containsExactly(monthFolders);
  }

  /** 자리 계산 — 오래된 첫 월 폴더 앞, 없으면 마지막 최신 월 폴더 뒤, 월 폴더가 없으면 템플릿 다음. 다른 페이지는 월로 보지 않는다. */
  @Test
  void monthFolderPosition_ordersByMonthDescending() {
    List<String> siblings = List.of("일일 템플릿", "주간 템플릿", "2026년 12월", "메모", "2026년 9월");
    assertThat(PersonalReportGenerator.monthFolderPosition(siblings, "2026년 11월", 2)).isEqualTo(4);
    assertThat(PersonalReportGenerator.monthFolderPosition(siblings, "2027년 1월", 2)).isEqualTo(2);
    assertThat(PersonalReportGenerator.monthFolderPosition(siblings, "2026년 8월", 2)).isEqualTo(5);
    assertThat(PersonalReportGenerator.monthFolderPosition(List.of("일일 템플릿"), "2026년 8월", 1))
        .isEqualTo(1);
    assertThat(PersonalReportGenerator.parseMonthFolder("2026년 13월")).isEmpty();
    assertThat(PersonalReportGenerator.parseMonthFolder("2026년 1월"))
        .hasValue(YearMonth.of(2026, 1));
  }

  // ───────────── 본인 공간에만 저장 ─────────────

  /** 내 PERSONAL 공간 › 「보고」 › 「2026년 11월」 아래, 작성자 본인, 「AI 작성」 표지. */
  @Test
  void generated_pageInOwnPersonalSpace_authorSelf_markedReport() {
    closedYesterday("DONE");
    generator.runDaily(me, NOW);

    WikiPageDetail p = yesterdayPage();
    var space =
        dsl.select(WIKI_SPACE.TYPE, WIKI_SPACE.OWNER_ID)
            .from(WIKI_SPACE)
            .where(WIKI_SPACE.ID.eq(p.spaceId()))
            .fetchOne();
    assertThat(space.value1()).isEqualTo("PERSONAL");
    assertThat(space.value2()).isEqualTo(me);
    WikiPageDetail folder = page(p.parentId());
    assertThat(folder.title()).isEqualTo("2026년 11월");
    WikiPageDetail reportsPage = page(folder.parentId());
    assertThat(reportsPage.title()).isEqualTo("보고");
    assertThat(reportsPage.parentId()).isNull();
    assertThat(p.updatedBy()).isEqualTo(me);
    assertThat(p.aiLastAction()).isEqualTo("report");
    assertThat(p.aiLastUsedAt()).isAfterOrEqualTo(p.updatedAt());
  }

  /** 팀 노트 공간(프로젝트 「리포트」)의 OWNER 여도 개인 보고는 내 노트에 생긴다. */
  @Test
  void generated_teamSpaceOwner_stillPersonal() {
    long teamSpace = writer.ensureReportsHome(project.id(), me).orElseThrow().spaceId();
    closedYesterday("DONE");

    generator.runDaily(me, NOW);

    WikiPageDetail p = yesterdayPage();
    assertThat(p.spaceId()).isNotEqualTo(teamSpace);
    assertThat(
            dsl.select(WIKI_SPACE.TYPE)
                .from(WIKI_SPACE)
                .where(WIKI_SPACE.ID.eq(p.spaceId()))
                .fetchOne(WIKI_SPACE.TYPE))
        .isEqualTo("PERSONAL");
  }

  // ───────────── 템플릿 복사 ─────────────

  /** 템플릿이 없으면 생성 때 「보고」 맨 위에 복사하고, 월 폴더는 그 다음 자리. */
  @Test
  void generate_copiesTemplatesWhenMissing() {
    assertThat(writer.findPersonalReportsHome(me)).isEmpty();
    closedYesterday("DONE");

    generator.runDaily(me, NOW);

    PersonalReportsHome home = writer.findPersonalReportsHome(me).orElseThrow();
    Long daily = setting().dailyTemplatePageId();
    assertThat(daily).isNotNull();
    assertThat(page(daily).title()).isEqualTo(PersonalReportTemplate.DAILY_TITLE);
    long folder = yesterdayPage().parentId();
    assertThat(writer.childIdsOrdered(home.reportsPageId())).containsExactly(daily, folder);
  }

  /** 사람이 지운 템플릿은 다음 생성 때 다시 복사하고, 월 폴더는 템플릿 두 개 다음. */
  @Test
  void generate_recopiesDeletedTemplate() {
    template.ensureBoth(me);
    long old = setting().dailyTemplatePageId();
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(old)).execute();
    closedYesterday("DONE");

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);

    PersonalReportsHome home = writer.findPersonalReportsHome(me).orElseThrow();
    long again = setting().dailyTemplatePageId();
    assertThat(again).isNotEqualTo(old);
    assertThat(writer.existsUnder(again, home.reportsPageId())).isTrue();
    List<Long> children = writer.childIdsOrdered(home.reportsPageId());
    assertThat(children).hasSize(3);
    assertThat(children.get(2)).isEqualTo(yesterdayPage().parentId());
  }

  /** 사람이 고친 템플릿 본문이 AI 요청에 그대로 실린다. 요청 모양(이름·종류·숫자 줄)도 함께 본다. */
  @Test
  void generate_sendsEditedTemplateToAi() {
    template.ensureBoth(me);
    long daily = setting().dailyTemplatePageId();
    writer.writeBody(me, daily, page(daily).version(), "## 한 줄\n\n내가 고친 템플릿 글입니다.\n", false, false);
    closedYesterday("DONE");

    generator.runDaily(me, NOW);

    ArgumentCaptor<PersonalReportAiRequest> captor =
        ArgumentCaptor.forClass(PersonalReportAiRequest.class);
    verify(client).writePersonalReport(captor.capture());
    PersonalReportAiRequest req = captor.getValue();
    assertThat(req.templateMarkdown()).contains("내가 고친 템플릿 글입니다.");
    assertThat(req.kind()).isEqualTo("DAILY");
    assertThat(req.kindLabel()).isEqualTo("일일");
    assertThat(req.title()).isEqualTo(DAILY_TITLE);
    assertThat(req.userName())
        .isEqualTo(
            dsl.select(field(name("name"), String.class))
                .from(table(name("user")))
                .where(field(name("id"), Long.class).eq(me))
                .fetchOne(0, String.class));
    assertThat(req.numbersLine()).isEqualTo("끝냄 1 | 새로 만듦 0 | 상태 바꿈 0 | 기한 지남 0");
    assertThat(req.tableRows()).isEmpty();
    assertThat(req.issues()).extracting("reason").containsExactly("DONE");
    assertThat(req.assistantAgentId()).isEqualTo(ai);
  }

  // ───────────── 후처리 ─────────────

  @Test
  void generated_noInstructionBoxNoH1() {
    closedYesterday("DONE");
    generator.runDaily(me, NOW);
    String body = yesterdayPage().body();
    assertThat(body).doesNotContain("wp-ai-instruction").doesNotContain("지시 상자가 새어 나옴");
    assertThat(body).doesNotContain("# 엉뚱한 제목");
    assertThat(body).contains("어제는 로그인 오류를 고쳤습니다.");
  }

  /** AI 가 쓴 「어제 숫자」 줄(9·9·9·9)을 시스템 값으로 바꾼다. */
  @Test
  void generated_dailyNumbersFixedToSystemValues() {
    closedYesterday("DONE");
    generator.runDaily(me, NOW);
    String body = yesterdayPage().body();
    assertThat(body).doesNotContain("| 9 | 9 | 9 | 9 |");
    assertThat(body).contains("| 1 | 0 | 0 | 0 |");
  }

  /** 주간은 「지난주 대비」 표 몸통을 계산값으로, 월간은 같은 템플릿에서 머리를 「지난달 대비 · 이번 달」로 바로잡는다. */
  @Test
  void generated_weeklyTableFixed_monthlyHeadWords() {
    aiReturnsPeriod();
    PersonalReportPeriod week = PersonalReportPeriod.weekly(LocalDate.parse("2026-11-02"));
    assertThat(generator.runManual(reserveManual(week), NOW)).isEqualTo(Outcome.GENERATED);
    String weekly = page(reports.findById(lastId()).orElseThrow().pageId()).body();
    assertThat(weekly).doesNotContain("99").contains("| 지난주 대비 | 이번 주 | 변화 |");
    assertThat(weekly).contains("| 기한 지남(지금) | 0 | — |");

    PersonalReportPeriod month = PersonalReportPeriod.monthly(YearMonth.of(2026, 10));
    long monthId = reserveManual(month);
    assertThat(generator.runManual(monthId, NOW)).isEqualTo(Outcome.GENERATED);
    WikiPageDetail monthly = page(reports.findById(monthId).orElseThrow().pageId());
    assertThat(monthly.title()).isEqualTo("10월 월간 보고");
    assertThat(page(monthly.parentId()).title()).isEqualTo("2026년 10월");
    assertThat(monthly.body())
        .doesNotContain("99")
        .contains("| 지난달 대비 | 이번 달 | 변화 |")
        .doesNotContain("지난주 대비 |");
  }

  /** 사람이 템플릿에서 「어제 숫자」 표를 뺐으면, AI 결과에 표가 없을 때 넣지 않는다. */
  @Test
  void generated_templateWithoutTable_notInserted() {
    template.ensureBoth(me);
    long daily = setting().dailyTemplatePageId();
    writer.writeBody(me, daily, page(daily).version(), "## 한 줄\n\n표 없는 템플릿.\n", false, false);
    aiReturns("## 한 줄\n\n어제는 로그인 오류를 고쳤습니다.\n");
    closedYesterday("DONE");

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.GENERATED);

    assertThat(yesterdayPage().body()).doesNotContain("| 끝냄").doesNotContain("어제 숫자");
  }

  // ───────────── 실패 ─────────────

  /** AI 오류 — 예약을 지우고 30분 뒤 다시, 실패 수 1. */
  @Test
  void daily_aiFailure_retryIn30Minutes() {
    closedYesterday("DONE");
    failAi();

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.FAILED);

    assertThat(reportRows()).isZero();
    SettingRow s = setting();
    assertThat(s.nextRunAt().toInstant()).isEqualTo(NOW.plusMinutes(30).toInstant());
    assertThat(s.consecutiveFailures()).isEqualTo(1);
    assertThat(s.lastError()).contains("AI 보고 작성 요청에 실패했어요.");
  }

  /**
   * 연속 세 번째 실패 — 실패 수 0, 다음은 내일 09:00, 그날은 FAILED 행으로 닫힌다. 다시 돌려도 점유 실패(NOT_DUE), 때를 되돌려도 그날은
   * DUPLICATE(uq_personal_report_auto 로 닫힘).
   */
  @Test
  void daily_thirdFailure_skipsToNextDay() {
    closedYesterday("DONE");
    failAi();

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.FAILED);
    assertThat(generator.runDaily(me, NOW.plusMinutes(30))).isEqualTo(Outcome.FAILED);
    assertThat(generator.runDaily(me, NOW.plusMinutes(60))).isEqualTo(Outcome.FAILED);

    SettingRow s = setting();
    assertThat(s.consecutiveFailures()).isZero();
    assertThat(s.nextRunAt().toInstant()).isEqualTo(kst("2026-11-13T09:00:00").toInstant());
    assertThat(rowStatus(DAY)).isEqualTo("FAILED");

    OffsetDateTime later = NOW.plusMinutes(90);
    assertThat(generator.runDaily(me, later)).isEqualTo(Outcome.NOT_DUE);
    dueAt(later);
    assertThat(generator.runDaily(me, later)).isEqualTo(Outcome.DUPLICATE);
    verify(client, times(3)).writePersonalReport(any());
  }

  /** 비서 확인이 예외를 던져도 그날을 잃지 않는다 — 생성 실패와 같이 예약을 풀고 30분 뒤 다시, 실패 수 1, PENDING 행 없음. */
  @Test
  void daily_assistantResolverThrows_retryIn30Minutes() {
    when(assistantResolver.resolveOrEmpty(me)).thenThrow(new IllegalStateException("비서 조회 실패"));
    closedYesterday("DONE");

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.FAILED);

    assertThat(reportRows()).isZero();
    SettingRow s = setting();
    assertThat(s.nextRunAt().toInstant()).isEqualTo(NOW.plusMinutes(30).toInstant());
    assertThat(s.consecutiveFailures()).isEqualTo(1);
    assertThat(s.lastError()).contains("비서 조회 실패");
    verify(client, never()).writePersonalReport(any());
  }

  /** 수동 성공은 자동 일일의 실패 수·마지막 오류를 지우지 않는다(자동 경로만 지움). */
  @Test
  void manual_success_keepsAutoFailureRecord() {
    closedYesterday("DONE");
    failAi();
    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.FAILED);

    aiReturnsDaily();
    assertThat(generator.runManual(reserveManual(YESTERDAY), NOW)).isEqualTo(Outcome.GENERATED);

    SettingRow s = setting();
    assertThat(s.consecutiveFailures()).isEqualTo(1);
    assertThat(s.lastError()).contains("AI 보고 작성 요청에 실패했어요.");
  }

  /** 비서가 없으면 예약을 풀고 SKIPPED_NO_ASSISTANT — 행 없음, 실패로 세지 않음. */
  @Test
  void daily_noAssistant_skippedNoAssistant() {
    when(assistantResolver.resolveOrEmpty(me)).thenReturn(Optional.empty());
    closedYesterday("DONE");

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.SKIPPED_NO_ASSISTANT);

    assertThat(reportRows()).isZero();
    assertThat(setting().consecutiveFailures()).isZero();
    verify(client, never()).writePersonalReport(any());
  }

  /** 수동인데 비서가 없으면 회차를 FAILED + 안내 문구로 닫는다. */
  @Test
  void manual_noAssistant_rowFailed() {
    when(assistantResolver.resolveOrEmpty(me)).thenReturn(Optional.empty());
    long id = reserveManual(YESTERDAY);

    assertThat(generator.runManual(id, NOW)).isEqualTo(Outcome.SKIPPED_NO_ASSISTANT);

    var row = reports.findById(id).orElseThrow();
    assertThat(row.status()).isEqualTo("FAILED");
    assertThat(row.error()).isEqualTo("AI 비서가 없어 보고를 만들 수 없어요");
  }

  /** 수동인데 비서 확인이 예외를 던져도(생성 전) 회차를 PENDING 으로 두지 않고 FAILED + 오류로 닫는다. */
  @Test
  void manual_assistantResolverThrows_rowFailedWithError() {
    when(assistantResolver.resolveOrEmpty(me)).thenThrow(new IllegalStateException("비서 조회 실패"));
    long id = reserveManual(YESTERDAY);

    assertThat(generator.runManual(id, NOW)).isEqualTo(Outcome.FAILED);

    var row = reports.findById(id).orElseThrow();
    assertThat(row.status()).isEqualTo("FAILED");
    assertThat(row.error()).isEqualTo("비서 조회 실패");
    verify(client, never()).writePersonalReport(any());
  }

  /** 수동 AI 오류 — 회차 FAILED + 오류 문구. 자동 실패 수는 건드리지 않는다. */
  @Test
  void manual_aiFailure_rowFailedWithError() {
    failAi();
    long id = reserveManual(YESTERDAY);

    assertThat(generator.runManual(id, NOW)).isEqualTo(Outcome.FAILED);

    var row = reports.findById(id).orElseThrow();
    assertThat(row.status()).isEqualTo("FAILED");
    assertThat(row.error()).contains("AI 보고 작성 요청에 실패했어요.");
    assertThat(row.pageId()).isNull();
    assertThat(setting().consecutiveFailures()).isZero();
  }

  /** 템플릿이 20,000자를 넘으면 AI 를 부르지 않고 실패. */
  @Test
  void daily_templateTooLong_fails() {
    template.ensureBoth(me);
    long daily = setting().dailyTemplatePageId();
    writer.writeBody(me, daily, page(daily).version(), "가".repeat(20_001), false, false);
    closedYesterday("DONE");

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.FAILED);

    verify(client, never()).writePersonalReport(any());
    assertThat(setting().lastError()).contains("20000자");
  }

  /** AI 출력이 20,000자를 넘으면 잘린 글로 보고 실패 — 페이지 없음. */
  @Test
  void daily_outputTooLong_fails() {
    aiReturns("## 한 줄\n\n" + "가".repeat(20_001));
    closedYesterday("DONE");

    assertThat(generator.runDaily(me, NOW)).isEqualTo(Outcome.FAILED);

    assertThat(reportRows()).isZero();
    assertThat(setting().lastError()).contains("20000자");
  }

  /** 이 사용자의 가장 최근 회차 행 id. */
  private long lastId() {
    return dsl.select(field(name("id"), Long.class))
        .from(table(name("personal_report")))
        .where(field(name("user_id"), Long.class).eq(me))
        .orderBy(field(name("id")).desc())
        .limit(1)
        .fetchOne(0, Long.class);
  }
}

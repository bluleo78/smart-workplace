package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.ProjectReportAiResult;
import com.workplace.issue.report.ReportCadence;
import com.workplace.issue.report.ReportPeriod;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.ProjectReportGenerator.Outcome;
import com.workplace.wiki.report.dto.ProjectReportGenerateResponse;
import com.workplace.wiki.report.dto.UpdateProjectReportSettingsRequest;
import com.workplace.wiki.service.WikiRevisionService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 리포트 「지금 생성」(WP-1630) — 직전에 끝난 회차 하나를 정기 실행과 같은 생성기로 바로 만든다. 같은 회차 리포트가 있으면 같은 페이지에 새 판을
 * 쓰고(직전 판은 수정 기록), 정기 실행이 그 회차를 만드는 중이면 409, 실패하면 이유와 함께 거절하고 원래 리포트를 그대로 둔다. 정기 일정(다음 실행·실패 수)은
 * 건드리지 않는다. 권한은 설정 저장과 같다(OWNER·ADMIN).
 *
 * <p>「지금」은 2026-11-16(월) 09:00 KST — 회차는 11/9~15(11월 3주차). AI 클라이언트·비서 해석은 목이다.
 */
@Transactional
class ProjectReportGenerateNowTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");
  private static final LocalDate PERIOD_START = LocalDate.parse("2026-11-09");
  private static final String TITLE = "11월 3주차 주간 리포트";

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired WikiSystemPageWriter writer;
  @Autowired WikiRevisionService revisions;
  @Autowired ProjectReportSettingsService settingsService;
  @Autowired ProjectReportSettingRepository settings;
  @Autowired ProjectReportGenerator generator;
  @Autowired AiAgentIssueClient client;
  @Autowired AssistantResolver assistantResolver;
  @Autowired AiAgentProperties aiAgentProperties;

  private long owner;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = human();
    String key =
        "RN" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    project =
        projectService.create(owner, new CreateProjectRequest(key, "리포트-" + key, null, "TEAM"));
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(owner, "m", "low", 4)));
  }

  // ───────────── 헬퍼 ─────────────

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }

  private void aiReturns(String text) {
    doReturn(new ProjectReportAiResult("## 상태와 한 줄\n\n" + text))
        .when(client)
        .writeProjectReport(any());
  }

  private void enableWeekly() {
    settingsService.update(
        owner,
        project.key(),
        new UpdateProjectReportSettingsRequest(true, "WEEKLY", "MONDAY", "09:00"));
  }

  private String rowStatus() {
    return dsl.select(field(name("status"), String.class))
        .from(table(name("project_report")))
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .and(field(name("period_start"), LocalDate.class).eq(PERIOD_START))
        .fetchOne(0, String.class);
  }

  private Long rowPageId() {
    return dsl.select(field(name("page_id"), Long.class))
        .from(table(name("project_report")))
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .and(field(name("period_start"), LocalDate.class).eq(PERIOD_START))
        .fetchOne(0, Long.class);
  }

  /** 그 회차를 정기 실행이 지금 만드는 중인 것처럼 — 방금 예약한 PENDING 행. */
  private void reservedByScheduler() {
    dsl.insertInto(table(name("project_report")))
        .set(field(name("project_id"), Long.class), project.id())
        .set(field(name("period_start"), LocalDate.class), PERIOD_START)
        .set(field(name("period_end"), LocalDate.class), LocalDate.parse("2026-11-15"))
        .set(field(name("status"), String.class), "PENDING")
        .set(field(name("reserved_at"), OffsetDateTime.class), NOW.minusMinutes(1))
        .set(field(name("created_at"), OffsetDateTime.class), NOW.minusMinutes(1))
        .execute();
  }

  private WikiPageDetail page(long id) {
    return writer.findPage(id).orElseThrow();
  }

  // ───────────── 테스트 ─────────────

  /**
   * 꺼져 있어도 「리포트」 아래 직전 회차 리포트를 만들고(변화가 없어도 — 사람이 눌렀으니), 정기 일정(켬·다음 실행)은 그대로다. 같은 회차를 정기 실행이 다시 만들지
   * 않는다.
   */
  @Test
  void generateNow_createsLastPeriodReport_evenWhenOffAndNoChange() {
    aiReturns("지금 만든 리포트");

    ProjectReportGenerateResponse res = settingsService.generateNow(owner, project.key(), NOW);

    assertThat(res.title()).isEqualTo(TITLE);
    assertThat(res.replaced()).isFalse();
    assertThat(rowPageId()).isEqualTo(res.pageId());
    assertThat(rowStatus()).isEqualTo("GENERATED");
    WikiPageDetail p = page(res.pageId());
    assertThat(p.title()).isEqualTo(TITLE);
    assertThat(page(p.parentId()).title()).isEqualTo("리포트");
    assertThat(p.body()).contains("지금 만든 리포트");
    assertThat(settings.find(project.id()).map(s -> s.enabled()).orElse(false)).isFalse();
  }

  /** 켜 둔 일정의 다음 실행·실패 수는 건드리지 않고, 그 뒤 정기 실행은 같은 회차를 다시 만들지 않는다. */
  @Test
  void generateNow_keepsSchedule_andScheduledRunSkipsSamePeriod() {
    enableWeekly();
    OffsetDateTime next = settings.find(project.id()).orElseThrow().nextRunAt();
    aiReturns("지금 만든 리포트");

    long pageId = settingsService.generateNow(owner, project.key(), NOW).pageId();

    assertThat(settings.find(project.id()).orElseThrow().nextRunAt()).isEqualTo(next);
    // 정기 실행이 같은 회차에 이르면 — 이미 만든 회차라 새 페이지를 만들지 않는다.
    dsl.update(table(name("project_report_setting")))
        .set(field(name("next_run_at"), OffsetDateTime.class), NOW)
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .execute();
    assertThat(generator.run(project.id(), NOW)).isEqualTo(Outcome.DUPLICATE);
    assertThat(rowPageId()).isEqualTo(pageId);
  }

  /** 같은 회차 리포트가 있으면 같은 페이지에 새 판을 쓰고, 직전 본문은 수정 기록에 남는다. */
  @Test
  void generateNow_samePeriod_overwritesSamePage_keepsPreviousRevision() {
    aiReturns("첫 번째 리포트");
    long first = settingsService.generateNow(owner, project.key(), NOW).pageId();

    aiReturns("두 번째 리포트");
    ProjectReportGenerateResponse again =
        settingsService.generateNow(owner, project.key(), NOW.plusHours(1));

    assertThat(again.pageId()).isEqualTo(first);
    assertThat(again.replaced()).isTrue();
    assertThat(rowStatus()).isEqualTo("GENERATED");
    assertThat(page(first).body()).contains("두 번째 리포트").doesNotContain("첫 번째 리포트");
    var items = revisions.list(owner, first).items();
    assertThat(items).isNotEmpty();
    assertThat(revisions.get(owner, first, items.get(0).version()).body()).contains("첫 번째 리포트");
    // 「리포트」 아래 페이지는 하나뿐이다(새로 만들지 않았다).
    long reports = page(first).parentId();
    assertThat(
            writer.childIdsOrdered(reports).stream()
                .filter(id -> TITLE.equals(page(id).title()))
                .count())
        .isEqualTo(1);
  }

  /** 저장 위치를 바꾼 뒤 같은 회차를 다시 만들면 옛 위치의 페이지를 옮기지 않고 그 자리에서 새 판을 쓴다 — 이미 만든 리포트는 그대로(WP-1654). */
  @Test
  void generateNow_samePeriod_afterLocationChange_keepsExistingPageInPlace() {
    aiReturns("첫 번째 리포트");
    long first = settingsService.generateNow(owner, project.key(), NOW).pageId();
    long reports = page(first).parentId();
    long minutes = writer.createPage(owner, page(first).spaceId(), null, "회의록").id();
    settingsService.updateLocation(owner, project.key(), minutes);

    aiReturns("두 번째 리포트");
    ProjectReportGenerateResponse again =
        settingsService.generateNow(owner, project.key(), NOW.plusHours(1));

    assertThat(again.pageId()).isEqualTo(first);
    assertThat(again.replaced()).isTrue();
    assertThat(page(first).parentId()).isEqualTo(reports);
    assertThat(page(first).body()).contains("두 번째 리포트");
    assertThat(writer.childIdsOrdered(minutes)).isEmpty();
  }

  /** 정기 실행이 같은 회차를 만드는 중이면 409 — AI 를 부르지 않고 예약 행도 건드리지 않는다. */
  @Test
  void generateNow_whileRunning_conflict() {
    reservedByScheduler();

    assertThatThrownBy(() -> settingsService.generateNow(owner, project.key(), NOW))
        .isInstanceOfSatisfying(
            ProjectReportGenerateException.class,
            e -> {
              assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(e.getMessage()).isEqualTo("이미 리포트를 만드는 중이에요");
            });
    verify(client, never()).writeProjectReport(any());
    assertThat(rowStatus()).isEqualTo("PENDING");
  }

  /** 30분 넘게 묵은 예약(죽은 실행)은 이어받아 만든다 — 정기 실행의 이어받기와 같은 규칙. */
  @Test
  void generateNow_stalePending_takesOver() {
    reservedByScheduler();
    dsl.update(table(name("project_report")))
        .set(field(name("reserved_at"), OffsetDateTime.class), NOW.minusMinutes(31))
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .execute();
    aiReturns("이어받은 리포트");

    ProjectReportGenerateResponse res = settingsService.generateNow(owner, project.key(), NOW);

    assertThat(rowStatus()).isEqualTo("GENERATED");
    assertThat(page(res.pageId()).body()).contains("이어받은 리포트");
  }

  /** 실패하면 이유와 함께 502 로 거절하고, 있던 리포트(행·본문)는 그대로 둔다 — 다시 누르면 다시 시도된다. */
  @Test
  void generateNow_aiFails_keepsExistingReport_andRetryWorks() {
    aiReturns("첫 번째 리포트");
    long first = settingsService.generateNow(owner, project.key(), NOW).pageId();
    doThrow(new IssueAiException("AI 리포트 작성 요청에 실패했어요.", null))
        .when(client)
        .writeProjectReport(any());

    assertThatThrownBy(() -> settingsService.generateNow(owner, project.key(), NOW.plusHours(1)))
        .isInstanceOfSatisfying(
            ProjectReportGenerateException.class,
            e -> {
              assertThat(e.status()).isEqualTo(HttpStatus.BAD_GATEWAY);
              assertThat(e.getMessage()).contains("AI 리포트 작성 요청에 실패했어요.");
            });
    assertThat(rowStatus()).isEqualTo("GENERATED");
    assertThat(rowPageId()).isEqualTo(first);
    assertThat(page(first).body()).contains("첫 번째 리포트");

    aiReturns("다시 만든 리포트");
    assertThat(settingsService.generateNow(owner, project.key(), NOW.plusHours(2)).pageId())
        .isEqualTo(first);
    assertThat(page(first).body()).contains("다시 만든 리포트");
  }

  /** 처음 만들다 실패하면 회차 행을 남기지 않는다 — 정기 실행·다음 「지금 생성」이 막히지 않게. */
  @Test
  void generateNow_firstAttemptFails_leavesNoRow() {
    doThrow(new IssueAiException("AI 리포트 작성 요청에 실패했어요.", null))
        .when(client)
        .writeProjectReport(any());

    assertThatThrownBy(() -> settingsService.generateNow(owner, project.key(), NOW))
        .isInstanceOf(ProjectReportGenerateException.class);
    assertThat(rowStatus()).isNull();
  }

  /** 공통 비서가 없으면 409 — 예약하지 않는다. */
  @Test
  void generateNow_noAssistant_conflict() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());

    assertThatThrownBy(() -> settingsService.generateNow(owner, project.key(), NOW))
        .isInstanceOfSatisfying(
            ProjectReportGenerateException.class,
            e -> assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT));
    assertThat(rowStatus()).isNull();
  }

  /**
   * AI 연동이 꺼져 있으면(WP-1639) 409 AI_DISABLED — 설정 상태라 502 가 아니고, 예약·AI 호출 없이 거절한다. 공유 빈의 설정만 잠시 꺼진
   * 값으로 바꾸고 끝나면 되돌린다.
   */
  @Test
  void generateNow_aiDisabled_conflict() {
    Object target = AopTestUtils.getUltimateTargetObject(generator);
    ReflectionTestUtils.setField(
        target, "aiAgentProperties", Mockito.mock(AiAgentProperties.class)); // enabled() == false
    try {
      assertThatThrownBy(() -> settingsService.generateNow(owner, project.key(), NOW))
          .isInstanceOfSatisfying(
              ProjectReportGenerateException.class,
              e -> {
                assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT);
                assertThat(e.errors()).containsEntry("code", "AI_DISABLED");
                assertThat(e.getMessage()).isEqualTo("AI 연동이 꺼져 있어 보고를 만들 수 없어요.");
              });
      assertThat(rowStatus()).isNull();
      verify(client, never()).writeProjectReport(any());
    } finally {
      ReflectionTestUtils.setField(target, "aiAgentProperties", aiAgentProperties);
    }
  }

  /** MEMBER 는 만들 수 없다(설정 저장과 같은 권한) — AI 를 부르지 않는다. */
  @Test
  void generateNow_byMember_forbidden() {
    long member = human();
    projectService.addMember(owner, project.key(), new AddMemberRequest(member, "MEMBER"));

    assertThatThrownBy(() -> settingsService.generateNow(member, project.key(), NOW))
        .isInstanceOf(ProjectAccessDeniedException.class);
    verify(client, never()).writeProjectReport(any());
  }

  /**
   * 정기 실행이 3번 실패해 FAILED 로 닫은 회차(만들다 만 페이지가 남음)도 같은 페이지에 다시 쓰고, 사람이 고쳐 둔 직전 본문을 수정 기록에 남기며 「새 판」으로
   * 알린다(코드 리뷰: GENERATED 만 덮어쓰기로 보던 것).
   */
  @Test
  void generateNow_failedRowWithPage_replacesAndKeepsRevision() {
    aiReturns("손으로 고친 본문");
    long pageId = settingsService.generateNow(owner, project.key(), NOW).pageId();
    dsl.update(table(name("project_report")))
        .set(field(name("status"), String.class), "FAILED")
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .execute();

    aiReturns("새로 만든 리포트");
    ProjectReportGenerateResponse res =
        settingsService.generateNow(owner, project.key(), NOW.plusHours(1));

    assertThat(res.pageId()).isEqualTo(pageId);
    assertThat(res.replaced()).isTrue();
    assertThat(rowStatus()).isEqualTo("GENERATED");
    var items = revisions.list(owner, pageId).items();
    assertThat(items).isNotEmpty();
    assertThat(revisions.get(owner, pageId, items.get(0).version()).body()).contains("손으로 고친 본문");
  }

  /** 성공한 「지금 생성」도 정기 일정의 연속 실패 수·마지막 오류는 지우지 않는다(코드 리뷰). */
  @Test
  void generateNow_keepsScheduleFailureCount() {
    enableWeekly();
    dsl.update(table(name("project_report_setting")))
        .set(field(name("consecutive_failures"), Integer.class), 2)
        .set(field(name("last_error"), String.class), "정기 실행 오류")
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .execute();
    aiReturns("지금 만든 리포트");

    settingsService.generateNow(owner, project.key(), NOW);

    assertThat(settings.find(project.id()).orElseThrow().consecutiveFailures()).isEqualTo(2);
    assertThat(
            dsl.select(field(name("last_error"), String.class))
                .from(table(name("project_report_setting")))
                .where(field(name("project_id"), Long.class).eq(project.id()))
                .fetchOne(0, String.class))
        .isEqualTo("정기 실행 오류");
  }

  /**
   * 격주는 정기 회차 칸에 맞춘다 — 예정 칸이 11/2·11/16(월 09:00)인데 쉬는 주 11/9 에 누르면 정기 회차와 같은 10/19~11/1 을 만든다(지금
   * 기준이면 10/26~11/8 이 되어 두 회차에 걸친다). 꺼져 있으면 칸을 몰라 지금 기준이다.
   */
  @Test
  void manualPeriod_biweekly_alignsToScheduledSlot() {
    OffsetDateTime offWeek = OffsetDateTime.parse("2026-11-09T15:00:00+09:00");
    var on = biweeklyMonday0900(true, OffsetDateTime.parse("2026-11-16T09:00:00+09:00"));
    var period = ProjectReportGenerator.manualPeriod(on, offWeek);
    assertThat(period.start()).isEqualTo(LocalDate.parse("2026-10-19"));
    assertThat(period.end()).isEqualTo(LocalDate.parse("2026-11-01"));
    // 정기 실행이 11/2 칸(월 09:00)에 만든 회차와 같다.
    assertThat(
            ReportPeriod.lastComplete(
                ReportCadence.BIWEEKLY, OffsetDateTime.parse("2026-11-02T09:00:00+09:00")))
        .isEqualTo(period);

    var off = biweeklyMonday0900(false, null);
    assertThat(ProjectReportGenerator.manualPeriod(off, offWeek))
        .isEqualTo(ReportPeriod.lastComplete(ReportCadence.BIWEEKLY, offWeek));
  }

  /** 격주·월요일·09:00 설정 행 — 켬과 다음 예정만 바꾼다. */
  private ProjectReportSettingRepository.SettingRow biweeklyMonday0900(
      boolean enabled, OffsetDateTime nextRunAt) {
    return new ProjectReportSettingRepository.SettingRow(
        project.id(),
        enabled,
        ReportCadence.BIWEEKLY,
        DayOfWeek.MONDAY,
        LocalTime.of(9, 0),
        null,
        nextRunAt,
        0,
        null,
        false,
        null);
  }
}

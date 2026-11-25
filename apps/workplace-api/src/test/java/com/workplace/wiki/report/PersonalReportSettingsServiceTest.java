package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.dto.PersonalReportSettingsResponse;
import com.workplace.wiki.report.dto.UpdatePersonalReportSettingsRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 설정(WP-1486) — 기본값, 켤 때 「템플릿」 아래 템플릿 두 개 복사(두 번 켜도 하나, WP-1655), 다음 실행 시각(다음 그 시각 KST)·끄면
 * 비움·시각 바꾸면 다시 계산, 정시만 허용(400), 비서가 없어도 켜기 허용(P10), 마지막 실패 한 줄(P9), 월간 템플릿 되돌리기 거절(400)을 고정한다.
 *
 * <p>「지금」은 2026-11-12(목) 10:00 KST — 09:00 으로 켜면 다음 실행은 11/13 09:00 KST. 비서 해석은 목이다.
 */
@Transactional
class PersonalReportSettingsServiceTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-12T10:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired PersonalReportSettingsService service;
  @Autowired PersonalReportSettingRepository settings;
  @Autowired PersonalReportRepository reports;
  @Autowired WikiSystemPageWriter writer;
  @Autowired WikiPageService pageService;
  @Autowired ProjectService projectService;
  @Autowired AssistantResolver assistantResolver;

  private long me;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(me);
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(me, "m", "low", 4)));
  }

  private static UpdatePersonalReportSettingsRequest req(
      Boolean enabled, String time, Boolean skipEmpty) {
    return new UpdatePersonalReportSettingsRequest(enabled, time, skipEmpty);
  }

  @Test
  void get_noRow_defaults() {
    PersonalReportSettingsResponse res = service.get(me);

    assertThat(res.dailyEnabled()).isFalse();
    assertThat(res.timeOfDay()).isEqualTo("09:00");
    assertThat(res.skipEmpty()).isTrue();
    assertThat(res.nextRunAt()).isNull();
    assertThat(res.dailyTemplatePageId()).isNull();
    assertThat(res.weeklyTemplatePageId()).isNull();
    assertThat(res.assistantAvailable()).isTrue();
    assertThat(res.lastError()).isNull();
  }

  @Test
  void update_enable_copiesTemplatesAndSetsNextRun() {
    PersonalReportSettingsResponse res = service.update(me, req(true, "09:00", true), NOW);

    assertThat(res.dailyEnabled()).isTrue();
    assertThat(res.dailyTemplatePageId()).isNotNull();
    assertThat(res.weeklyTemplatePageId()).isNotNull();
    // 켜기는 「템플릿」 아래 템플릿만 갖춘다 — 「보고」는 첫 보고 때 만든다(WP-1655).
    assertThat(res.reportsPageId()).isNull();
    assertThat(res.spaceId()).isNotNull();
    assertThat(writer.findPage(res.dailyTemplatePageId()).orElseThrow().title())
        .isEqualTo(PersonalReportTemplate.DAILY_TITLE);
    assertThat(writer.findPage(res.weeklyTemplatePageId()).orElseThrow().title())
        .isEqualTo(PersonalReportTemplate.WEEKLY_TITLE);
    assertThat(res.nextRunAt().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-13T09:00:00+09:00").toInstant());
  }

  @Test
  void update_enableTwice_templatesOnce() {
    PersonalReportSettingsResponse first = service.update(me, req(true, "09:00", true), NOW);
    PersonalReportSettingsResponse second = service.update(me, req(true, "09:00", true), NOW);

    assertThat(second.dailyTemplatePageId()).isEqualTo(first.dailyTemplatePageId());
    assertThat(second.weeklyTemplatePageId()).isEqualTo(first.weeklyTemplatePageId());
    long templatesRoot = writer.findTemplatesPage(second.spaceId()).orElseThrow();
    assertThat(writer.childIdsOrdered(templatesRoot))
        .containsExactly(first.dailyTemplatePageId(), first.weeklyTemplatePageId());
  }

  @Test
  void update_disable_clearsNextRun() {
    service.update(me, req(true, "09:00", true), NOW);

    PersonalReportSettingsResponse res = service.update(me, req(false, "09:00", true), NOW);

    assertThat(res.dailyEnabled()).isFalse();
    assertThat(res.nextRunAt()).isNull();
    // 꺼도 템플릿은 그대로 둔다.
    assertThat(res.dailyTemplatePageId()).isNotNull();
  }

  @Test
  void update_changeTime_recomputesNextRun() {
    service.update(me, req(true, "09:00", true), NOW);
    // 어제(11/11)는 이미 닫혔다 — 앞당겨도 바로 돌릴 날이 없어 다음 그 시각(내일 07:00)이다.
    closeAutoDay(LocalDate.parse("2026-11-11"));

    PersonalReportSettingsResponse res = service.update(me, req(true, "07:00", false), NOW);

    assertThat(res.timeOfDay()).isEqualTo("07:00");
    assertThat(res.skipEmpty()).isFalse();
    assertThat(res.nextRunAt().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-13T07:00:00+09:00").toInstant());
  }

  /**
   * 08:30 에 09:00→08:00 으로 앞당기면 새 시각의 오늘 슬롯(08:00)이 이미 지났다. 그 슬롯이 맡을 어제(11/11)가 아직 닫히지 않았으면 다음 실행을
   * 지금으로 둬 다음 틱에 돈다 — 내일 08:00 으로 미루면 어제 보고가 빠진다.
   */
  @Test
  void update_moveEarlierPastSlot_yesterdayOpen_runsNow() {
    OffsetDateTime at = OffsetDateTime.parse("2026-11-12T08:30:00+09:00");
    service.update(me, req(true, "09:00", true), at);

    PersonalReportSettingsResponse res = service.update(me, req(true, "08:00", true), at);

    assertThat(res.nextRunAt().toInstant()).isBeforeOrEqualTo(at.toInstant());
  }

  /** 같은 앞당김이어도 어제가 이미 닫혔으면(자동 기록이 있음) 다음 그 시각 — 내일 08:00. */
  @Test
  void update_moveEarlierPastSlot_yesterdayClosed_tomorrow() {
    OffsetDateTime at = OffsetDateTime.parse("2026-11-12T08:30:00+09:00");
    service.update(me, req(true, "09:00", true), at);
    closeAutoDay(LocalDate.parse("2026-11-11"));

    PersonalReportSettingsResponse res = service.update(me, req(true, "08:00", true), at);

    assertThat(res.nextRunAt().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-13T08:00:00+09:00").toInstant());
  }

  /** 늦추면(새 시각이 오늘 아직 오지 않음) 오늘 그 시각 — 어제는 그때 만든다. */
  @Test
  void update_moveLaterNotYetPassed_todayAtNewTime() {
    OffsetDateTime at = OffsetDateTime.parse("2026-11-12T08:30:00+09:00");
    service.update(me, req(true, "08:00", true), at);

    PersonalReportSettingsResponse res = service.update(me, req(true, "09:00", true), at);

    assertThat(res.nextRunAt().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-12T09:00:00+09:00").toInstant());
  }

  /** 그날 자동 일일을 닫는다(AUTO 예약 → SKIPPED). */
  private void closeAutoDay(LocalDate day) {
    var r = reports.reserve(me, PersonalReportPeriod.daily(day), "AUTO", NOW);
    reports.markSkipped(r.id(), 0, 0, 0, NOW);
  }

  @Test
  void update_sameSchedule_keepsRetryTime() {
    service.update(me, req(true, "09:00", true), NOW);
    OffsetDateTime retry = NOW.plusMinutes(30);
    settings.recordFailure(me, retry, "AI 오류");

    // 건너뜀만 바꾸면 실행기가 정한 재시도 시각을 덮지 않는다.
    PersonalReportSettingsResponse res = service.update(me, req(true, "09:00", false), NOW);

    assertThat(res.nextRunAt().toInstant()).isEqualTo(retry.toInstant());
  }

  @Test
  void update_invalidTime_400() {
    assertThatThrownBy(() -> service.update(me, req(true, "09:30", true), NOW))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> service.update(me, req(true, "24:00", true), NOW))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(settings.find(me)).isEmpty();
  }

  @Test
  void update_enableWithoutAssistant_allowed_assistantAvailableFalse() {
    when(assistantResolver.resolveOrEmpty(me)).thenReturn(Optional.empty());

    PersonalReportSettingsResponse res = service.update(me, req(true, "09:00", true), NOW);

    assertThat(res.dailyEnabled()).isTrue();
    assertThat(res.nextRunAt()).isNotNull();
    assertThat(res.assistantAvailable()).isFalse();
  }

  @Test
  void get_lastErrorShown() {
    settings.save(me, true, LocalTime.of(9, 0), true, NOW);
    settings.recordFailure(me, NOW.plusMinutes(30), "AI 보고 작성 요청에 실패했어요.");

    assertThat(service.get(me).lastError()).isEqualTo("AI 보고 작성 요청에 실패했어요.");
  }

  /** 일일 템플릿을 다른 공간으로 옮기면 템플릿 링크를 내지 않는다(WP-1655 — 공간 밖이면 다음 켜기·생성 때 다시 만든다). */
  @Test
  void get_templateMovedToOtherSpace_hidesTemplateId() {
    PersonalReportSettingsResponse on = service.update(me, req(true, "09:00", true), NOW);
    pageService.move(me, on.dailyTemplatePageId(), new MovePageRequest(null, 0, otherSpace()));

    PersonalReportSettingsResponse res = service.get(me);

    assertThat(res.dailyTemplatePageId()).isNull();
    assertThat(res.weeklyTemplatePageId()).isEqualTo(on.weeklyTemplatePageId());
  }

  /** 템플릿을 내 노트 안 다른 페이지 밑으로 옮겨도 id 를 유지하고 경로는 실제 위치를 따른다(id 로 따라간다, WP-1655). */
  @Test
  void get_templateMovedWithinSpace_keepsId() {
    PersonalReportSettingsResponse on = service.update(me, req(true, "09:00", true), NOW);
    long other = writer.createPage(me, on.spaceId(), null, "다른 노트").id();
    writer.moveTo(on.dailyTemplatePageId(), other, 0);

    PersonalReportSettingsResponse res = service.get(me);

    assertThat(res.dailyTemplatePageId()).isEqualTo(on.dailyTemplatePageId());
    assertThat(res.dailyTemplatePath()).containsExactly("다른 노트", "일일 보고");
  }

  /** 「보고」가 없어도 내 노트 공간 id 가 나오고, 저장 위치 경로는 기본 「보고」다(WP-1655). */
  @Test
  void get_noReportsYet_returnsPersonalSpaceIdAndDefaultPath() {
    writer.ensurePersonalSpace(me);

    PersonalReportSettingsResponse res = service.get(me);

    assertThat(res.spaceId()).isNotNull();
    assertThat(res.reportsPageId()).isNull();
    assertThat(res.reportLocationPath()).containsExactly("보고");
    assertThat(res.templateRootPageId()).isNull();
  }

  /** 템플릿 경로 — 기본은 「템플릿 › 일일 보고」·「템플릿 › 주간·월간 보고」(WP-1655). */
  @Test
  void get_templatePaths() {
    PersonalReportSettingsResponse on = service.update(me, req(true, "09:00", true), NOW);

    assertThat(on.dailyTemplatePath()).containsExactly("템플릿", "일일 보고");
    assertThat(on.weeklyTemplatePath()).containsExactly("템플릿", "주간·월간 보고");
    assertThat(on.templateRootPageId()).isNotNull();
    assertThat(on.templateRecreatedAt()).isNull();
  }

  /** 옛 구조(「보고」 아래 템플릿, template_initialized=false)를 만든다 — 본문은 사람이 고친 것. */
  private long[] legacyTemplates() {
    long space = writer.ensurePersonalSpace(me);
    long reports = writer.ensurePersonalReportsPage(space, me);
    WikiPageDetail daily = writer.createPage(me, space, reports, "템플릿 · 일일 보고");
    WikiPageDetail weekly = writer.createPage(me, space, reports, "템플릿 · 주간 보고");
    settings.setTemplate(me, PersonalReportKind.DAILY, daily.id(), false);
    settings.setTemplate(me, PersonalReportKind.WEEKLY, weekly.id(), false);
    return new long[] {space, reports, daily.id(), weekly.id()};
  }

  private void setRecreatedAt(OffsetDateTime at) {
    dsl.update(table(name("personal_report_setting")))
        .set(field(name("template_recreated_at"), OffsetDateTime.class), at)
        .where(field(name("user_id"), Long.class).eq(me))
        .execute();
  }

  /** 켜진 채 저장만 해도 옛 템플릿을 「템플릿」 으로 옮기고 이름을 바꾼다(WP-1655). */
  @Test
  void update_savesAgain_relocatesLegacyTemplates() {
    long[] legacy = legacyTemplates();
    settings.save(me, true, LocalTime.of(9, 0), true, NOW.plusDays(1));

    PersonalReportSettingsResponse res = service.update(me, req(true, "09:00", false), NOW);

    assertThat(res.dailyTemplatePageId()).isEqualTo(legacy[2]);
    assertThat(res.weeklyTemplatePageId()).isEqualTo(legacy[3]);
    assertThat(res.dailyTemplatePath()).containsExactly("템플릿", "일일 보고");
    assertThat(res.weeklyTemplatePath()).containsExactly("템플릿", "주간·월간 보고");
  }

  /** 켜진 채 저장할 때 템플릿을 지웠으면 다시 만들고 알림이 선다(WP-1655). */
  @Test
  void update_enabled_recreatesDeletedTemplate_andShowsNotice() {
    PersonalReportSettingsResponse on = service.update(me, req(true, "09:00", true), NOW);
    pageService.delete(me, on.dailyTemplatePageId());

    PersonalReportSettingsResponse res = service.update(me, req(true, "09:00", true), NOW);

    assertThat(res.dailyTemplatePageId()).isNotNull().isNotEqualTo(on.dailyTemplatePageId());
    assertThat(res.dailyTemplatePath()).containsExactly("템플릿", "일일 보고");
    assertThat(res.templateRecreatedAt()).isNotNull();
  }

  /** 다음 쓰기(다시 만들지 않는)는 알림을 지운다(WP-1655). */
  @Test
  void update_nextWrite_clearsNotice() {
    PersonalReportSettingsResponse on = service.update(me, req(true, "09:00", true), NOW);
    pageService.delete(me, on.dailyTemplatePageId());
    assertThat(service.update(me, req(true, "09:00", true), NOW).templateRecreatedAt()).isNotNull();

    PersonalReportSettingsResponse next = service.update(me, req(true, "09:00", true), NOW);

    assertThat(next.templateRecreatedAt()).isNull();
  }

  /** 저장 위치를 고르면 응답의 reportsPageId·경로가 그 페이지다(WP-1655). */
  @Test
  void updateLocation_valid_savesAndDescribes() {
    long space = writer.ensurePersonalSpace(me);
    long notes = writer.createPage(me, space, null, "회의록").id();
    long weekly = writer.createPage(me, space, notes, "주간 보고").id();

    PersonalReportSettingsResponse res = service.updateLocation(me, weekly);

    assertThat(res.reportsPageId()).isEqualTo(weekly);
    assertThat(res.reportLocationPath()).containsExactly("회의록", "주간 보고");
    assertThat(service.get(me).reportsPageId()).isEqualTo(weekly);
  }

  /** 거절된 위치 저장(400)은 옛 템플릿 이동·알림 지우기·저장값 변경을 남기지 않는다(WP-1655 리뷰 초점 4). */
  @Test
  void updateLocation_rejected_hasNoSideEffects() {
    long[] legacy = legacyTemplates();
    OffsetDateTime notice = OffsetDateTime.now().minusHours(1);
    setRecreatedAt(notice);
    long outside = writer.createPage(me, otherSpace(), null, "밖").id();

    assertThatThrownBy(() -> service.updateLocation(me, outside))
        .isInstanceOf(IllegalArgumentException.class);

    // 옛 템플릿은 「보고」 아래 그대로, 이름도 그대로.
    assertThat(pageService.get(me, legacy[2]).title()).isEqualTo("템플릿 · 일일 보고");
    assertThat(writer.childIdsOrdered(legacy[1])).contains(legacy[2], legacy[3]);
    assertThat(settings.find(me).orElseThrow().templateRecreatedAt()).isNotNull();
    assertThat(settings.find(me).orElseThrow().reportLocationPageId()).isNull();
    assertThat(settings.find(me).orElseThrow().templateInitialized()).isFalse();
  }

  /** 월간 되돌리기 400 은 옛 템플릿 이동·알림 지우기보다 앞서 거절한다(WP-1655). */
  @Test
  void resetTemplate_monthly_rejectedBeforeSideEffects() {
    long[] legacy = legacyTemplates();
    setRecreatedAt(OffsetDateTime.now().minusHours(1));

    assertThatThrownBy(() -> service.resetTemplate(me, PersonalReportKind.MONTHLY))
        .isInstanceOf(IllegalArgumentException.class);

    assertThat(pageService.get(me, legacy[3]).title()).isEqualTo("템플릿 · 주간 보고");
    assertThat(settings.find(me).orElseThrow().templateRecreatedAt()).isNotNull();
  }

  /** 시각이 정시가 아닌 저장 400 도 부수효과를 남기지 않는다(WP-1655). */
  @Test
  void update_invalidTime_rejectedBeforeSideEffects() {
    long[] legacy = legacyTemplates();

    assertThatThrownBy(() -> service.update(me, req(true, "09:30", true), NOW))
        .isInstanceOf(IllegalArgumentException.class);

    assertThat(pageService.get(me, legacy[2]).title()).isEqualTo("템플릿 · 일일 보고");
  }

  /** 내가 OWNER 인 다른 공간 — 새 프로젝트의 노트 공간. */
  private long otherSpace() {
    String key =
        "PS" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    long projectId =
        projectService.create(me, new CreateProjectRequest(key, "설정-" + key, null, "TEAM")).id();
    return writer.ensureProjectSpace(projectId).orElseThrow();
  }

  @Test
  void resetTemplate_monthly_400() {
    assertThatThrownBy(() -> service.resetTemplate(me, PersonalReportKind.MONTHLY))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void resetTemplate_daily_keepsSamePage() {
    PersonalReportSettingsResponse on = service.update(me, req(true, "09:00", true), NOW);

    PersonalReportSettingsResponse res = service.resetTemplate(me, PersonalReportKind.DAILY);

    assertThat(res.dailyTemplatePageId()).isEqualTo(on.dailyTemplatePageId());
  }
}

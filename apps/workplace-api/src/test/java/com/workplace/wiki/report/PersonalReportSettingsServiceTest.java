package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.dto.PersonalReportSettingsResponse;
import com.workplace.wiki.report.dto.UpdatePersonalReportSettingsRequest;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 설정(WP-1486) — 기본값, 켤 때 「보고」·템플릿 두 개 복사(두 번 켜도 하나), 다음 실행 시각(다음 그 시각 KST)·끄면 비움·시각 바꾸면 다시
 * 계산, 정시만 허용(400), 비서가 없어도 켜기 허용(P10), 마지막 실패 한 줄(P9), 월간 템플릿 되돌리기 거절(400)을 고정한다.
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
  @Autowired AssistantResolver assistantResolver;

  private long me;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(me);
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(me, "m", "low", 4, 60_000)));
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
    assertThat(res.reportsPageId()).isNotNull();
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
    assertThat(writer.childIdsOrdered(second.reportsPageId()))
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

  @Test
  void get_templateMovedOut_hidesTemplateId() {
    PersonalReportSettingsResponse on = service.update(me, req(true, "09:00", true), NOW);
    // 일일 템플릿을 「보고」 바로 아래가 아닌 곳(다른 페이지 밑)으로 옮기면 템플릿 링크를 내지 않는다.
    long other = writer.createPage(me, on.spaceId(), on.reportsPageId(), "다른 노트").id();
    writer.moveTo(on.dailyTemplatePageId(), other, 0);

    PersonalReportSettingsResponse res = service.get(me);

    assertThat(res.dailyTemplatePageId()).isNull();
    assertThat(res.weeklyTemplatePageId()).isEqualTo(on.weeklyTemplatePageId());
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

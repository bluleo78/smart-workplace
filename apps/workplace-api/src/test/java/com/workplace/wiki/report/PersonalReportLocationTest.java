package com.workplace.wiki.report;

import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.report.PersonalReportLocation.Description;
import com.workplace.wiki.report.PersonalReportLocation.Resolved;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 저장 위치 해석기(WP-1655) — 읽기 전용 설명(아무것도 만들지 않음), 생성용 해석(고른 위치가 유효하면 「보고」를 만들지 않음·지워지거나 다른 공간으로
 * 옮겨지면 「보고」로 되돌아감·막힌 갈래로 옮겨지면 이번만 「보고」), 설정 저장 검증(내 노트 밖·「템플릿」 갈래·달 폴더 갈래·AI 보고 거절).
 */
@Transactional
class PersonalReportLocationTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired WikiPageService pageService;
  @Autowired WikiSystemPageWriter writer;
  @Autowired PersonalReportSettingRepository settings;
  @Autowired PersonalReportLocation location;

  private long me;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(me);
  }

  /** 고른 위치가 없으면 경로는 「보고」 — 공간·「보고」가 없으면 만들지 않고 id 는 비운다. */
  @Test
  void describe_noChoice_defaultsToReportsPath() {
    Description none = location.describe(me);
    assertThat(none).isEqualTo(new Description(null, null, List.of("보고"), null));
    assertThat(writer.findPersonalSpace(me)).isEmpty();

    long spaceId = writer.ensurePersonalSpace(me);
    Description d = location.describe(me);
    assertThat(d.spaceId()).isEqualTo(spaceId);
    assertThat(d.locationPageId()).isNull();
    assertThat(d.locationPath()).containsExactly("보고");
    assertThat(d.templatesRootId()).isNull();
    assertThat(writer.findPersonalReportsPage(spaceId)).isEmpty();

    long reports = writer.ensurePersonalReportsPage(spaceId, me);
    long templates = writer.ensureTemplatesPage(spaceId, me);
    d = location.describe(me);
    assertThat(d.locationPageId()).isEqualTo(reports);
    assertThat(d.templatesRootId()).isEqualTo(templates);
  }

  /** 유효한 고른 위치는 그 경로로 보인다. */
  @Test
  void describe_validChoice_returnsPath() {
    long spaceId = writer.ensurePersonalSpace(me);
    long log = writer.createPage(me, spaceId, null, "업무 일지").id();
    long team = writer.createPage(me, spaceId, log, "팀").id();
    settings.setLocation(me, team);

    Description d = location.describe(me);
    assertThat(d.spaceId()).isEqualTo(spaceId);
    assertThat(d.locationPageId()).isEqualTo(team);
    assertThat(d.locationPath()).containsExactly("업무 일지", "팀");
  }

  /** 고른 위치가 유효하면 그 아래에 쓰고 「보고」는 만들지 않는다. */
  @Test
  void resolveForWrite_validChoice_doesNotCreateReports() {
    long spaceId = writer.ensurePersonalSpace(me);
    long log = writer.createPage(me, spaceId, null, "업무 일지").id();
    settings.setLocation(me, log);

    assertThat(location.resolveForWrite(me)).isEqualTo(new Resolved(spaceId, log));
    assertThat(writer.findPersonalReportsPage(spaceId)).isEmpty();
  }

  /** 고른 위치를 지우면 FK 가 NULL 로 되어 「보고」로 돌아간다(없으면 만든다). 공간도 없으면 만든다. */
  @Test
  void resolveForWrite_deletedChoice_fallsBackToReports() {
    long spaceId = writer.ensurePersonalSpace(me);
    long log = writer.createPage(me, spaceId, null, "업무 일지").id();
    settings.setLocation(me, log);
    pageService.delete(me, log);
    assertThat(settings.find(me).orElseThrow().reportLocationPageId()).isNull();

    Resolved r = location.resolveForWrite(me);
    long reports = writer.findPersonalReportsPage(spaceId).orElseThrow();
    assertThat(r).isEqualTo(new Resolved(spaceId, reports));
    assertThat(location.describe(me).locationPageId()).isEqualTo(reports);
  }

  /** 공간이 아직 없는 사람도 쓸 때는 공간과 「보고」를 만든다. */
  @Test
  void resolveForWrite_noSpace_createsSpaceAndReports() {
    Resolved r = location.resolveForWrite(me);
    assertThat(writer.findPersonalSpace(me)).hasValue(r.spaceId());
    assertThat(writer.findPersonalReportsPage(r.spaceId())).hasValue(r.parentPageId());
  }

  /** 고른 위치가 다른 공간으로 옮겨졌으면 「보고」에 쓰고 설정값을 지운다. 설명은 곧바로 「보고」. */
  @Test
  void resolveForWrite_movedToOtherSpace_clearsSetting() {
    long spaceId = writer.ensurePersonalSpace(me);
    long log = writer.createPage(me, spaceId, null, "업무 일지").id();
    settings.setLocation(me, log);
    pageService.move(me, log, new MovePageRequest(null, 0, otherSpace()));

    assertThat(location.describe(me).locationPath()).containsExactly("보고");
    assertThat(settings.find(me).orElseThrow().reportLocationPageId()).isEqualTo(log);
    Resolved r = location.resolveForWrite(me);
    assertThat(r.parentPageId()).isEqualTo(writer.findPersonalReportsPage(spaceId).orElseThrow());
    assertThat(settings.find(me).orElseThrow().reportLocationPageId()).isNull();
  }

  /**
   * 고른 위치가 나중에 「템플릿」·템플릿 페이지·달 폴더 아래로 옮겨지면 이번만 「보고」에 쓴다 — 설정값은 남겨 다시 밖으로 옮기면 그 자리를 쓴다. 설명도 같은 판정.
   */
  @Test
  void resolveForWrite_movedUnderTemplates_usesReportsButKeepsSetting() {
    long spaceId = writer.ensurePersonalSpace(me);
    long templates = writer.ensureTemplatesPage(spaceId, me);
    long log = writer.createPage(me, spaceId, null, "업무 일지").id();
    settings.setLocation(me, log);
    writer.moveTo(log, templates, 0);

    long reports = location.resolveForWrite(me).parentPageId();
    assertThat(reports).isEqualTo(writer.findPersonalReportsPage(spaceId).orElseThrow());
    assertThat(settings.find(me).orElseThrow().reportLocationPageId()).isEqualTo(log);
    assertThat(location.describe(me).locationPath()).containsExactly("보고");
    assertThat(location.describe(me).locationPageId()).isEqualTo(reports);

    // 「템플릿」 밖으로 옮긴 주간 템플릿 아래도 막힌다.
    long weekly = writer.createPage(me, spaceId, null, "주간·월간 보고").id();
    settings.setTemplate(me, PersonalReportKind.WEEKLY, weekly, false);
    writer.moveTo(log, weekly, 0);
    assertThat(location.resolveForWrite(me).parentPageId()).isEqualTo(reports);

    // 달 폴더 아래도 막힌다.
    long month = writer.createPage(me, spaceId, reports, "2026년 11월").id();
    writer.moveTo(log, month, 0);
    assertThat(location.resolveForWrite(me).parentPageId()).isEqualTo(reports);
    assertThat(location.describe(me).locationPath()).containsExactly("보고");

    // 다시 밖으로 옮기면 고른 위치를 그대로 쓴다.
    pageService.move(me, log, new MovePageRequest(null, 0));
    assertThat(location.resolveForWrite(me).parentPageId()).isEqualTo(log);
    assertThat(location.describe(me).locationPath()).containsExactly("업무 일지");
  }

  /** 내 노트 밖·없는 페이지·공간이 아직 없는 사람은 거절한다. */
  @Test
  void validateChoice_otherSpace_rejected() {
    long outside = writer.createPage(me, otherSpace(), null, "밖").id();
    assertThatThrownBy(() -> location.validateChoice(me, outside))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage(PersonalReportLocation.NOT_IN_SPACE)
        .hasMessage("내 노트의 페이지만 고를 수 있어요.");

    long spaceId = writer.ensurePersonalSpace(me);
    assertThatThrownBy(() -> location.validateChoice(me, Long.MAX_VALUE))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage(PersonalReportLocation.NOT_IN_SPACE);
    long ok = writer.createPage(me, spaceId, null, "업무 일지").id();
    location.validateChoice(me, ok);
  }

  /** 「템플릿」 자신·그 아래, 설정의 일일 템플릿 자신(「템플릿」 밖으로 옮겨졌어도)은 거절한다. */
  @Test
  void validateChoice_templatesBranch_rejected() {
    long spaceId = writer.ensurePersonalSpace(me);
    long templates = writer.ensureTemplatesPage(spaceId, me);
    long under = writer.createPage(me, spaceId, templates, "안").id();
    long daily = writer.createPage(me, spaceId, null, "일일 보고").id();
    settings.setTemplate(me, PersonalReportKind.DAILY, daily, false);
    long underDaily = writer.createPage(me, spaceId, daily, "템플릿 아래").id();

    String msg = "템플릿 아래에는 보고를 둘 수 없어요.";
    assertThat(PersonalReportLocation.UNDER_TEMPLATE).isEqualTo(msg);
    for (long pageId : new long[] {templates, under, daily, underDaily}) {
      assertThatThrownBy(() -> location.validateChoice(me, pageId))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage(msg);
    }
  }

  /** AI 가 쓴 보고 페이지 자신은 거절한다. */
  @Test
  void validateChoice_aiReport_rejected() {
    long spaceId = writer.ensurePersonalSpace(me);
    long aiReport = writer.createPage(me, spaceId, null, "11월 11일 (수) 일일 보고").id();
    writer.markAiReport(aiReport, OffsetDateTime.now());

    assertThatThrownBy(() -> location.validateChoice(me, aiReport))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage(PersonalReportLocation.UNDER_AI_REPORT)
        .hasMessage("AI 가 쓴 보고 페이지 아래에는 둘 수 없어요.");
  }

  /** 「보고 › 2026년 11월」 달 폴더 자신과 그 아래 사람이 만든 페이지는 거절한다. 「보고」 자신은 고를 수 있다. */
  @Test
  void validateChoice_underMonthFolder_rejected() {
    long spaceId = writer.ensurePersonalSpace(me);
    long reports = writer.ensurePersonalReportsPage(spaceId, me);
    long month = writer.createPage(me, spaceId, reports, "2026년 11월").id();
    long memo = writer.createPage(me, spaceId, month, "메모").id();

    String msg = "달 폴더 아래에는 보고를 둘 수 없어요.";
    assertThat(PersonalReportLocation.UNDER_MONTH_FOLDER).isEqualTo(msg);
    assertThatThrownBy(() -> location.validateChoice(me, month))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage(msg);
    assertThatThrownBy(() -> location.validateChoice(me, memo))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage(msg);
    location.validateChoice(me, reports);
  }

  /** 달 폴더처럼 보여도 월이 1–12 밖이면 달 폴더가 아니다 — 고를 수 있다. */
  @Test
  void validateChoice_monthLikeTitleOutOfRange_allowed() {
    long spaceId = writer.ensurePersonalSpace(me);
    long odd = writer.createPage(me, spaceId, null, "2026년 13월").id();
    long under = writer.createPage(me, spaceId, odd, "메모").id();
    location.validateChoice(me, odd);
    location.validateChoice(me, under);
  }

  /** 내가 OWNER 인 다른 공간 — 새 프로젝트의 노트 공간. */
  private long otherSpace() {
    String key = uniqueProjectKey("PL");
    long projectId =
        projectService.create(me, new CreateProjectRequest(key, "위치-" + key, null, "TEAM")).id();
    return writer.ensureProjectSpace(projectId).orElseThrow();
  }
}

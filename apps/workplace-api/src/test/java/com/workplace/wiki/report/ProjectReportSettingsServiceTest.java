package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.dto.ProjectReportSettingsResponse;
import com.workplace.wiki.report.dto.UpdateProjectReportSettingsRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.ReportsHome;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 리포트 설정(WP-1483) — 기본값, 켤 때 기본 템플릿을 「리포트」 맨 위로 복사(한 번만, 지워졌으면 다시), 다음 실행 시각, 기본으로 되돌리기(직전 판
 * 남김), 권한(MEMBER 403·개인 프로젝트 400), 공간 멤버가 아닌 ADMIN 이 켜도 가장 먼저 OWNER 로 복사.
 */
@Transactional
class ProjectReportSettingsServiceTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired WikiPageService pageService;
  @Autowired WikiSystemPageWriter writer;
  @Autowired ProjectReportSettingsService service;
  @Autowired ProjectReportSettingRepository settings;

  private long ownerId;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    project = project(ownerId, "TEAM");
  }

  /** 설정 행이 없으면 꺼짐·매주·월요일·09:00, 다음 실행·템플릿 없음. OWNER 는 관리할 수 있다. */
  @Test
  void get_defaultsWhenNoRow() {
    ProjectReportSettingsResponse r = service.get(ownerId, project.key());
    assertThat(r.enabled()).isFalse();
    assertThat(r.cadence()).isEqualTo("WEEKLY");
    assertThat(r.weekday()).isEqualTo("MONDAY");
    assertThat(r.timeOfDay()).isEqualTo("09:00");
    assertThat(r.templatePageId()).isNull();
    assertThat(r.nextRunAt()).isNull();
    assertThat(r.canManage()).isTrue();
  }

  /**
   * 켜면 맨 위 「템플릿」(공간 맨 위 0번) 아래에 「정기 리포트」를 기본 글(지시 상자·참고 지표 표 포함, 주소 자리표시 치환)로 복사한다(WP-1654). 「리포트」
   * 에는 템플릿을 두지 않는다.
   */
  @Test
  void enable_copiesTemplateUnderTemplates() {
    ProjectReportSettingsResponse r = service.update(ownerId, project.key(), enable());
    assertThat(r.enabled()).isTrue();
    assertThat(r.templatePageId()).isNotNull();
    WikiPageDetail template = pageService.get(ownerId, r.templatePageId());
    assertThat(template.title()).isEqualTo("정기 리포트");
    WikiPageDetail parent = pageService.get(ownerId, template.parentId());
    assertThat(parent.title()).isEqualTo("템플릿");
    assertThat(parent.parentId()).isNull();
    assertThat(rootIds(template.spaceId())).first().isEqualTo(parent.id());
    long reports = writer.findReportsPage(template.spaceId()).orElseThrow();
    assertThat(writer.childIdsOrdered(reports)).doesNotContain(template.id());
    assertThat(settings.find(project.id()).orElseThrow().templateInitialized()).isTrue();
    assertThat(settings.find(project.id()).orElseThrow().templateRecreatedAt()).isNull();
    assertThat(template.body())
        .contains("wp-ai-instruction")
        .contains("| 지표 | 이번 회차 | 지난 회차 |")
        .contains("/projects/" + project.key() + "/issues/1299")
        // 새 기본 템플릿(WP-1629) — 주소 자리표시는 바뀌고, 후처리가 도표로 바꿀 「{{일정 도표}}」 줄은 남는다.
        .contains("{{일정 도표}}")
        .doesNotContain("{{BASE_URL}}")
        .doesNotContain("{{PROJECT_KEY}}");
    assertThat(writer.childIdsOrdered(parent.id())).first().isEqualTo(template.id());
  }

  /** 두 번 켜도(설정만 바꿔도) 템플릿은 하나 — 다시 복사하지 않는다. */
  @Test
  void enable_twice_doesNotCopyAgain() {
    long first = service.update(ownerId, project.key(), enable()).templatePageId();
    long second =
        service
            .update(
                ownerId,
                project.key(),
                new UpdateProjectReportSettingsRequest(true, "BIWEEKLY", "FRIDAY", "17:00"))
            .templatePageId();
    assertThat(second).isEqualTo(first);
    WikiPageDetail template = pageService.get(ownerId, first);
    assertThat(writer.childIdsOrdered(template.parentId())).containsExactly(first);
  }

  /** 사람이 템플릿을 지웠으면 다시 켤 때 「템플릿」 아래 새로 복사하고 「다시 만들었어요」 시각을 남긴다(WP-1654). */
  @Test
  void enable_recopies_whenTemplateDeleted() {
    long first = service.update(ownerId, project.key(), enable()).templatePageId();
    pageService.delete(ownerId, first);
    long second = service.update(ownerId, project.key(), enable()).templatePageId();
    assertThat(second).isNotEqualTo(first);
    WikiPageDetail template = pageService.get(ownerId, second);
    assertThat(template.title()).isEqualTo("정기 리포트");
    assertThat(pageService.get(ownerId, template.parentId()).title()).isEqualTo("템플릿");
    assertThat(settings.find(project.id()).orElseThrow().templateRecreatedAt()).isNotNull();
  }

  /**
   * 옛 구조(「리포트」 바로 아래 「템플릿 · 주간 리포트」, V296 전) — 다음 저장에서 같은 id 를 「템플릿」 아래 맨 위로 옮기고 제목을 「정기 리포트」로 바꾼다.
   * 본문은 그대로. 한 번만 — 그 뒤 사람이 「리포트」 아래로 다시 옮겨도 옮기지 않는다(WP-1654).
   */
  @Test
  void enable_migratesLegacyTemplateUnderReports_once() {
    long legacy = legacyTemplate("사람이 고친 옛 템플릿");

    long kept = service.update(ownerId, project.key(), enable()).templatePageId();
    assertThat(kept).isEqualTo(legacy);
    WikiPageDetail moved = pageService.get(ownerId, legacy);
    assertThat(moved.title()).isEqualTo("정기 리포트");
    assertThat(moved.body()).isEqualTo("사람이 고친 옛 템플릿");
    assertThat(pageService.get(ownerId, moved.parentId()).title()).isEqualTo("템플릿");
    assertThat(writer.childIdsOrdered(moved.parentId())).first().isEqualTo(legacy);
    assertThat(settings.find(project.id()).orElseThrow().templateInitialized()).isTrue();
    assertThat(settings.find(project.id()).orElseThrow().templateRecreatedAt()).isNull();

    long reports = writer.findReportsPage(moved.spaceId()).orElseThrow();
    writer.moveTo(legacy, reports, 0);
    service.update(ownerId, project.key(), enable());
    assertThat(pageService.get(ownerId, legacy).parentId()).isEqualTo(reports);
  }

  /** 켜면 다음 실행 시각을 정한다(설정한 요일·시각, KST). */
  @Test
  void enable_setsNextRun() {
    OffsetDateTime before = OffsetDateTime.now();
    ProjectReportSettingsResponse r =
        service.update(
            ownerId,
            project.key(),
            new UpdateProjectReportSettingsRequest(true, "WEEKLY", "WEDNESDAY", "13:00"));
    assertThat(r.cadence()).isEqualTo("WEEKLY");
    assertThat(r.weekday()).isEqualTo("WEDNESDAY");
    assertThat(r.timeOfDay()).isEqualTo("13:00");
    assertThat(r.nextRunAt()).isAfter(before).isBefore(before.plusDays(8));
    OffsetDateTime kst =
        r.nextRunAt().atZoneSameInstant(java.time.ZoneId.of("Asia/Seoul")).toOffsetDateTime();
    assertThat(kst.getDayOfWeek()).isEqualTo(java.time.DayOfWeek.WEDNESDAY);
    assertThat(kst.getHour()).isEqualTo(13);
  }

  /** 끄면 다음 실행 시각을 비운다(템플릿은 그대로 둔다). */
  @Test
  void disable_clearsNextRun() {
    long template = service.update(ownerId, project.key(), enable()).templatePageId();
    ProjectReportSettingsResponse r =
        service.update(
            ownerId,
            project.key(),
            new UpdateProjectReportSettingsRequest(false, null, null, null));
    assertThat(r.enabled()).isFalse();
    assertThat(r.nextRunAt()).isNull();
    assertThat(r.templatePageId()).isEqualTo(template);
  }

  /** 되돌리기 — 사람이 고친 템플릿 본문을 기본으로 바꾸고, 고친 판은 수정 기록에 남는다. */
  @Test
  void reset_rewritesTemplateToDefault() {
    long template = service.update(ownerId, project.key(), enable()).templatePageId();
    WikiPageDetail current = pageService.get(ownerId, template);
    pageService.save(
        ownerId, template, new SavePageRequest(null, "사람이 바꾼 본문", current.version(), false));

    ProjectReportSettingsResponse r = service.resetTemplate(ownerId, project.key());
    assertThat(r.templatePageId()).isEqualTo(template);
    assertThat(pageService.get(ownerId, template).body())
        .contains("wp-ai-instruction")
        .doesNotContain("사람이 바꾼 본문");
    assertThat(
            dsl.fetchCount(
                WIKI_REVISION,
                WIKI_REVISION.PAGE_ID.eq(template).and(WIKI_REVISION.BODY.eq("사람이 바꾼 본문"))))
        .isEqualTo(1);
  }

  /** MEMBER 는 설정·되돌리기를 못 한다(403). 읽기는 되고 canManage=false. */
  @Test
  void update_byMember_forbidden() {
    long member = human();
    projectService.addMember(ownerId, project.key(), new AddMemberRequest(member, "MEMBER"));
    assertThatThrownBy(() -> service.update(member, project.key(), enable()))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> service.resetTemplate(member, project.key()))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThat(service.get(member, project.key()).canManage()).isFalse();
  }

  /** 개인 프로젝트는 리포트를 만들지 않는다(400). */
  @Test
  void update_personalProject_badRequest() {
    ProjectResponse personal = project(ownerId, "PERSONAL");
    assertThatThrownBy(() -> service.update(ownerId, personal.key(), enable()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("개인 프로젝트는 리포트를 만들지 않아요.");
    assertThatThrownBy(() -> service.resetTemplate(ownerId, personal.key()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(service.get(ownerId, personal.key()).canManage()).isFalse();
  }

  /** 공간 멤버가 아닌 테넌트 ADMIN 이 켜도 복사는 가장 먼저 OWNER 가 쓴 것으로 성공한다. */
  @Test
  void enable_byAdminNotInSpace_copiesTemplateAsEarliestOwner() {
    long admin = human();
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    ProjectReportSettingsResponse r = service.update(admin, project.key(), enable());
    assertThat(r.canManage()).isTrue();
    WikiPageDetail template = pageService.get(ownerId, r.templatePageId());
    assertThat(template.title()).isEqualTo("정기 리포트");
    assertThat(template.updatedBy()).isEqualTo(ownerId);
  }

  /**
   * 일정이 그대로인 저장은 실행기가 정한 next_run_at(재시도 시각)·실패 수를 덮지 않는다 — 실행 중 설정 저장이 점유·재시도를 지우지 않게. 일정을 바꾸면 다시
   * 계산하고 실패 수·오류를 지운다.
   */
  @Test
  void update_sameSchedule_keepsRunnerStateUntilScheduleChanges() {
    service.update(ownerId, project.key(), enable());
    OffsetDateTime retry = OffsetDateTime.parse("2030-01-07T09:30:00+09:00");
    settingField("next_run_at", retry);
    settings.recordFailure(project.id(), retry, "AI 오류");

    ProjectReportSettingsResponse same = service.update(ownerId, project.key(), enable());
    assertThat(same.nextRunAt().toInstant()).isEqualTo(retry.toInstant());
    assertThat(settings.find(project.id()).orElseThrow().consecutiveFailures()).isEqualTo(1);

    ProjectReportSettingsResponse changed =
        service.update(
            ownerId,
            project.key(),
            new UpdateProjectReportSettingsRequest(true, "WEEKLY", "TUESDAY", "09:00"));
    assertThat(changed.nextRunAt().toInstant()).isNotEqualTo(retry.toInstant());
    assertThat(settings.find(project.id()).orElseThrow().consecutiveFailures()).isZero();
    assertThat(
            dsl.select(field(name("last_error"), String.class))
                .from(table(name("project_report_setting")))
                .where(org.jooq.impl.DSL.field(name("project_id"), Long.class).eq(project.id()))
                .fetchOne(0, String.class))
        .isNull();
  }

  private void settingField(String column, OffsetDateTime value) {
    dsl.update(table(name("project_report_setting")))
        .set(field(name(column), OffsetDateTime.class), value)
        .where(org.jooq.impl.DSL.field(name("project_id"), Long.class).eq(project.id()))
        .execute();
  }

  /** 꺼진 채 저장해도 옛 위치 템플릿을 옮긴다(복사는 하지 않음). 위치만 바꿔도 같은 이전이 일어난다(WP-1654). */
  @Test
  void disabledSave_migratesLegacyTemplate() {
    long legacy = legacyTemplate("옛 본문");
    service.update(
        ownerId, project.key(), new UpdateProjectReportSettingsRequest(false, null, null, null));
    WikiPageDetail moved = pageService.get(ownerId, legacy);
    assertThat(moved.title()).isEqualTo("정기 리포트");
    assertThat(pageService.get(ownerId, moved.parentId()).title()).isEqualTo("템플릿");

    ProjectResponse other = project(ownerId, "TEAM");
    long otherLegacy = legacyTemplate(other, "다른 옛 본문");
    long spaceId = writer.ensureProjectSpace(other.id()).orElseThrow();
    long minutes = writer.createPage(ownerId, spaceId, null, "회의록").id();
    ProjectReportSettingsResponse r = service.updateLocation(ownerId, other.key(), minutes);
    assertThat(pageService.get(ownerId, otherLegacy).title()).isEqualTo("정기 리포트");
    assertThat(r.templatePath()).containsExactly("템플릿", "정기 리포트");
  }

  /** 템플릿을 같은 공간의 다른 페이지 아래로 옮겨도 그대로 쓰고, 경로가 새 자리를 보인다(WP-1654). */
  @Test
  void template_movedWithinSpace_keepsUsing() {
    ProjectReportSettingsResponse first = service.update(ownerId, project.key(), enable());
    assertThat(first.templatePath()).containsExactly("템플릿", "정기 리포트");
    assertThat(first.templateRootPageId()).isNotNull();
    long template = first.templatePageId();
    long minutes = writer.createPage(ownerId, first.noteSpaceId(), null, "회의록").id();
    writer.moveTo(template, minutes, 0);

    ProjectReportSettingsResponse r = service.update(ownerId, project.key(), enable());
    assertThat(r.templatePageId()).isEqualTo(template);
    assertThat(r.templatePath()).containsExactly("회의록", "정기 리포트");
    assertThat(r.templateRecreatedAt()).isNull();
  }

  /** 템플릿을 다른 공간으로 옮기면 「템플릿」 아래 새로 만들고 알린다 — 다음 저장(다시 만들지 않는)이 알림을 지운다(WP-1654). */
  @Test
  void template_movedToOtherSpace_recreated() {
    long template = service.update(ownerId, project.key(), enable()).templatePageId();
    long otherSpace = writer.ensureProjectSpace(project(ownerId, "TEAM").id()).orElseThrow();
    pageService.move(ownerId, template, new MovePageRequest(null, 0, otherSpace));

    ProjectReportSettingsResponse r = service.update(ownerId, project.key(), enable());
    assertThat(r.templatePageId()).isNotEqualTo(template);
    assertThat(r.templatePath()).containsExactly("템플릿", "정기 리포트");
    assertThat(r.templateRecreatedAt()).isNotNull();

    ProjectReportSettingsResponse next = service.update(ownerId, project.key(), enable());
    assertThat(next.templatePageId()).isEqualTo(r.templatePageId());
    assertThat(next.templateRecreatedAt()).isNull();
  }

  /** GET 은 아무 페이지도 만들지 않는다 — 템플릿·「리포트」를 지운 뒤 GET 해도 페이지 수 그대로, 템플릿 없음, 위치 경로는 「리포트」(WP-1654). */
  @Test
  void get_doesNotCreatePages() {
    ProjectReportSettingsResponse on = service.update(ownerId, project.key(), enable());
    pageService.delete(ownerId, on.templatePageId());
    pageService.delete(ownerId, writer.findReportsPage(on.noteSpaceId()).orElseThrow());
    int before = dsl.fetchCount(WIKI_PAGE, WIKI_PAGE.SPACE_ID.eq(on.noteSpaceId()));

    ProjectReportSettingsResponse r = service.get(ownerId, project.key());
    assertThat(dsl.fetchCount(WIKI_PAGE, WIKI_PAGE.SPACE_ID.eq(on.noteSpaceId())))
        .isEqualTo(before);
    assertThat(r.templatePageId()).isNull();
    assertThat(r.templatePath()).isEmpty();
    assertThat(r.reportLocationPageId()).isNull();
    assertThat(r.reportLocationPath()).containsExactly("리포트");
  }

  /** 「회의록 › 주간 보고」를 고르면 위치 id·경로가 응답에 나온다(WP-1654). */
  @Test
  void updateLocation_savesAndDescribes() {
    long spaceId = writer.ensureProjectSpace(project.id()).orElseThrow();
    long minutes = writer.createPage(ownerId, spaceId, null, "회의록").id();
    long weekly = writer.createPage(ownerId, spaceId, minutes, "주간 보고").id();
    ProjectReportSettingsResponse r = service.updateLocation(ownerId, project.key(), weekly);
    assertThat(r.reportLocationPageId()).isEqualTo(weekly);
    assertThat(r.reportLocationPath()).containsExactly("회의록", "주간 보고");
    assertThat(service.get(ownerId, project.key()).reportLocationPageId()).isEqualTo(weekly);
  }

  /** 거절 — 다른 공간·「템플릿」 루트와 하위·템플릿 페이지 하위·AI 리포트·없는 id 는 400, MEMBER 403, 개인 400(WP-1654). */
  @Test
  void updateLocation_rejects() {
    ProjectReportSettingsResponse on = service.update(ownerId, project.key(), enable());
    long spaceId = on.noteSpaceId();
    long underRoot = writer.createPage(ownerId, spaceId, on.templateRootPageId(), "안").id();
    long underTemplate = writer.createPage(ownerId, spaceId, on.templatePageId(), "템플릿 아래").id();
    long aiReport = writer.createPage(ownerId, spaceId, null, "AI 리포트").id();
    writer.markAiReport(aiReport, OffsetDateTime.now());
    long otherSpace = writer.ensureProjectSpace(project(ownerId, "TEAM").id()).orElseThrow();
    long outside = writer.createPage(ownerId, otherSpace, null, "밖").id();

    for (long bad :
        new long[] {
          outside, on.templateRootPageId(), underRoot, underTemplate, aiReport, Long.MAX_VALUE
        }) {
      assertThatThrownBy(() -> service.updateLocation(ownerId, project.key(), bad))
          .as("page %d", bad)
          .isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(settings.find(project.id()).orElseThrow().reportLocationPageId()).isNull();

    long ok = writer.createPage(ownerId, spaceId, null, "회의록").id();
    long member = human();
    projectService.addMember(ownerId, project.key(), new AddMemberRequest(member, "MEMBER"));
    assertThatThrownBy(() -> service.updateLocation(member, project.key(), ok))
        .isInstanceOf(ProjectAccessDeniedException.class);
    ProjectResponse personal = project(ownerId, "PERSONAL");
    assertThatThrownBy(() -> service.updateLocation(ownerId, personal.key(), ok))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("개인 프로젝트는 리포트를 만들지 않아요.");
  }

  /**
   * 거절된 요청은 아무것도 바꾸지 않는다(WP-1654 리뷰) — 잘못된 요일 저장·잘못된 위치 바꾸기 모두 옛 위치 템플릿을 옮기지 않고 「다시 만들었어요」 알림도 지우지
   * 않는다.
   */
  @Test
  void rejectedWrites_haveNoSideEffects() {
    long legacy = legacyTemplate("옛 본문");
    OffsetDateTime notice = OffsetDateTime.now().minusHours(1);
    settingField("template_recreated_at", notice);

    assertThatThrownBy(
            () ->
                service.update(
                    ownerId,
                    project.key(),
                    new UpdateProjectReportSettingsRequest(true, "WEEKLY", "FUNDAY", "09:00")))
        .isInstanceOf(IllegalArgumentException.class);
    long otherSpace = writer.ensureProjectSpace(project(ownerId, "TEAM").id()).orElseThrow();
    long outside = writer.createPage(ownerId, otherSpace, null, "밖").id();
    assertThatThrownBy(() -> service.updateLocation(ownerId, project.key(), outside))
        .isInstanceOf(IllegalArgumentException.class);

    assertThat(pageService.get(ownerId, legacy).title()).isEqualTo("템플릿 · 주간 리포트");
    assertThat(settings.find(project.id()).orElseThrow().templateRecreatedAt()).isNotNull();
  }

  /** 고른 위치 페이지를 지우면 GET 이 「리포트」로 되돌아간다(WP-1654). */
  @Test
  void get_locationDeleted_fallsBackToReports() {
    long spaceId = writer.ensureProjectSpace(project.id()).orElseThrow();
    long minutes = writer.createPage(ownerId, spaceId, null, "회의록").id();
    service.updateLocation(ownerId, project.key(), minutes);
    pageService.delete(ownerId, minutes);
    ProjectReportSettingsResponse r = service.get(ownerId, project.key());
    assertThat(r.reportLocationPageId()).isEqualTo(writer.findReportsPage(spaceId).orElseThrow());
    assertThat(r.reportLocationPath()).containsExactly("리포트");
  }

  /** 되돌리기는 「다시 만들었어요」 알림을 지우고, 없어진 템플릿을 새로 만들어도 알리지 않는다(사람이 누른 것, WP-1654). */
  @Test
  void reset_clearsRecreatedNotice_andDoesNotNotify() {
    long first = service.update(ownerId, project.key(), enable()).templatePageId();
    pageService.delete(ownerId, first);
    assertThat(service.update(ownerId, project.key(), enable()).templateRecreatedAt()).isNotNull();
    ProjectReportSettingsResponse r = service.resetTemplate(ownerId, project.key());
    assertThat(r.templateRecreatedAt()).isNull();

    pageService.delete(ownerId, r.templatePageId());
    ProjectReportSettingsResponse again = service.resetTemplate(ownerId, project.key());
    assertThat(again.templatePageId()).isNotNull();
    assertThat(again.templateRecreatedAt()).isNull();
  }

  /**
   * 옛 구조를 만든다 — 「리포트」 바로 아래 「템플릿 · 주간 리포트」(사람이 고친 본문)를 설정 행에 적고 template_initialized=false(V296 전
   * 행과 같다).
   */
  private long legacyTemplate(String body) {
    return legacyTemplate(project, body);
  }

  private long legacyTemplate(ProjectResponse project, String body) {
    ReportsHome home = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
    WikiPageDetail page =
        writer.createPage(ownerId, home.spaceId(), home.reportsPageId(), "템플릿 · 주간 리포트");
    writer.writeBody(ownerId, page.id(), page.version(), body, false, false);
    writer.moveTo(page.id(), home.reportsPageId(), 0);
    settings.setTemplate(project.id(), page.id(), false);
    dsl.update(table(name("project_report_setting")))
        .set(field(name("template_initialized"), Boolean.class), false)
        .where(field(name("project_id"), Long.class).eq(project.id()))
        .execute();
    return page.id();
  }

  /** 공간 맨 위 페이지 id(화면 순서). */
  private List<Long> rootIds(long spaceId) {
    return dsl.select(WIKI_PAGE.ID)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.SPACE_ID.eq(spaceId))
        .and(WIKI_PAGE.PARENT_ID.isNull())
        .orderBy(WIKI_PAGE.POSITION, WIKI_PAGE.ID)
        .fetch(WIKI_PAGE.ID);
  }

  private static UpdateProjectReportSettingsRequest enable() {
    return new UpdateProjectReportSettingsRequest(true, "WEEKLY", "MONDAY", "09:00");
  }

  private ProjectResponse project(long owner, String type) {
    String key = uniqueProjectKey("RP");
    return projectService.create(
        owner,
        new CreateProjectRequest("PERSONAL".equals(type) ? null : key, "리포트-" + key, null, type));
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }
}

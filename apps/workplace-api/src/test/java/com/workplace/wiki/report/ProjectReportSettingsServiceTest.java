package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.WIKI_REVISION;
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
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.dto.ProjectReportSettingsResponse;
import com.workplace.wiki.report.dto.UpdateProjectReportSettingsRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.OffsetDateTime;
import java.util.UUID;
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

  /** 켜면 「리포트」 아래 맨 위에 「템플릿 · 주간 리포트」를 기본 글(지시 상자·표 포함, 자리표시 치환)로 복사한다. */
  @Test
  void enable_copiesTemplateUnderReports() {
    ProjectReportSettingsResponse r = service.update(ownerId, project.key(), enable());
    assertThat(r.enabled()).isTrue();
    assertThat(r.templatePageId()).isNotNull();
    WikiPageDetail template = pageService.get(ownerId, r.templatePageId());
    assertThat(template.title()).isEqualTo("템플릿 · 주간 리포트");
    WikiPageDetail parent = pageService.get(ownerId, template.parentId());
    assertThat(parent.title()).isEqualTo("리포트");
    assertThat(parent.parentId()).isNull();
    assertThat(template.body())
        .contains("wp-ai-instruction")
        .contains("| 지난 리포트 이후 |")
        .contains("/projects/" + project.key() + "/issues/1299")
        .doesNotContain("{{");
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

  /** 사람이 템플릿을 지웠으면 다시 켤 때 새로 복사한다. */
  @Test
  void enable_recopies_whenTemplateDeleted() {
    long first = service.update(ownerId, project.key(), enable()).templatePageId();
    pageService.delete(ownerId, first);
    long second = service.update(ownerId, project.key(), enable()).templatePageId();
    assertThat(second).isNotEqualTo(first);
    assertThat(pageService.get(ownerId, second).title()).isEqualTo("템플릿 · 주간 리포트");
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
    assertThat(template.title()).isEqualTo("템플릿 · 주간 리포트");
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

  private static UpdateProjectReportSettingsRequest enable() {
    return new UpdateProjectReportSettingsRequest(true, "WEEKLY", "MONDAY", "09:00");
  }

  private ProjectResponse project(long owner, String type) {
    String key =
        "RP" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
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

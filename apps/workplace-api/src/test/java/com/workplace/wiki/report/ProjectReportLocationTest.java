package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.report.ProjectReportLocation.Description;
import com.workplace.wiki.report.ProjectReportLocation.Resolved;
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
 * 리포트 저장 위치 해석기(WP-1654) — 생성용 해석(고른 위치·무효면 「리포트」로 되돌리고 설정을 지움·유효하면 「리포트」를 만들지 않음), 읽기 전용 설명, 설정 저장
 * 검증(다른 공간·「템플릿」 갈래·템플릿 페이지 갈래·AI 리포트 페이지 거절).
 */
@Transactional
class ProjectReportLocationTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired WikiPageService pageService;
  @Autowired WikiSystemPageWriter writer;
  @Autowired ProjectReportSettingRepository settings;
  @Autowired ProjectReportLocation location;
  @Autowired ProjectRepository projects;

  private long ownerId;
  private ProjectResponse project;
  private ProjectRow row;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(ownerId);
    project = project();
    row = projects.findByKey(project.key()).orElseThrow();
    spaceId = writer.ensureProjectSpace(project.id()).orElseThrow();
  }

  /** 고른 위치가 없으면 「리포트」(없으면 만든다). 설명도 「리포트」. */
  @Test
  void resolve_default_isReports() {
    Resolved r = location.resolveForWrite(row, ownerId);
    long reports = writer.findReportsPage(spaceId).orElseThrow();
    assertThat(r).isEqualTo(new Resolved(spaceId, reports));
    Description d = location.describe(project.id());
    assertThat(d.locationPageId()).isEqualTo(reports);
    assertThat(d.locationPath()).containsExactly("리포트");
    assertThat(d.spaceId()).isEqualTo(spaceId);
  }

  /** 고른 위치가 유효하면 그 아래 — 사람이 지운 「리포트」는 되살리지 않는다. 설명은 그 경로. */
  @Test
  void resolve_chosen_doesNotRecreateReports() {
    pageService.delete(ownerId, writer.findReportsPage(spaceId).orElseThrow());
    long minutes = writer.createPage(ownerId, spaceId, null, "회의록").id();
    long weekly = writer.createPage(ownerId, spaceId, minutes, "주간 보고").id();
    settings.setLocation(project.id(), weekly);

    assertThat(location.resolveForWrite(row, ownerId)).isEqualTo(new Resolved(spaceId, weekly));
    assertThat(writer.findReportsPage(spaceId)).isEmpty();
    Description d = location.describe(project.id());
    assertThat(d.locationPageId()).isEqualTo(weekly);
    assertThat(d.locationPath()).containsExactly("회의록", "주간 보고");
  }

  /** 고른 위치가 다른 공간으로 옮겨졌으면 설명은 곧바로 「리포트」, 생성은 「리포트」로 되돌리고 설정값을 지운다. */
  @Test
  void resolve_movedToOtherSpace_fallsBackAndClears() {
    long minutes = writer.createPage(ownerId, spaceId, null, "회의록").id();
    settings.setLocation(project.id(), minutes);
    long otherSpace = writer.ensureProjectSpace(project().id()).orElseThrow();
    pageService.move(ownerId, minutes, new MovePageRequest(null, 0, otherSpace));

    assertThat(location.describe(project.id()).locationPath()).containsExactly("리포트");
    Resolved r = location.resolveForWrite(row, ownerId);
    assertThat(r.parentPageId()).isEqualTo(writer.findReportsPage(spaceId).orElseThrow());
    assertThat(settings.find(project.id()).orElseThrow().reportLocationPageId()).isNull();
  }

  /**
   * 고른 위치를 나중에 「템플릿」 아래나 템플릿 페이지 아래로 옮기면(WP-1654 리뷰) 설명·생성 모두 「리포트」로 되돌아간다. 설정값은 지우지 않아 다시 밖으로 옮기면
   * 그 위치를 다시 쓴다.
   */
  @Test
  void resolve_movedUnderTemplates_fallsBackToReports() {
    long templates = writer.ensureTemplatesPage(spaceId, ownerId);
    long template = writer.createPage(ownerId, spaceId, templates, "정기 리포트").id();
    settings.setTemplate(project.id(), template, false);
    long minutes = writer.createPage(ownerId, spaceId, null, "회의록").id();
    settings.setLocation(project.id(), minutes);
    writer.moveTo(minutes, templates, 0);

    long reports = location.resolveForWrite(row, ownerId).parentPageId();
    assertThat(reports).isEqualTo(writer.findReportsPage(spaceId).orElseThrow());
    assertThat(location.describe(project.id()).locationPath()).containsExactly("리포트");
    assertThat(location.describe(project.id()).locationPageId()).isEqualTo(reports);

    // 템플릿을 「템플릿」 밖으로 옮긴 뒤 그 아래로 옮겨도 같다.
    pageService.move(ownerId, template, new MovePageRequest(null, 0));
    writer.moveTo(minutes, template, 0);
    assertThat(location.resolveForWrite(row, ownerId).parentPageId()).isEqualTo(reports);
    assertThat(location.describe(project.id()).locationPath()).containsExactly("리포트");

    // 다시 밖으로 옮기면 고른 위치를 그대로 쓴다.
    pageService.move(ownerId, minutes, new MovePageRequest(null, 0));
    assertThat(location.resolveForWrite(row, ownerId).parentPageId()).isEqualTo(minutes);
  }

  /** 공간이 없으면(읽기 전용) 모두 비고 경로는 기본 「리포트」. 「리포트」가 지워졌어도 경로는 「리포트」(다음 생성 때 만든다). */
  @Test
  void describe_reportsMissing_pathStillReports() {
    pageService.delete(ownerId, writer.findReportsPage(spaceId).orElseThrow());
    Description d = location.describe(project.id());
    assertThat(d.locationPageId()).isNull();
    assertThat(d.locationPath()).containsExactly("리포트");
    assertThat(d.templatesRootId()).isNull();
  }

  /** 검증 — 다른 공간·없는 페이지, 「템플릿」 갈래, 템플릿 페이지 갈래, AI 리포트 페이지는 거절. 보통 페이지는 통과. */
  @Test
  void validateChoice_rejectsInvalid() {
    long otherSpace = writer.ensureProjectSpace(project().id()).orElseThrow();
    long outside = writer.createPage(ownerId, otherSpace, null, "밖").id();
    long templates = writer.ensureTemplatesPage(spaceId, ownerId);
    long underTemplates = writer.createPage(ownerId, spaceId, templates, "안").id();
    long movedTemplate = writer.createPage(ownerId, spaceId, null, "옮긴 템플릿").id();
    long underTemplate = writer.createPage(ownerId, spaceId, movedTemplate, "템플릿 아래").id();
    settings.setTemplate(project.id(), movedTemplate, false);
    long aiReport = writer.createPage(ownerId, spaceId, null, "2026년 11월 2주차 리포트").id();
    writer.markAiReport(aiReport, OffsetDateTime.now());
    long ok = writer.createPage(ownerId, spaceId, null, "회의록").id();

    String space = "프로젝트 노트 공간의 페이지만 고를 수 있어요.";
    String template = "템플릿 아래에는 리포트를 둘 수 없어요.";
    assertThatThrownBy(() -> location.validateChoice(project.id(), outside)).hasMessage(space);
    assertThatThrownBy(() -> location.validateChoice(project.id(), Long.MAX_VALUE))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage(space);
    assertThatThrownBy(() -> location.validateChoice(project.id(), templates)).hasMessage(template);
    assertThatThrownBy(() -> location.validateChoice(project.id(), underTemplates))
        .hasMessage(template);
    assertThatThrownBy(() -> location.validateChoice(project.id(), movedTemplate))
        .hasMessage(template);
    assertThatThrownBy(() -> location.validateChoice(project.id(), underTemplate))
        .hasMessage(template);
    assertThatThrownBy(() -> location.validateChoice(project.id(), aiReport))
        .hasMessage("AI 가 쓴 리포트 페이지 아래에는 둘 수 없어요.");
    location.validateChoice(project.id(), ok);
    assertThat(location.describe(project.id()).templatesRootId()).isEqualTo(templates);
  }

  private ProjectResponse project() {
    String key =
        "RL" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(ownerId, new CreateProjectRequest(key, "위치-" + key, null, "TEAM"));
  }
}

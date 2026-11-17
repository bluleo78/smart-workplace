package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 리포트 설정 저장소(WP-1654) — 저장 위치·템플릿 분리 상태 컬럼(V296). 행이 없을 때 upsert 가 기본값으로 만드는지, 조건부 위치 지우기가 다른
 * 값을 지우지 않는지, 위치 페이지를 지우면 FK 가 NULL 로 되돌리는지 본다.
 */
@Transactional
class ProjectReportSettingRepositoryTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired WikiSystemPageWriter writer;
  @Autowired WikiPageService pageService;
  @Autowired ProjectReportSettingRepository settings;

  private long ownerId;
  private long projectId;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(ownerId);
    String key =
        "RS" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    ProjectResponse p =
        projectService.create(ownerId, new CreateProjectRequest(key, "설정-" + key, null, "TEAM"));
    projectId = p.id();
    spaceId = writer.ensureReportsHome(projectId, ownerId).orElseThrow().spaceId();
  }

  /** 행이 없으면 기본값에 새 컬럼도 기본(위치 없음·미초기화·재생성 없음). */
  @Test
  void defaults_haveNoLocationAndNotInitialized() {
    SettingRow d = SettingRow.defaults(projectId);
    assertThat(d.reportLocationPageId()).isNull();
    assertThat(d.templateInitialized()).isFalse();
    assertThat(d.templateRecreatedAt()).isNull();
  }

  /** 위치 저장은 행이 없어도 기본값 행을 만들고(꺼짐·매주) 위치만 적는다. */
  @Test
  void setLocation_upsertsWithDefaults() {
    long page = page("회의록");
    settings.setLocation(projectId, page);
    SettingRow row = settings.find(projectId).orElseThrow();
    assertThat(row.reportLocationPageId()).isEqualTo(page);
    assertThat(row.enabled()).isFalse();
    assertThat(row.templateInitialized()).isFalse();
  }

  /** 초기화 표시도 행이 없으면 만들어 true. */
  @Test
  void markTemplateInitialized_upserts() {
    settings.markTemplateInitialized(projectId);
    assertThat(settings.find(projectId).orElseThrow().templateInitialized()).isTrue();
  }

  /** 템플릿 적기 — initialized=true, recreated 면 시각을 남기고, 지우기로 비운다. 아니면 시각은 그대로. */
  @Test
  void setTemplate_recordsInitializedAndRecreated() {
    long t1 = page("템플릿1");
    settings.setTemplate(projectId, t1, false);
    SettingRow first = settings.find(projectId).orElseThrow();
    assertThat(first.templatePageId()).isEqualTo(t1);
    assertThat(first.templateInitialized()).isTrue();
    assertThat(first.templateRecreatedAt()).isNull();

    long t2 = page("템플릿2");
    settings.setTemplate(projectId, t2, true);
    assertThat(settings.find(projectId).orElseThrow().templateRecreatedAt()).isNotNull();

    long t3 = page("템플릿3");
    settings.setTemplate(projectId, t3, false);
    // recreated=false 는 이전 알림 시각을 지우지 않는다(지우기는 clearTemplateRecreated 만).
    assertThat(settings.find(projectId).orElseThrow().templateRecreatedAt()).isNotNull();

    settings.clearTemplateRecreated(projectId);
    assertThat(settings.find(projectId).orElseThrow().templateRecreatedAt()).isNull();
  }

  /** 조건부 지우기 — 지금 값이 기대값과 다르면(그새 새로 골랐으면) 지우지 않는다. 같으면 지운다. */
  @Test
  void clearLocationIf_onlyWhenMatches() {
    long a = page("A");
    long b = page("B");
    settings.setLocation(projectId, b);
    settings.clearLocationIf(projectId, a);
    assertThat(settings.find(projectId).orElseThrow().reportLocationPageId()).isEqualTo(b);
    settings.clearLocationIf(projectId, b);
    assertThat(settings.find(projectId).orElseThrow().reportLocationPageId()).isNull();
  }

  /** 위치 페이지를 지우면 FK(ON DELETE SET NULL) 가 위치를 비운다 — 기본 「리포트」로 되돌아간다. */
  @Test
  void deletingLocationPage_nullsLocation() {
    long page = page("주간 보고");
    settings.setLocation(projectId, page);
    pageService.delete(ownerId, page);
    assertThat(settings.find(projectId).orElseThrow().reportLocationPageId()).isNull();
  }

  private long page(String title) {
    return writer.createPage(ownerId, spaceId, null, title).id();
  }
}

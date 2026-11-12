package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.service.WikiSystemPageWriter.ReportsHome;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버가 쓰는 페이지의 좁은 입구(WP-1483) — 공간 역할 없이 만들기·본문 쓰기·자리 옮기기·「AI 작성」 표지, 「리포트」 찾기/다시 만들기.
 *
 * <p>테스트 프로필은 동기화 서버가 꺼져 있어 본문 쓰기는 위임하지 않는 낙관적 저장 경로를 탄다.
 */
@Transactional
class WikiSystemPageWriterTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired WikiPageService pageService;
  @Autowired WikiSystemPageWriter writer;

  private long ownerId;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    String key =
        "SW" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    project =
        projectService.create(ownerId, new CreateProjectRequest(key, "쓰기-" + key, null, "TEAM"));
  }

  /** 공간 멤버가 아닌 사람을 작성자로도 페이지를 만든다(실행기에는 사용자 세션이 없다). */
  @Test
  void createPage_withoutSpaceRole_succeeds() {
    long stranger = human();
    ReportsHome home = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
    WikiPageDetail page =
        writer.createPage(stranger, home.spaceId(), home.reportsPageId(), "시스템 페이지");
    assertThat(page.parentId()).isEqualTo(home.reportsPageId());
    assertThat(page.title()).isEqualTo("시스템 페이지");
    assertThat(writer.existsUnder(page.id(), home.reportsPageId())).isTrue();
  }

  /** 본문 쓰기 — 저장한 마크다운을 그대로 읽는다. */
  @Test
  void writeBody_persistsMarkdown() {
    ReportsHome home = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
    WikiPageDetail page = writer.createPage(ownerId, home.spaceId(), home.reportsPageId(), "본문");
    String md = "## 상태와 한 줄\n\n**순조로움**\n";
    writer.writeBody(ownerId, page.id(), page.version(), md, true, false);
    assertThat(writer.readBody(page.id())).contains(md);
  }

  /** 자리 옮기기 — 지정한 자리에 넣고 형제를 다시 번호 매긴다. */
  @Test
  void moveTo_putsPageAtPosition() {
    ReportsHome home = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
    long a = writer.createPage(ownerId, home.spaceId(), home.reportsPageId(), "A").id();
    long b = writer.createPage(ownerId, home.spaceId(), home.reportsPageId(), "B").id();
    long c = writer.createPage(ownerId, home.spaceId(), home.reportsPageId(), "C").id();
    writer.moveTo(c, home.reportsPageId(), 0);
    assertThat(writer.childIdsOrdered(home.reportsPageId())).containsExactly(c, a, b);
    writer.moveTo(a, home.reportsPageId(), 2);
    assertThat(writer.childIdsOrdered(home.reportsPageId())).containsExactly(c, b, a);
  }

  /** 「AI 작성」 표지 — ai_last_action='report' 와 시각을 남긴다. */
  @Test
  void markAiReport_setsActionReport() {
    ReportsHome home = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
    long id = writer.createPage(ownerId, home.spaceId(), home.reportsPageId(), "리포트 1").id();
    OffsetDateTime at = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");
    writer.markAiReport(id, at);
    WikiPageDetail detail = pageService.get(ownerId, id);
    assertThat(detail.aiLastAction()).isEqualTo("report");
    assertThat(detail.aiLastUsedAt()).isAtSameInstantAs(at);
  }

  /** 사람이 「리포트」 이름을 바꿨으면 맨 위에 새 「리포트」를 만든다. 이미 있으면 그것을 그대로 쓴다. */
  @Test
  void ensureReportsHome_recreatesRenamedReportsPage() {
    ReportsHome first = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
    assertThat(writer.ensureReportsHome(project.id(), ownerId).orElseThrow()).isEqualTo(first);
    dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.TITLE, "옛 리포트")
        .where(WIKI_PAGE.ID.eq(first.reportsPageId()))
        .execute();

    ReportsHome again = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
    assertThat(again.spaceId()).isEqualTo(first.spaceId());
    assertThat(again.reportsPageId()).isNotEqualTo(first.reportsPageId());
    WikiPageDetail page = pageService.get(ownerId, again.reportsPageId());
    assertThat(page.title()).isEqualTo("리포트");
    assertThat(page.parentId()).isNull();
    List<Long> roots =
        dsl.select(WIKI_PAGE.ID)
            .from(WIKI_PAGE)
            .where(WIKI_PAGE.SPACE_ID.eq(again.spaceId()))
            .and(WIKI_PAGE.PARENT_ID.isNull())
            .orderBy(WIKI_PAGE.POSITION, WIKI_PAGE.ID)
            .fetch(WIKI_PAGE.ID);
    assertThat(roots).first().isEqualTo(again.reportsPageId());
  }

  /** 공간이 없어졌으면(연결이 끊긴 기존 프로젝트) 공간과 「리포트」를 새로 만든다. 개인 프로젝트는 비어 있다. */
  @Test
  void ensureReportsHome_createsSpaceWhenMissing_emptyForPersonal() {
    dsl.update(WIKI_SPACE)
        .setNull(WIKI_SPACE.LINKED_PROJECT_ID)
        .where(WIKI_SPACE.LINKED_PROJECT_ID.eq(project.id()))
        .execute();
    ReportsHome home = writer.ensureReportsHome(project.id(), ownerId).orElseThrow();
    assertThat(pageService.get(ownerId, home.reportsPageId()).title()).isEqualTo("리포트");

    ProjectResponse personal =
        projectService.create(ownerId, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    assertThat(writer.ensureReportsHome(personal.id(), ownerId)).isEmpty();
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }
}

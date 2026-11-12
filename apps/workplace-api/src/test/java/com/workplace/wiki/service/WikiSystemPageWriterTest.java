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
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import com.workplace.wiki.service.WikiSystemPageWriter.ReportsHome;
import java.time.OffsetDateTime;
import java.util.ArrayList;
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

  /** 개인 「보고」 자리 — PERSONAL 공간(owner=본인)과 루트 첫 자리 「보고」. 두 번 불러도 같다. */
  @Test
  void ensurePersonalReportsHome_createsPersonalSpaceAndReports() {
    PersonalReportsHome home = writer.ensurePersonalReportsHome(ownerId);
    assertThat(writer.ensurePersonalReportsHome(ownerId)).isEqualTo(home);
    var space = dsl.selectFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(home.spaceId())).fetchOne();
    assertThat(space.getType()).isEqualTo("PERSONAL");
    assertThat(space.getOwnerId()).isEqualTo(ownerId);
    assertThat(rootIds(home.spaceId())).first().isEqualTo(home.reportsPageId());
    assertThat(pageService.get(ownerId, home.reportsPageId()).title()).isEqualTo("보고");
  }

  /** 「보고」 이름을 바꾸면 맨 위에 새 「보고」를 만든다. */
  @Test
  void ensurePersonalReportsHome_recreatesRenamedReports() {
    PersonalReportsHome first = writer.ensurePersonalReportsHome(ownerId);
    dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.TITLE, "옛 보고")
        .where(WIKI_PAGE.ID.eq(first.reportsPageId()))
        .execute();

    PersonalReportsHome again = writer.ensurePersonalReportsHome(ownerId);
    assertThat(again.spaceId()).isEqualTo(first.spaceId());
    assertThat(again.reportsPageId()).isNotEqualTo(first.reportsPageId());
    assertThat(rootIds(again.spaceId())).first().isEqualTo(again.reportsPageId());
  }

  /** 팀 공간(프로젝트 공간)의 OWNER 여도 「보고」 자리는 본인의 PERSONAL 공간이다. */
  @Test
  void ensurePersonalReportsHome_teamSpaceMemberStillPersonal() {
    // seed() 의 프로젝트 공간 소유자가 ownerId 다.
    long teamSpace = writer.ensureReportsHome(project.id(), ownerId).orElseThrow().spaceId();
    PersonalReportsHome home = writer.ensurePersonalReportsHome(ownerId);
    assertThat(home.spaceId()).isNotEqualTo(teamSpace);
    assertThat(
            dsl.select(WIKI_SPACE.TYPE)
                .from(WIKI_SPACE)
                .where(WIKI_SPACE.ID.eq(home.spaceId()))
                .fetchOne(WIKI_SPACE.TYPE))
        .isEqualTo("PERSONAL");
  }

  /** 월 폴더 — 같은 제목은 하나, 지워졌으면 다시 만들고, 지정한 자리에 둔다. */
  @Test
  void ensureChildFolder_recreatesDeletedFolder() {
    PersonalReportsHome home = writer.ensurePersonalReportsHome(ownerId);
    long a =
        writer.ensureChildFolder(
            home.spaceId(), home.reportsPageId(), "2026년 11월", ownerId, s -> 0);
    assertThat(
            writer.ensureChildFolder(
                home.spaceId(), home.reportsPageId(), "2026년 11월", ownerId, s -> 0))
        .isEqualTo(a);
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(a)).execute();

    long b =
        writer.ensureChildFolder(
            home.spaceId(), home.reportsPageId(), "2026년 11월", ownerId, s -> 0);
    assertThat(b).isNotEqualTo(a);
    assertThat(writer.existsUnder(b, home.reportsPageId())).isTrue();
    assertThat(writer.readBody(b)).hasValue("");
  }

  /** 자리 함수 — 잠근 뒤 읽은 기존 형제 제목(화면 순서)을 받아 그 자리에 둔다. 이미 있으면 부르지 않는다. */
  @Test
  void ensureChildFolder_positionFromSiblingTitles() {
    PersonalReportsHome home = writer.ensurePersonalReportsHome(ownerId);
    long nov =
        writer.ensureChildFolder(
            home.spaceId(), home.reportsPageId(), "2026년 11월", ownerId, s -> 0);
    List<List<String>> seen = new ArrayList<>();
    long dec =
        writer.ensureChildFolder(
            home.spaceId(),
            home.reportsPageId(),
            "2026년 12월",
            ownerId,
            siblings -> {
              seen.add(siblings);
              return 0;
            });
    assertThat(seen).containsExactly(List.of("2026년 11월"));
    assertThat(writer.childIdsOrdered(home.reportsPageId())).containsExactly(dec, nov);

    writer.ensureChildFolder(
        home.spaceId(),
        home.reportsPageId(),
        "2026년 12월",
        ownerId,
        siblings -> {
          throw new AssertionError("이미 있으면 자리를 계산하지 않는다");
        });
  }

  /** 읽기 전용 — 없으면 empty(아무것도 만들지 않는다), 만든 뒤에는 같은 id. */
  @Test
  void findPersonalReportsHome_emptyUntilEnsured() {
    assertThat(writer.findPersonalReportsHome(ownerId)).isEmpty();
    assertThat(
            dsl.fetchCount(
                WIKI_SPACE, WIKI_SPACE.TYPE.eq("PERSONAL").and(WIKI_SPACE.OWNER_ID.eq(ownerId))))
        .isZero();
    PersonalReportsHome home = writer.ensurePersonalReportsHome(ownerId);
    assertThat(writer.findPersonalReportsHome(ownerId)).hasValue(home);
  }

  private List<Long> rootIds(long spaceId) {
    return dsl.select(WIKI_PAGE.ID)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.SPACE_ID.eq(spaceId))
        .and(WIKI_PAGE.PARENT_ID.isNull())
        .orderBy(WIKI_PAGE.POSITION, WIKI_PAGE.ID)
        .fetch(WIKI_PAGE.ID);
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }
}

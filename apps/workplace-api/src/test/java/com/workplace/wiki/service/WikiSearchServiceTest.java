package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.WikiSearchResult;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 위키 검색(읽기 그라운딩, S2) 통합 테스트. 멤버십 스코핑 회귀 가드 포함. */
@Transactional
class WikiSearchServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WikiPageService pageService;
  @Autowired WikiSpaceService spaceService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "wp_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Wp" + s)
        .set(USER.EMAIL, "wp_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void search_matchesTitleAndBody_withinOwnSpace() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    var alpha = pageService.create(u, sp.id(), new CreatePageRequest(null, "릴리스 노트"));
    pageService.save(
        u,
        alpha.id(),
        new com.workplace.wiki.dto.SavePageRequest(
            "릴리스 노트", "배포 절차는 다음과 같다", alpha.version(), false));
    pageService.create(u, sp.id(), new CreatePageRequest(null, "회의록"));

    // 제목 매칭
    List<WikiSearchResult> byTitle = pageService.search(u, "릴리스", null);
    assertThat(byTitle).extracting(WikiSearchResult::title).contains("릴리스 노트");

    // 본문 매칭
    List<WikiSearchResult> byBody = pageService.search(u, "배포 절차", null);
    assertThat(byBody).extracting(WikiSearchResult::title).contains("릴리스 노트");

    // 무관 질의는 비매칭
    assertThat(pageService.search(u, "존재하지않는단어zzz", null)).isEmpty();
  }

  @Test
  void search_blankQuery_returnsEmpty() {
    long u = seedUser();
    spaceService.ensurePersonalSpace(u);
    assertThat(pageService.search(u, "   ", null)).isEmpty();
    assertThat(pageService.search(u, "", null)).isEmpty();
  }

  @Test
  void search_doesNotLeakOtherUsersPersonalSpace() {
    long owner = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(owner);
    pageService.create(owner, sp.id(), new CreatePageRequest(null, "비밀 메모"));

    long stranger = seedUser();
    spaceService.ensurePersonalSpace(stranger);
    // 타인은 멤버가 아니므로 결과 0건
    assertThat(pageService.search(stranger, "비밀", null)).isEmpty();
  }

  @Test
  void search_likeWildcardsAreEscaped() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    pageService.create(u, sp.id(), new CreatePageRequest(null, "100% 완료"));
    // '%' 가 와일드카드가 아니라 리터럴로 매칭되어야 한다
    assertThat(pageService.search(u, "100%", null))
        .extracting(WikiSearchResult::title)
        .contains("100% 완료");
    // 와일드카드 미주입: '%z%' 가 리터럴 'z' 를 포함하지 않으면 비매칭
    assertThat(pageService.search(u, "%zzz%", null)).isEmpty();
  }

  @Test
  void search_withSpaceId_enforcesViewerRole() {
    long owner = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(owner);
    pageService.create(owner, sp.id(), new CreatePageRequest(null, "비밀 메모"));

    long stranger = seedUser();
    spaceService.ensurePersonalSpace(stranger);
    // 타인 스페이스를 명시 지정하면 멤버가 아니므로 권한 검증에서 NotFound(존재 은닉)
    assertThatThrownBy(() -> pageService.search(stranger, "비밀", sp.id()))
        .isInstanceOf(WikiSpaceNotFoundException.class);
  }

  @Test
  void search_withSpaceId_scopesResultsToThatSpace() {
    long u = seedUser();
    WikiSpaceResponse personal = spaceService.ensurePersonalSpace(u);
    WikiSpaceResponse team = spaceService.createTeamSpace(u, "팀 위키");
    // 두 스페이스 모두에 '노트' 를 포함하는 페이지 생성 — 사용자는 양쪽 멤버.
    pageService.create(u, personal.id(), new CreatePageRequest(null, "릴리스 노트"));
    pageService.create(u, team.id(), new CreatePageRequest(null, "회의 노트"));

    // spaceId 미지정이면 두 스페이스 결과가 모두 잡힌다(대조군).
    assertThat(pageService.search(u, "노트", null))
        .extracting(WikiSearchResult::spaceId)
        .contains(personal.id(), team.id());

    // 개인 스페이스로 한정하면 해당 스페이스 결과만.
    List<WikiSearchResult> scoped = pageService.search(u, "노트", personal.id());
    assertThat(scoped).isNotEmpty();
    assertThat(scoped).extracting(WikiSearchResult::spaceId).containsOnly(personal.id());
  }

  /** 본문을 저장한 페이지를 만든다. */
  private long pageWithBody(long u, long spaceId, String title, String body) {
    var p = pageService.create(u, spaceId, new CreatePageRequest(null, title));
    pageService.save(
        u, p.id(), new com.workplace.wiki.dto.SavePageRequest(title, body, p.version(), false));
    return p.id();
  }

  /** WP-1240/1242 모양이 섞인 본문 — 스타일·컨테이너·span·HTML 블록 안에 「매출 보고」만 글자다. */
  private static final String STYLED_BODY =
      "<style data-wp-style>\n.card{color:red}\n.x{}\n</style>\n\n"
          + "<div class=\"card\" style=\"padding:8px\">\n\n## 매출 보고\n\n"
          + "<span class=\"badge\">분기 실적</span>\n\n</div>\n\n"
          + "```html-embed\n<!doctype html><html><body><canvas id=\"chart\"></canvas>"
          + "<script>drawSecretChart()</script>임베드전용문구</body></html>\n```";

  /** WP-1243 — 태그 이름·클래스·CSS·HTML 블록 소스로는 찾지 않고, 본문 글자로는 찾는다. 스니펫에 태그가 없다. */
  @Test
  void search_matchesTextNotMarkup() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    pageWithBody(u, sp.id(), "월간 정리", STYLED_BODY);

    for (String markup : List.of("div", "card", "style", "span", "padding", "color:red")) {
      assertThat(pageService.search(u, markup, sp.id())).as(markup).isEmpty();
    }
    // HTML 블록 소스의 글자·스크립트는 검색되지 않는다.
    assertThat(pageService.search(u, "임베드전용문구", sp.id())).isEmpty();
    assertThat(pageService.search(u, "drawSecretChart", sp.id())).isEmpty();
    assertThat(pageService.search(u, "canvas", sp.id())).isEmpty();

    List<WikiSearchResult> hits = pageService.search(u, "매출", sp.id());
    assertThat(hits).extracting(WikiSearchResult::title).containsExactly("월간 정리");
    // span 안 글자도 글자다.
    assertThat(pageService.search(u, "분기 실적", sp.id())).hasSize(1);
    String snippet = hits.get(0).snippet();
    assertThat(snippet).isEqualTo("매출 보고 분기 실적");
    assertThat(snippet).doesNotContain("<", ">", "{", "style", "div");
  }

  /** 제목 매칭은 그대로 — 제목에 있는 낱말은 본문 평문과 무관하게 걸린다. */
  @Test
  void search_titleStillMatches_whenBodyHasMarkup() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    pageWithBody(u, sp.id(), "div 레이아웃 가이드", STYLED_BODY);
    assertThat(pageService.search(u, "div", sp.id()))
        .extracting(WikiSearchResult::title)
        .containsExactly("div 레이아웃 가이드");
  }

  /** 백필 전 행(search_text NULL) — 검색은 원문으로 찾아 빠지지 않고(예전 동작), 스니펫은 그 자리에서 평문으로 보인다. */
  @Test
  void legacyRowWithoutSearchText_fallsBackToBody_withPlainSnippet() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    long id = pageWithBody(u, sp.id(), "옛 노트", STYLED_BODY);
    // 열을 더하기 전에 저장된 행처럼 만든다.
    dsl.update(WIKI_PAGE).setNull(WIKI_PAGE.SEARCH_TEXT).where(WIKI_PAGE.ID.eq(id)).execute();

    List<WikiSearchResult> hits = pageService.search(u, "매출", sp.id());
    assertThat(hits).hasSize(1);
    assertThat(hits.get(0).snippet()).isEqualTo("매출 보고 분기 실적");
    // 원문 폴백이라 백필 전에는 태그 이름으로도 걸린다(백필은 WikiCollabSaveIntegrationTest 에서 본다 — 커밋이 필요).
    assertThat(pageService.search(u, "div", sp.id())).hasSize(1);
  }

  /** 다시 저장하면 평문도 새 본문으로 바뀐다. */
  @Test
  void save_refreshesSearchText() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    long id = pageWithBody(u, sp.id(), "갱신", "<div class=\"a\">\n\n처음 글\n\n</div>");
    var cur = pageService.get(u, id);
    pageService.save(
        u, id, new com.workplace.wiki.dto.SavePageRequest(null, "**나중 글**", cur.version(), false));
    assertThat(pageService.search(u, "처음 글", sp.id())).isEmpty();
    assertThat(pageService.search(u, "나중 글", sp.id())).hasSize(1);
  }
}

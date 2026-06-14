package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
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
}

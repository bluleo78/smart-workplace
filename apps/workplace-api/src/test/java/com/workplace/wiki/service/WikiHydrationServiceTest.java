package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiBacklink;
import com.workplace.wiki.dto.WikiMentionRef;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiSpaceResponse;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WikiHydrationService 통합 검증 — 본문 토큰 하이드레이션(가시성 필터)과 백링크 조회. 트랜잭션 롤백 + TenantContext(1L) 로 RLS
 * 컨텍스트를 구성한다(WikiPageServiceTest 패턴).
 */
@Transactional
class WikiHydrationServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiHydrationService hydration;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;

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
        .set(USER.USERNAME, "wh_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Name_" + s)
        .set(USER.EMAIL, "wh_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private String uniqueKey() {
    return "WH" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
  }

  /** resolveMentions: 유저+페이지+이슈 혼합 본문을 하이드레이션하고 비가시/비실존 대상은 제외한다. */
  @Test
  void resolveMentions_hydratesVisible_dropsInvisibleAndNonexistent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    // 가시 페이지(u 가 멤버인 개인 스페이스).
    WikiPageDetail visiblePage =
        pageService.create(u, sp.id(), new CreatePageRequest(null, "타깃페이지"));

    // 다른 유저의 개인 스페이스 페이지 → u 는 비멤버이므로 비가시.
    long other = seedUser();
    WikiSpaceResponse otherSp = spaceService.ensurePersonalSpace(other);
    WikiPageDetail invisiblePage =
        pageService.create(other, otherSp.id(), new CreatePageRequest(null, "남의페이지"));

    // u 가 멤버(OWNER)인 프로젝트의 이슈 → 가시.
    ProjectResponse proj =
        projectService.create(u, new CreateProjectRequest(uniqueKey(), "P", "x"));
    IssueRow visibleIssue = issueRepository.insert(proj.id(), 1, "이슈제목", null, "MID", null, u);

    // other 만 멤버인 프로젝트의 이슈 → u 는 비멤버이므로 비가시.
    ProjectResponse otherProj =
        projectService.create(other, new CreateProjectRequest(uniqueKey(), "Q", "x"));
    IssueRow invisibleIssue =
        issueRepository.insert(otherProj.id(), 1, "남의이슈", null, "MID", null, other);

    // 본문: 실존 유저 멘션 + 비실존 유저(999999) + 가시/비가시 페이지 + 가시/비가시 이슈.
    String body =
        "<@"
            + u
            + "> <@999999> <#page:"
            + visiblePage.id()
            + "> <#page:"
            + invisiblePage.id()
            + "> <#issue:"
            + visibleIssue.id()
            + "> <#issue:"
            + invisibleIssue.id()
            + ">";

    List<WikiMentionRef> refs = hydration.resolveMentions(u, body);

    // 유저: 실존(u)만, name 라벨.
    assertThat(refs)
        .filteredOn(r -> r.type().equals("USER"))
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.id()).isEqualTo(u);
              assertThat(r.label()).startsWith("Name_");
              assertThat(r.spaceId()).isNull();
            });
    // 비실존 유저(999999)는 드랍.
    assertThat(refs).noneMatch(r -> r.id() == 999999L);

    // 페이지: 가시 페이지만, spaceId 채움, projectKey/number null.
    assertThat(refs)
        .filteredOn(r -> r.type().equals("PAGE"))
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.id()).isEqualTo(visiblePage.id());
              assertThat(r.label()).isEqualTo("타깃페이지");
              assertThat(r.spaceId()).isEqualTo(sp.id());
              assertThat(r.projectKey()).isNull();
              assertThat(r.number()).isNull();
            });
    assertThat(refs).noneMatch(r -> r.type().equals("PAGE") && r.id() == invisiblePage.id());

    // 이슈: 가시 이슈만, projectKey/number 채움, spaceId null.
    assertThat(refs)
        .filteredOn(r -> r.type().equals("ISSUE"))
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.id()).isEqualTo(visibleIssue.id());
              assertThat(r.label()).isEqualTo("이슈제목");
              assertThat(r.projectKey()).isEqualTo(proj.key());
              assertThat(r.number()).isEqualTo(1);
              assertThat(r.spaceId()).isNull();
            });
    assertThat(refs).noneMatch(r -> r.type().equals("ISSUE") && r.id() == invisibleIssue.id());
  }

  /** resolveMentions: 동일 타입(페이지) 내부에서 본문 등장 순서를 보존한다(배치 IN 조회의 DB 순서에 의존하지 않음). */
  @Test
  void resolveMentions_preservesBodyOrderWithinType() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p1 = pageService.create(u, sp.id(), new CreatePageRequest(null, "P1"));
    WikiPageDetail p2 = pageService.create(u, sp.id(), new CreatePageRequest(null, "P2"));

    // 본문에 큰 id 를 먼저 등장시킨다 → 결과도 [먼저 등장, 나중 등장] 순이어야 한다.
    long first = Math.max(p1.id(), p2.id());
    long second = Math.min(p1.id(), p2.id());
    String body = "<#page:" + first + "> <#page:" + second + ">";

    List<WikiMentionRef> refs = hydration.resolveMentions(u, body);
    assertThat(refs)
        .filteredOn(r -> r.type().equals("PAGE"))
        .extracting(WikiMentionRef::id)
        .containsExactly(first, second);
  }

  /** resolveMentions: 빈 본문이면 빈 리스트. */
  @Test
  void resolveMentions_emptyBody_returnsEmpty() {
    long u = seedUser();
    assertThat(hydration.resolveMentions(u, "")).isEmpty();
    assertThat(hydration.resolveMentions(u, null)).isEmpty();
  }

  /** backlinks: 여러 source 페이지가 한 타깃을 가리킬 때, 호출자가 가시인 source 만 반환한다. */
  @Test
  void backlinks_returnsVisibleSourcesOnly() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail target = pageService.create(u, sp.id(), new CreatePageRequest(null, "타깃"));
    WikiPageDetail src1 = pageService.create(u, sp.id(), new CreatePageRequest(null, "소스1"));
    WikiPageDetail src2 = pageService.create(u, sp.id(), new CreatePageRequest(null, "소스2"));
    // src1, src2 본문에 타깃 참조 적재(save → wiki_reference).
    pageService.save(
        u, src1.id(), new SavePageRequest("소스1", "<#page:" + target.id() + ">", 1, false));
    pageService.save(
        u, src2.id(), new SavePageRequest("소스2", "<#page:" + target.id() + ">", 1, false));

    // 다른 유저의 페이지도 타깃을 참조 → u 입장에서 비가시 source.
    long other = seedUser();
    WikiSpaceResponse otherSp = spaceService.ensurePersonalSpace(other);
    WikiPageDetail otherSrc =
        pageService.create(other, otherSp.id(), new CreatePageRequest(null, "남의소스"));
    pageService.save(
        other, otherSrc.id(), new SavePageRequest("남의소스", "<#page:" + target.id() + ">", 1, false));

    var items = hydration.backlinks(u, target.id()).items();
    assertThat(items)
        .extracting(WikiBacklink::pageId)
        .containsExactlyInAnyOrder(src1.id(), src2.id());
    assertThat(items).noneMatch(b -> b.pageId() == otherSrc.id());
    // 메타 채움 검증(소스1 행).
    assertThat(items)
        .filteredOn(b -> b.pageId() == src1.id())
        .singleElement()
        .satisfies(
            b -> {
              assertThat(b.spaceId()).isEqualTo(sp.id());
              assertThat(b.title()).isEqualTo("소스1");
              assertThat(b.updatedAt()).isNotNull();
            });
  }
}

package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiConflictException;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class WikiPageServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;

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
  void createPage_andListTree() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail root = pageService.create(u, sp.id(), new CreatePageRequest(null, "루트"));
    pageService.create(u, sp.id(), new CreatePageRequest(root.id(), "자식"));

    List<WikiPageSummary> tree = pageService.listTree(u, sp.id());
    assertThat(tree).hasSize(2);
    assertThat(tree).anyMatch(p -> p.parentId() != null && p.parentId().equals(root.id()));
  }

  @Test
  void save_bumpsVersion() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(null, "제목"));
    assertThat(p.version()).isEqualTo(1);

    WikiPageDetail saved =
        pageService.save(u, p.id(), new SavePageRequest("제목", "# 본문", 1, false));
    assertThat(saved.version()).isEqualTo(2);
    assertThat(saved.body()).isEqualTo("# 본문");
  }

  @Test
  void save_staleVersion_throwsConflict() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(null, "제목"));
    pageService.save(u, p.id(), new SavePageRequest("제목", "v2", 1, false));

    assertThatThrownBy(() -> pageService.save(u, p.id(), new SavePageRequest("제목", "stale", 1, false)))
        .isInstanceOf(WikiConflictException.class);
  }

  @Test
  void save_withSnapshot_writesRevisionOfPriorVersion() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(null, "제목"));

    pageService.save(u, p.id(), new SavePageRequest("제목", "새 본문", 1, true));

    int revCount =
        dsl.fetchCount(dsl.selectFrom(WIKI_REVISION).where(WIKI_REVISION.PAGE_ID.eq(p.id())));
    assertThat(revCount).isEqualTo(1);
  }
}

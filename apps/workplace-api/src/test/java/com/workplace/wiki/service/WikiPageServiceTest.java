package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiConflictException;
import com.workplace.wiki.repository.WikiReferenceRepository;
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
  @Autowired WikiReferenceRepository references;

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

    WikiPageDetail saved = pageService.save(u, p.id(), new SavePageRequest("제목", "# 본문", 1, false));
    assertThat(saved.version()).isEqualTo(2);
    assertThat(saved.body()).isEqualTo("# 본문");
  }

  @Test
  void save_staleVersion_throwsConflict() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(null, "제목"));
    pageService.save(u, p.id(), new SavePageRequest("제목", "v2", 1, false));

    assertThatThrownBy(
            () -> pageService.save(u, p.id(), new SavePageRequest("제목", "stale", 1, false)))
        .isInstanceOf(WikiConflictException.class);
  }

  @Test
  void move_reordersSiblings_withoutTies() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    // 루트 페이지 A, B, C 를 순서대로 생성 → position 0,1,2.
    WikiPageDetail a = pageService.create(u, sp.id(), new CreatePageRequest(null, "A"));
    WikiPageDetail b = pageService.create(u, sp.id(), new CreatePageRequest(null, "B"));
    WikiPageDetail c = pageService.create(u, sp.id(), new CreatePageRequest(null, "C"));

    // C 를 맨 앞(position 0)으로 이동 → 형제 재배열 기대 순서 [C, A, B].
    pageService.move(u, c.id(), new MovePageRequest(null, 0));

    List<Long> rootOrder =
        pageService.listTree(u, sp.id()).stream()
            .filter(p -> p.parentId() == null)
            .map(WikiPageSummary::id)
            .toList();
    // 타이가 없어야 순서가 [C, A, B] 로 결정적. 나이브 구현은 position 0 에 타이가 생겨 실패.
    assertThat(rootOrder).containsExactly(c.id(), a.id(), b.id());

    // A 를 맨 뒤(position 2)로 이동 → [C, B, A] 로 결정적 재배열되어야 한다.
    pageService.move(u, a.id(), new MovePageRequest(null, 2));
    List<Long> after =
        pageService.listTree(u, sp.id()).stream()
            .filter(p -> p.parentId() == null)
            .map(WikiPageSummary::id)
            .toList();
    assertThat(after).containsExactly(c.id(), b.id(), a.id());
  }

  @Test
  void save_extractsPageAndIssueReferences_ignoresUserMention() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(null, "제목"));

    // 본문에 page/issue 토큰 + 유저 멘션 혼합 — page/issue 만 백링크로 적재되어야 한다.
    pageService.save(
        u, p.id(), new SavePageRequest("제목", "# 본문 <#page:9> <#issue:7> <@5>", 1, false));

    // page:9 를 가리키는 백링크 source 에 우리 페이지가 있어야 한다.
    assertThat(references.findBacklinkSourcePageIds("PAGE", 9L)).contains(p.id());
    assertThat(references.findBacklinkSourcePageIds("ISSUE", 7L)).contains(p.id());
    // 유저 멘션(<@5>)은 PAGE/ISSUE 어느 타입으로도 적재되지 않는다.
    assertThat(references.findBacklinkSourcePageIds("PAGE", 5L)).doesNotContain(p.id());
    assertThat(references.findBacklinkSourcePageIds("ISSUE", 5L)).doesNotContain(p.id());
  }

  @Test
  void save_replacesReferences_onResave() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(null, "제목"));

    // 1차 저장: page:9 참조.
    pageService.save(u, p.id(), new SavePageRequest("제목", "<#page:9>", 1, false));
    assertThat(references.findBacklinkSourcePageIds("PAGE", 9L)).contains(p.id());

    // 2차 저장(version bump): issue:7 만 참조 → page:9 백링크는 제거(diff-replace)되어야 한다.
    pageService.save(u, p.id(), new SavePageRequest("제목", "<#issue:7>", 2, false));
    assertThat(references.findBacklinkSourcePageIds("PAGE", 9L)).doesNotContain(p.id());
    assertThat(references.findBacklinkSourcePageIds("ISSUE", 7L)).contains(p.id());
  }

  @Test
  void save_withNullBody_preservesBodyAndReferences() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(null, "제목"));

    // 1차 저장: 본문 + page:9 참조 적재.
    WikiPageDetail saved =
        pageService.save(u, p.id(), new SavePageRequest("제목", "# 본문 <#page:9>", 1, false));
    assertThat(references.findBacklinkSourcePageIds("PAGE", 9L)).contains(p.id());

    // 2차 저장: body=null(title 만 변경) → 기존 본문·백링크가 보존되어야 한다(소실 X).
    WikiPageDetail after =
        pageService.save(u, p.id(), new SavePageRequest("새 제목", null, saved.version(), false));
    assertThat(after.body()).isEqualTo("# 본문 <#page:9>");
    assertThat(after.title()).isEqualTo("새 제목");
    assertThat(references.findBacklinkSourcePageIds("PAGE", 9L)).contains(p.id());
  }

  /**
   * #736: recordAiUsage 는 ai_last_used_at/ai_last_action 만 갱신하고 version/updated_at/updated_by 는 그대로
   * 둬야 한다 — version 을 올리면 뒤이은 자동저장이 낡은 version 으로 충돌 처리되는 회귀가 생긴다(§3).
   */
  @Test
  void recordAiUsage_updatesOnlyAiColumns_leavesVersionAndUpdatedAtUntouched() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(null, "제목"));
    assertThat(p.aiLastUsedAt()).isNull();

    pageService.recordAiUsage(p.id(), WikiAiAction.DRAFT);

    WikiPageDetail after = pageService.get(u, p.id());
    assertThat(after.version()).isEqualTo(p.version());
    assertThat(after.updatedAt()).isEqualTo(p.updatedAt());
    assertThat(after.updatedBy()).isEqualTo(p.updatedBy());
    assertThat(after.aiLastUsedAt()).isNotNull();
    assertThat(after.aiLastAction()).isEqualTo("draft");

    // attribution 기록 후에도 원래 version 으로 정상 저장(자동저장 회귀 없음)돼야 한다.
    WikiPageDetail saved =
        pageService.save(u, p.id(), new SavePageRequest("제목", "AI 이후 편집", p.version(), false));
    assertThat(saved.version()).isEqualTo(p.version() + 1);
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

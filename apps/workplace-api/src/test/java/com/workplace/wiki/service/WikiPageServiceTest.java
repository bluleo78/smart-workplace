package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
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
import com.workplace.wiki.exception.WikiInvalidMoveException;
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

  /**
   * #758 가드가 "모두 거부" 로 퇴화하지 않는지 고정하는 양성 케이스. 아래 거부 테스트 3종은 전부 음성이라, 가드를 무조건 throw 로 바꿔도 셋 다 통과한다 —
   * 정상 재부모화가 실제로 성공하는지 단언해야 이빨이 생긴다(루트로 이동(parentId=null)은 {@link
   * #move_reordersSiblings_withoutTies} 가 커버).
   */
  @Test
  void move_reparentsUnderValidParent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail a = pageService.create(u, sp.id(), new CreatePageRequest(null, "A"));
    WikiPageDetail b = pageService.create(u, sp.id(), new CreatePageRequest(null, "B"));

    // 루트 형제였던 B 를 A 의 자식으로 이동 — 정상 경로라 통과해야 한다.
    pageService.move(u, b.id(), new MovePageRequest(a.id(), 0));

    assertThat(pageService.listTree(u, sp.id()))
        .filteredOn(p -> p.id() == b.id())
        .singleElement()
        .satisfies(p -> assertThat(p.parentId()).isEqualTo(a.id()));
  }

  @Test
  void move_rejectsSelfAsParent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail a = pageService.create(u, sp.id(), new CreatePageRequest(null, "A"));

    assertThatThrownBy(() -> pageService.move(u, a.id(), new MovePageRequest(a.id(), 0)))
        .isInstanceOf(WikiInvalidMoveException.class);
    // 거부됐으면 트리는 그대로여야 한다 — parent_id 가 이미 갱신된 뒤 던지면 사이클이 남는다.
    assertThat(pageService.listTree(u, sp.id()))
        .filteredOn(p -> p.id() == a.id())
        .singleElement()
        .satisfies(p -> assertThat(p.parentId()).isNull());
  }

  @Test
  void move_rejectsDescendantAsParent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    // 조부 → 부 → 손자 3단 체인.
    WikiPageDetail gp = pageService.create(u, sp.id(), new CreatePageRequest(null, "조부"));
    WikiPageDetail p = pageService.create(u, sp.id(), new CreatePageRequest(gp.id(), "부"));
    WikiPageDetail c = pageService.create(u, sp.id(), new CreatePageRequest(p.id(), "손자"));

    // 조부를 자기 손자 밑으로 — 직계 자식이 아니라 2단 아래라 단순 자기참조 검사로는 못 잡는다.
    assertThatThrownBy(() -> pageService.move(u, gp.id(), new MovePageRequest(c.id(), 0)))
        .isInstanceOf(WikiInvalidMoveException.class);
    assertThat(pageService.listTree(u, sp.id()))
        .filteredOn(x -> x.id() == gp.id())
        .singleElement()
        .satisfies(x -> assertThat(x.parentId()).isNull());
  }

  @Test
  void move_rejectsParentInAnotherSpace() {
    long u = seedUser();
    WikiSpaceResponse mine = spaceService.ensurePersonalSpace(u);
    WikiSpaceResponse team = spaceService.createTeamSpace(u, "팀 " + UUID.randomUUID());
    WikiPageDetail a = pageService.create(u, mine.id(), new CreatePageRequest(null, "내 페이지"));
    WikiPageDetail other = pageService.create(u, team.id(), new CreatePageRequest(null, "팀 페이지"));

    // 두 공간 모두에 EDITOR 인 사용자라도 space_id 가 어긋나는 부모 지정은 거부돼야 한다.
    assertThatThrownBy(() -> pageService.move(u, a.id(), new MovePageRequest(other.id(), 0)))
        .isInstanceOf(WikiInvalidMoveException.class);
    assertThat(pageService.listTree(u, mine.id()))
        .filteredOn(p -> p.id() == a.id())
        .singleElement()
        .satisfies(p -> assertThat(p.parentId()).isNull());
  }

  @Test
  void move_rejectsNonexistentParent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail a = pageService.create(u, sp.id(), new CreatePageRequest(null, "A"));

    // 존재하지 않는(또는 RLS 로 보이지 않는) 부모는 404 가 아니라 400 이어야 한다 — 404/400 이 갈리면
    // 이 엔드포인트가 "볼 수 없는 공간에 그 id 의 페이지가 있는가" 를 알려주는 존재 오라클이 된다.
    assertThatThrownBy(() -> pageService.move(u, a.id(), new MovePageRequest(9_999_999L, 0)))
        .isInstanceOf(WikiInvalidMoveException.class);
  }

  /**
   * #758 {@code ancestorIdsInclusive} 의 재귀항이 UNION 이어야 한다는 것을 고정한다. 가드가 생기기 전에 만들어진 사이클 데이터가 남아 있으면
   * UNION ALL 은 working table 이 비지 않아 쿼리가 끝나지 않는다(이 배포엔 statement_timeout 이 없다). 정상 트리만 쓰는 다른 테스트는
   * 이 변이를 전부 통과시킨다.
   */
  @Test
  @org.junit.jupiter.api.Timeout(30)
  void move_terminatesEvenWhenExistingCycleData() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail x = pageService.create(u, sp.id(), new CreatePageRequest(null, "X"));
    WikiPageDetail y = pageService.create(u, sp.id(), new CreatePageRequest(x.id(), "Y"));
    WikiPageDetail victim = pageService.create(u, sp.id(), new CreatePageRequest(null, "이동 대상"));
    // 서비스를 우회해 X↔Y 사이클을 직접 심는다(가드 도입 이전 데이터 재현).
    dsl.update(WIKI_PAGE).set(WIKI_PAGE.PARENT_ID, y.id()).where(WIKI_PAGE.ID.eq(x.id())).execute();

    // 이 트랜잭션에만 statement_timeout 을 걸어 "끝나지 않음" 을 "예외 타입이 다름" 으로 바꾼다.
    // assertTimeoutPreemptively 는 별도 스레드에서 실행돼 트랜잭션·테넌트 GUC 를 잃어버리므로 쓸 수 없다.
    dsl.execute("SET LOCAL statement_timeout = '5s'");

    // 사이클에 속한 X 를 부모로 지정한다. victim 은 그 사이클 밖이라 이동 자체는 적법 — 관심사는 "가드가 끝나는가" 뿐이다.
    // UNION ALL 이면 조상 체인이 무한히 재생산돼 여기서 statement_timeout 예외가 난다.
    assertThatCode(() -> pageService.move(u, victim.id(), new MovePageRequest(x.id(), 0)))
        .doesNotThrowAnyException();
  }

  @Test
  void create_rejectsParentInAnotherSpace() {
    long u = seedUser();
    WikiSpaceResponse mine = spaceService.ensurePersonalSpace(u);
    WikiSpaceResponse team = spaceService.createTeamSpace(u, "팀 " + UUID.randomUUID());
    WikiPageDetail other = pageService.create(u, team.id(), new CreatePageRequest(null, "팀 페이지"));

    // 이동만 막으면 같은 불일치를 생성으로 만들 수 있다. parent_id 는 ON DELETE CASCADE 라, 나중에 팀 공간에서
    // 그 부모를 지우는 사람이 내 공간의 페이지·리비전·첨부를 권한 검사 없이 함께 파괴한다.
    assertThatThrownBy(
            () -> pageService.create(u, mine.id(), new CreatePageRequest(other.id(), "내 페이지")))
        .isInstanceOf(WikiInvalidMoveException.class);
  }

  @Test
  void create_rejectsNonexistentParent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);

    assertThatThrownBy(
            () -> pageService.create(u, sp.id(), new CreatePageRequest(9_999_999L, "고아")))
        .isInstanceOf(WikiInvalidMoveException.class);
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

package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.EpicChildrenResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 하위 이슈 조회의 상태 조건·페이징(WP-1684) 통합 테스트 — 열린(할 일·진행 중) 하위만 기본으로, 끝난(완료·취소) 하위는 state=closed 로 따로, 순서는
 * (created_at, id), 페이지는 커서로 이어 받는다. closedCount·hiddenCount 는 페이지와 상관없이 전체 기준이고, 읽을 수 없는 하위가 섞여도
 * 페이지마다 개수가 줄지 않는다(권한 필터를 페이지 자르기 전에 하므로). 잘못된 state·cursor 는 400.
 *
 * <p>픽스처: owner 가 TEAM 프로젝트 A·B 를 가진다. 에픽은 B 에 있다.
 */
@Transactional
class IssueChildrenPageTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService issueSearchService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired ProjectService projectService;

  private Long owner;
  private ProjectResponse a;
  private ProjectResponse b;
  private IssueResponse epicB;

  /** 테넌트 1 의 활성 구성원(USER 역할)을 만든다. */
  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private ProjectResponse newProject(String prefix) {
    return projectService.create(
        owner, new CreateProjectRequest(uniqueProjectKey(prefix), "P-" + prefix, "x", "TEAM"));
  }

  /** 생성 요청 — 유형·부모 번호·부모 키만 고른다. */
  private static CreateIssueRequest req(
      String title, Long typeId, Integer parentNumber, String parentKey) {
    return new CreateIssueRequest(
        title,
        null,
        null,
        null,
        null,
        typeId,
        parentNumber,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        parentKey);
  }

  /** 에픽 B 아래 같은 프로젝트 하위 하나. */
  private IssueResponse childInB(String title) {
    return issueService.create(owner, b.key(), req(title, null, epicB.number(), null));
  }

  /** 에픽 B 아래 다른 프로젝트(p) 하위 하나 — parentKey 로 단다. */
  private IssueResponse childIn(ProjectResponse p, String title) {
    return issueService.create(
        owner, p.key(), req(title, null, null, b.key() + "-" + epicB.number()));
  }

  private void close(ProjectResponse p, IssueResponse issue, String category) {
    issueService.updateStatus(owner, p.key(), issue.number(), category);
  }

  private EpicChildrenResponse page(Long caller, String state, String cursor, Integer size) {
    return issueSearchService.children(caller, b.key(), epicB.number(), state, cursor, size);
  }

  /** 커서를 따라 끝까지 받아 제목을 모은다 — 각 페이지 크기도 함께 돌려준다. */
  private List<List<String>> allPages(Long caller, String state, Integer size) {
    List<List<String>> pages = new ArrayList<>();
    String cursor = null;
    do {
      var res = page(caller, state, cursor, size);
      pages.add(res.items().stream().map(IssueResponse::title).toList());
      cursor = res.nextCursor();
    } while (cursor != null && pages.size() < 50);
    return pages;
  }

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = createUser("cp");
    a = newProject("CA");
    b = newProject("CB");
    long epicType = typeRepository.findByProjectAndName(b.id(), "EPIC").orElseThrow().id();
    epicB = issueService.create(owner, b.key(), req("에픽", epicType, null, null));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 열린_하위만_기본으로_오고_끝난_하위는_closed_로_따로_오며_closedCount_가_실린다() {
    List<IssueResponse> made = new ArrayList<>();
    for (int i = 0; i < 60; i++) made.add(childInB("하위 " + i));
    // 앞 54건을 끝낸다 — 53건은 완료, 1건은 취소(취소도 끝난 범주).
    for (int i = 0; i < 53; i++) close(b, made.get(i), IssueStatuses.DONE);
    close(b, made.get(53), IssueStatuses.CANCELED);

    var open = page(owner, null, null, null);
    assertThat(open.items())
        .extracting(IssueResponse::title)
        .containsExactly("하위 54", "하위 55", "하위 56", "하위 57", "하위 58", "하위 59");
    assertThat(open.closedCount()).isEqualTo(54);
    assertThat(open.hiddenCount()).isZero();
    assertThat(open.nextCursor()).isNull();
    assertThat(page(owner, "open", null, null).items()).hasSize(6);

    var closed = page(owner, "closed", null, null);
    assertThat(closed.items()).hasSize(54);
    assertThat(closed.items().get(0).title()).isEqualTo("하위 0");
    assertThat(closed.items().get(53).title()).isEqualTo("하위 53");
    assertThat(closed.closedCount()).isEqualTo(54);
    assertThat(closed.nextCursor()).isNull();
    // 진행률은 지금처럼 이슈 요약의 childCount·childDoneCount.
    var summary = issueService.get(owner, b.key(), epicB.number()).summary();
    assertThat(summary.childCount()).isEqualTo(60);
    assertThat(summary.childDoneCount()).isEqualTo(54);
  }

  @Test
  void 하위가_없으면_빈_목록과_0() {
    var res = page(owner, null, null, null);
    assertThat(res.items()).isEmpty();
    assertThat(res.closedCount()).isZero();
    assertThat(res.hiddenCount()).isZero();
    assertThat(res.nextCursor()).isNull();
  }

  @Test
  void 열린_하위가_101건이면_100건_뒤_커서로_나머지를_만든_순서대로_받는다() {
    for (int i = 0; i < 101; i++) childInB(String.format("하위 %03d", i));

    var first = page(owner, "open", null, null);
    assertThat(first.items()).hasSize(100);
    assertThat(first.items().get(0).title()).isEqualTo("하위 000");
    assertThat(first.items().get(99).title()).isEqualTo("하위 099");
    assertThat(first.nextCursor()).isNotNull();

    var second = page(owner, "open", first.nextCursor(), null);
    assertThat(second.items()).extracting(IssueResponse::title).containsExactly("하위 100");
    assertThat(second.nextCursor()).isNull();
  }

  @Test
  void 정렬은_created_at_먼저_같으면_id_순이고_커서_경계에서_빠지거나_겹치지_않는다() {
    List<IssueResponse> made = new ArrayList<>();
    for (int i = 0; i < 5; i++) made.add(childInB("하위 " + i));
    // 모두 같은 시각으로 맞추고, 마지막에 만든 「하위 4」만 더 이른 시각으로 — created_at 이 id 보다 먼저다.
    var same = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    dsl.update(ISSUE)
        .set(ISSUE.CREATED_AT, same)
        .where(ISSUE.PARENT_ISSUE_ID.eq(epicB.id()))
        .execute();
    dsl.update(ISSUE)
        .set(ISSUE.CREATED_AT, same.minusDays(1))
        .where(ISSUE.ID.eq(made.get(4).id()))
        .execute();

    var pages = allPages(owner, "open", 2);
    assertThat(pages)
        .containsExactly(List.of("하위 4", "하위 0"), List.of("하위 1", "하위 2"), List.of("하위 3"));
  }

  @Test
  void 읽을_수_없는_하위가_섞여도_counts_는_전체_기준이고_페이지마다_개수가_줄지_않는다() {
    ProjectResponse c = newProject("CC");
    Long viewer = createUser("cv");
    // viewer 는 A·B 를 읽고 C 는 못 읽는다.
    projectService.addMember(owner, a.key(), new AddMemberRequest(viewer, "MEMBER"));
    projectService.addMember(owner, b.key(), new AddMemberRequest(viewer, "MEMBER"));
    // B·C·A 를 번갈아 — 볼 수 없는 C 하위가 페이지 사이사이에 끼게 한다.
    childInB("B0");
    var c0 = childIn(c, "C0");
    childIn(a, "A0");
    childIn(c, "C1");
    childInB("B1");
    childIn(c, "C2");
    var a1 = childIn(a, "A1");
    var b2 = childInB("B2");
    close(c, c0, IssueStatuses.DONE); // 볼 수 없는 끝난 하위 — closedCount 에 넣지 않는다
    close(a, a1, IssueStatuses.DONE);
    close(b, b2, IssueStatuses.CANCELED);

    var pages = allPages(viewer, "open", 2);
    assertThat(pages).containsExactly(List.of("B0", "A0"), List.of("B1"));
    var firstPage = page(viewer, "open", null, 2);
    assertThat(firstPage.closedCount()).isEqualTo(2);
    assertThat(firstPage.hiddenCount()).isEqualTo(3);
    var secondPage = page(viewer, "open", firstPage.nextCursor(), 2);
    assertThat(secondPage.closedCount()).isEqualTo(2);
    assertThat(secondPage.hiddenCount()).isEqualTo(3);

    var closed = page(viewer, "closed", null, null);
    assertThat(closed.items()).extracting(IssueResponse::title).containsExactly("A1", "B2");
    // 소유자는 모두 본다 — 끝난 하위 3건, 숨김 0.
    var all = page(owner, "open", null, null);
    assertThat(all.items())
        .extracting(IssueResponse::title)
        .containsExactly("B0", "A0", "C1", "B1", "C2");
    assertThat(all.closedCount()).isEqualTo(3);
    assertThat(all.hiddenCount()).isZero();
  }

  @Test
  void 잘못된_state_와_cursor_는_잘못된_요청() {
    assertThatThrownBy(() -> page(owner, "done", null, null))
        .isInstanceOf(InvalidCursorException.class);
    assertThatThrownBy(() -> page(owner, "open", "!!!not-a-cursor", null))
        .isInstanceOf(InvalidCursorException.class);
  }

  /** project:read 권한으로 인증해 하위 조회를 부른다. 요청 처리가 테넌트 문맥을 지우므로 뒤에서 다시 심는다. */
  private ResultActions getChildren(String query) throws Exception {
    TenantContext.set(1L);
    var auth =
        new UsernamePasswordAuthenticationToken(
            owner, "n/a", List.of(new SimpleGrantedAuthority("project:read")));
    ResultActions r =
        mvc.perform(
            get("/api/v1/projects/" + b.key() + "/issues/" + epicB.number() + "/children" + query)
                .with(authentication(auth)));
    TenantContext.set(1L);
    return r;
  }

  @Test
  void API_는_state_cursor_size_를_받고_closedCount_nextCursor_를_싣는다() throws Exception {
    for (int i = 0; i < 3; i++) childInB("열림 " + i);
    var done = childInB("끝남");
    close(b, done, IssueStatuses.DONE);

    getChildren("")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(3))
        .andExpect(jsonPath("$.closedCount").value(1))
        .andExpect(jsonPath("$.hiddenCount").value(0));
    var first =
        getChildren("?state=open&size=2")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].title").value("열림 0"))
            .andExpect(jsonPath("$.nextCursor").isString())
            .andReturn();
    String cursor =
        com.jayway.jsonpath.JsonPath.read(first.getResponse().getContentAsString(), "$.nextCursor");
    getChildren("?state=open&size=2&cursor=" + cursor)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(1))
        .andExpect(jsonPath("$.items[0].title").value("열림 2"));
    getChildren("?state=closed")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].title").value("끝남"));
    getChildren("?state=bogus").andExpect(status().isBadRequest());
    getChildren("?cursor=zzz").andExpect(status().isBadRequest());
  }
}

package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 4a — 검색 응답에 parent / childCount / childDoneCount 포함 + parent/topLevel 필터. */
@Transactional
class IssueSearchServiceParentTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService searchService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired ProjectService projectService;

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
    return id;
  }

  private String uniqueKey(String prefix) {
    return uniqueProjectKey(prefix.toUpperCase());
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  @Test
  void search_result_includes_parent_and_child_counts() {
    Long owner = createUser("a");
    var p = newProject(owner, "PS1");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var c1 =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("c1", null, null, null, null, subId, parent.number(), null));
    var c2 =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("c2", null, null, null, null, subId, parent.number(), null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("c3", null, null, null, null, subId, parent.number(), null));
    // c1 은 DONE, c2 는 CANCELED 로 전환 — 취소도 완료 분류라 진행률에 함께 집계된다(WP-243)
    issueService.update(
        owner,
        p.key(),
        c1.number(),
        new UpdateIssueRequest(
            null, null, "DONE", null, null, false, null, false, null, false, null, null, null));
    issueService.update(
        owner,
        p.key(),
        c2.number(),
        new UpdateIssueRequest(
            null, null, "CANCELED", null, null, false, null, false, null, false, null, null, null));

    Map<String, String> params = new HashMap<>();
    var resp = searchService.search(owner, p.key(), params);

    var parentItem =
        resp.items().stream().filter(i -> i.number() == parent.number()).findFirst().orElseThrow();
    assertThat(parentItem.childCount()).isEqualTo(3);
    assertThat(parentItem.childDoneCount()).isEqualTo(2);
    var childItem =
        resp.items().stream().filter(i -> i.number() == c1.number()).findFirst().orElseThrow();
    assertThat(childItem.parent()).isNotNull();
    assertThat(childItem.parent().number()).isEqualTo(parent.number());
  }

  @Test
  void parent_filter_returns_only_that_parents_children() {
    Long owner = createUser("b");
    var p = newProject(owner, "PS2");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("c1", null, null, null, null, subId, parent.number(), null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("c2", null, null, null, null, subId, parent.number(), null));
    // 다른 TASK 하나 — 필터 결과에 포함 안 되어야 함
    issueService.create(
        owner, p.key(), new CreateIssueRequest("other", null, null, null, null, null, null, null));

    var params = new HashMap<String, String>();
    params.put("parent", String.valueOf(parent.number()));
    var resp = searchService.search(owner, p.key(), params);

    assertThat(resp.items()).hasSize(2);
    assertThat(resp.items()).allMatch(i -> i.parent() != null);
    assertThat(resp.items()).allMatch(i -> i.parent().number() == parent.number());
  }

  @Test
  void top_level_filter_returns_only_root_issues() {
    Long owner = createUser("c");
    var p = newProject(owner, "PS3");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    issueService.create(
        owner, p.key(), new CreateIssueRequest("other", null, null, null, null, null, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("c1", null, null, null, null, subId, parent.number(), null));

    var params = new HashMap<String, String>();
    params.put("topLevel", "true");
    var resp = searchService.search(owner, p.key(), params);

    assertThat(resp.items()).hasSize(2);
    assertThat(resp.items()).allMatch(i -> i.parent() == null);
  }

  /**
   * excludeSubtasks=true 는 SUBTASK 유형만 숨긴다: 루트/에픽/에픽 직속 자식(비SUBTASK)은 목록에 남고, 부모가 있는 SUBTASK 는 물론
   * 부모가 해제된 고아 SUBTASK(type=SUBTASK, parent=NULL)까지 함께 제외된다. 이 "고아까지 제외" 케이스가 '부모=EPIC'(A안) 대신
   * 'SUBTASK 유형 제외'(B안) 를 채택한 근거다 — A안이면 고아 SUBTASK 가 루트 가지로 새어 들어온다.
   */
  @Test
  void exclude_subtasks_hides_subtask_type_but_keeps_epic_children() {
    Long owner = createUser("d");
    var p = newProject(owner, "PS4");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();

    // 루트 TASK — 포함되어야 함
    var root =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("root", null, null, null, null, null, null, null));
    // EPIC + 그 직속 자식(비SUBTASK) — 에픽 자식은 노출 유지되어야 함
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("epic", null, null, null, null, epicId, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("epicChild", null, null, null, null, null, epic.number(), null));
    // root 밑의 SUBTASK — 제외되어야 함
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("sub", null, null, null, null, subId, root.number(), null));
    // 고아 SUBTASK — 유형은 SUBTASK 이나 parent 를 직접 해제. B안 정당화 케이스: 제외되어야 함
    var orphan =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("orphan", null, null, null, null, subId, root.number(), null));
    dsl.update(ISSUE).setNull(ISSUE.PARENT_ISSUE_ID).where(ISSUE.ID.eq(orphan.id())).execute();

    var params = new HashMap<String, String>();
    params.put("excludeSubtasks", "true");
    var resp = searchService.search(owner, p.key(), params);

    var titles = resp.items().stream().map(i -> i.title()).toList();
    assertThat(titles).contains("root", "epic", "epicChild"); // 비SUBTASK 는 유지
    assertThat(titles).doesNotContain("sub", "orphan"); // SUBTASK 는 고아 포함 전부 제외
  }

  /**
   * 보드·목록 기본 뷰(excludeSubtasks + excludeEpics): EPIC 행은 숨기고 에픽 하위 이슈·루트 이슈는 남긴다. SUBTASK 는 기존대로 제외.
   * 프로젝트 단위로 조회하므로 신규 프로젝트 시드만 대상이다(공유 test DB 데이터 무관).
   */
  @Test
  void exclude_epics_hides_epic_rows_but_keeps_epic_children() {
    Long owner = createUser("e");
    var p = newProject(owner, "PS5");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();

    var root =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("root", null, null, null, null, null, null, null));
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("epic", null, null, null, null, epicId, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("epicChild", null, null, null, null, null, epic.number(), null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("sub", null, null, null, null, subId, root.number(), null));

    var params = new HashMap<String, String>();
    params.put("excludeSubtasks", "true");
    params.put("excludeEpics", "true");
    var titles =
        searchService.search(owner, p.key(), params).items().stream().map(i -> i.title()).toList();

    assertThat(titles).containsExactlyInAnyOrder("root", "epicChild");
  }

  /** 「에픽 미할당」 = topLevel + excludeEpics: 부모 없는 비EPIC 이슈만. 에픽 자신과 에픽 하위 이슈는 제외된다. */
  @Test
  void top_level_with_exclude_epics_returns_unassigned_issues_only() {
    Long owner = createUser("f");
    var p = newProject(owner, "PS6");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();

    issueService.create(
        owner, p.key(), new CreateIssueRequest("root", null, null, null, null, null, null, null));
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("epic", null, null, null, null, epicId, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("epicChild", null, null, null, null, null, epic.number(), null));

    var params = new HashMap<String, String>();
    params.put("topLevel", "true");
    params.put("excludeEpics", "true");
    var titles =
        searchService.search(owner, p.key(), params).items().stream().map(i -> i.title()).toList();

    assertThat(titles).containsExactly("root");
  }

  /** parent 지정(에픽 선택) 시 excludeEpics 는 무시되어 해당 에픽의 하위 이슈가 그대로 나온다. */
  @Test
  void exclude_epics_is_ignored_when_parent_is_given() {
    Long owner = createUser("g");
    var p = newProject(owner, "PS7");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();

    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("epic", null, null, null, null, epicId, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("epicChild", null, null, null, null, null, epic.number(), null));

    var params = new HashMap<String, String>();
    params.put("parent", String.valueOf(epic.number()));
    params.put("excludeEpics", "true");
    var titles =
        searchService.search(owner, p.key(), params).items().stream().map(i -> i.title()).toList();

    assertThat(titles).containsExactly("epicChild");
  }

  /**
   * WP-247 — 검색 응답의 parent 요약에 부모 상태가 실린다. 필터로 부모(에픽) 행이 응답에서 빠져도 하위 이슈만으로 부모가 취소됐는지 알 수 있어야 타임라인이
   * 취소 에픽의 하위를 「에픽 없음」으로 옮길 수 있다. 부모가 TODO 일 때와 CANCELED 로 바뀐 뒤를 모두 확인한다.
   */
  @Test
  void search_result_parent_carries_parent_status() {
    Long owner = createUser("h");
    var p = newProject(owner, "PS8");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();

    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("epic", null, null, null, null, epicId, null, null));
    var child =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("epicChild", null, null, null, null, null, epic.number(), null));

    // 부모 행이 응답에 없도록 하위 이슈만 조회 — parent 필터가 에픽 자신은 제외한다
    var params = new HashMap<String, String>();
    params.put("parent", String.valueOf(epic.number()));
    var before =
        searchService.search(owner, p.key(), params).items().stream()
            .filter(i -> i.number() == child.number())
            .findFirst()
            .orElseThrow();
    assertThat(before.parent().status()).isEqualTo("TODO");

    // 에픽을 취소 — 하위는 열린 채로 남고 parent.status 만 CANCELED 로 바뀌어야 한다
    issueService.update(
        owner,
        p.key(),
        epic.number(),
        new UpdateIssueRequest(
            null, null, "CANCELED", null, null, false, null, false, null, false, null, null, null));
    var after =
        searchService.search(owner, p.key(), params).items().stream()
            .filter(i -> i.number() == child.number())
            .findFirst()
            .orElseThrow();
    assertThat(after.status()).isEqualTo("TODO");
    assertThat(after.parent().status()).isEqualTo("CANCELED");
  }

  // ---------------------------------------------------------------- WP-1692 할아버지 에픽 / descendants

  /** 에픽 E › 스토리 S › 하위 태스크 T, 그리고 E 직계 태스크 K 를 한 프로젝트에 만든 픽스처(WP-1692). */
  private record Tree(
      Long owner,
      ProjectResponse project,
      IssueResponse epic,
      IssueResponse story,
      IssueResponse sub,
      IssueResponse direct) {}

  private CreateIssueRequest typed(String title, Long typeId, Integer parentNumber) {
    return new CreateIssueRequest(title, null, null, null, null, typeId, parentNumber, null);
  }

  private Tree tree(String prefix) {
    Long owner = createUser(prefix);
    var p = newProject(owner, prefix);
    Long epicType = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    Long storyType = typeRepository.findByProjectAndName(p.id(), "STORY").orElseThrow().id();
    Long subType = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var epic = issueService.create(owner, p.key(), typed("E 제목", epicType, null));
    var story = issueService.create(owner, p.key(), typed("S 제목", storyType, epic.number()));
    var sub = issueService.create(owner, p.key(), typed("T 제목", subType, story.number()));
    var direct = issueService.create(owner, p.key(), typed("K 제목", null, epic.number()));
    return new Tree(owner, p, epic, story, sub, direct);
  }

  private java.util.Set<Integer> numbers(Tree t, Map<String, String> params) {
    return searchService.search(t.owner(), t.project().key(), params).items().stream()
        .map(i -> i.number())
        .collect(java.util.stream.Collectors.toSet());
  }

  @Test
  void 하위_태스크_응답에_할아버지_에픽을_싣는다() {
    var t = tree("g1");
    var items = searchService.search(t.owner(), t.project().key(), Map.of()).items();
    var sub = items.stream().filter(i -> i.number() == t.sub().number()).findFirst().orElseThrow();
    assertThat(sub.parent().number()).isEqualTo(t.story().number());
    var epic = sub.parent().epic();
    assertThat(epic).isNotNull();
    assertThat(epic.number()).isEqualTo(t.epic().number());
    assertThat(epic.title()).isEqualTo("E 제목");
    assertThat(epic.type().name()).isEqualTo("EPIC");
    assertThat(epic.hidden()).isFalse();
    // 직계 부모가 에픽이면 싣지 않는다 — 스토리·직계 태스크 모두
    var direct =
        items.stream().filter(i -> i.number() == t.direct().number()).findFirst().orElseThrow();
    assertThat(direct.parent().epic()).isNull();
    var story =
        items.stream().filter(i -> i.number() == t.story().number()).findFirst().orElseThrow();
    assertThat(story.parent().epic()).isNull();
  }

  @Test
  void 에픽_없는_스토리의_하위_태스크는_epic_이_없다() {
    Long owner = createUser("g2");
    var p = newProject(owner, "G2");
    Long storyType = typeRepository.findByProjectAndName(p.id(), "STORY").orElseThrow().id();
    Long subType = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var story = issueService.create(owner, p.key(), typed("S", storyType, null));
    var sub = issueService.create(owner, p.key(), typed("T", subType, story.number()));
    var found =
        searchService.search(owner, p.key(), Map.of()).items().stream()
            .filter(i -> i.number() == sub.number())
            .findFirst()
            .orElseThrow();
    assertThat(found.parent().number()).isEqualTo(story.number());
    assertThat(found.parent().epic()).isNull();
  }

  @Test
  void 상세_응답에도_할아버지_에픽을_싣는다() {
    var t = tree("g3");
    var detail = issueService.get(t.owner(), t.project().key(), t.sub().number());
    assertThat(detail.summary().parent().epic().number()).isEqualTo(t.epic().number());
  }

  @Test
  void 에픽이_없으면_epic_키가_직렬화되지_않는다() throws Exception {
    var t = tree("g4");
    var direct =
        searchService.search(t.owner(), t.project().key(), Map.of()).items().stream()
            .filter(i -> i.number() == t.direct().number())
            .findFirst()
            .orElseThrow();
    var json = new tools.jackson.databind.ObjectMapper().writeValueAsString(direct.parent());
    assertThat(json).doesNotContain("\"epic\"");
  }

  @Test
  void 에픽_필터_descendants_는_손자_하위_태스크까지_포함한다() {
    var t = tree("d1");
    var got =
        numbers(t, Map.of("parent", String.valueOf(t.epic().number()), "descendants", "true"));
    assertThat(got)
        .containsExactlyInAnyOrder(t.story().number(), t.direct().number(), t.sub().number());
  }

  @Test
  void 에픽_필터_descendants_와_excludeSubtasks_면_바로_아래_자식만_보인다() {
    var t = tree("d2");
    var got =
        numbers(
            t,
            Map.of(
                "parent",
                String.valueOf(t.epic().number()),
                "descendants",
                "true",
                "excludeSubtasks",
                "true"));
    assertThat(got).containsExactlyInAnyOrder(t.story().number(), t.direct().number());
  }

  @Test
  void descendants_없는_parent_는_바로_아래_자식만() {
    var t = tree("d3");
    String epicNo = String.valueOf(t.epic().number());
    assertThat(numbers(t, Map.of("parent", epicNo)))
        .containsExactlyInAnyOrder(t.story().number(), t.direct().number());
    // 예전처럼 excludeSubtasks 는 parent 지정 시 무시된다
    assertThat(numbers(t, Map.of("parent", epicNo, "excludeSubtasks", "true")))
        .containsExactlyInAnyOrder(t.story().number(), t.direct().number());
    assertThat(numbers(t, Map.of("parent", String.valueOf(t.story().number()))))
        .containsExactly(t.sub().number());
  }

  @Test
  void 그룹_총계도_descendants_를_따른다() {
    var t = tree("d4");
    var res =
        searchService.groupCounts(
            t.owner(),
            t.project().key(),
            Map.of(
                "parent",
                String.valueOf(t.epic().number()),
                "descendants",
                "true",
                "groupBy",
                "status"));
    assertThat(res.groups().stream().mapToInt(g -> g.count()).sum()).isEqualTo(3);
  }
}

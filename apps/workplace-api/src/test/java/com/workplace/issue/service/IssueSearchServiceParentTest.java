package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
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
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
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
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("c2", null, null, null, null, subId, parent.number(), null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("c3", null, null, null, null, subId, parent.number(), null));
    // c1 만 DONE 으로 전환
    issueService.update(
        owner,
        p.key(),
        c1.number(),
        new UpdateIssueRequest(null, null, "DONE", null, null, false, null, false, null, false));

    Map<String, String> params = new HashMap<>();
    var resp = searchService.search(owner, p.key(), params);

    var parentItem =
        resp.items().stream().filter(i -> i.number() == parent.number()).findFirst().orElseThrow();
    assertThat(parentItem.childCount()).isEqualTo(3);
    assertThat(parentItem.childDoneCount()).isEqualTo(1);
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
}

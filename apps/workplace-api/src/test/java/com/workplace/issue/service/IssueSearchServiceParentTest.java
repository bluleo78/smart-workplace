package com.workplace.issue.service;

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
}

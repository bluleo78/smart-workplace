package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueSearchService — type 임베딩(N+1 회피) + type CSV 필터(OR) 검증. */
@Transactional
class IssueSearchServiceTypesTest extends IntegrationTestBase {

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
  void search_result_includes_type_summary() {
    Long owner = createUser("a");
    ProjectResponse p = newProject(owner, "STY1");
    var bug = typeRepository.findByProjectAndName(p.id(), "BUG").orElseThrow();
    issueService.create(
        owner, p.key(), new CreateIssueRequest("with-bug", null, null, null, null, bug.id()));

    var resp = searchService.search(owner, p.key(), Map.of());

    assertThat(resp.items()).isNotEmpty();
    assertThat(resp.items().get(0).type()).isNotNull();
    assertThat(resp.items().get(0).type().name()).isEqualTo("BUG");
    assertThat(resp.items().get(0).type().icon()).isEqualTo("Bug");
  }

  @Test
  void type_csv_filter_or_matches() {
    Long owner = createUser("b");
    ProjectResponse p = newProject(owner, "STY2");
    var bug = typeRepository.findByProjectAndName(p.id(), "BUG").orElseThrow();
    var story = typeRepository.findByProjectAndName(p.id(), "STORY").orElseThrow();
    var task = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow();
    issueService.create(
        owner, p.key(), new CreateIssueRequest("a-bug", null, null, null, null, bug.id()));
    issueService.create(
        owner, p.key(), new CreateIssueRequest("a-story", null, null, null, null, story.id()));
    issueService.create(
        owner, p.key(), new CreateIssueRequest("a-task", null, null, null, null, task.id()));

    var resp = searchService.search(owner, p.key(), Map.of("type", bug.id() + "," + story.id()));

    assertThat(resp.items()).hasSize(2);
    assertThat(resp.items()).extracting(i -> i.type().name()).containsOnly("BUG", "STORY");
  }
}

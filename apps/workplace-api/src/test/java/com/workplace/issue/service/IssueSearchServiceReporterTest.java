package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
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

/** IssueSearchService 의 reporter 필터(= 이슈를 만든 사람) 검증. */
@Transactional
class IssueSearchServiceReporterTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueRepository issueRepository;
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
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  @Test
  void filter_reporter_matches_only_issues_reported_by_that_user() {
    Long owner = createUser("r");
    Long u1 = createUser("r1");
    ProjectResponse p = newProject(owner, "SR1");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    issueRepository.insert(p.id(), 1, "by-owner", null, "MID", null, owner);
    issueRepository.insert(p.id(), 2, "by-u1", null, "MID", null, u1);

    var resp = searchService.search(owner, p.key(), Map.of("reporter", String.valueOf(u1)));

    assertThat(resp.items()).extracting(IssueResponse::title).containsExactly("by-u1");
  }

  @Test
  void filter_reporter_me_literal_resolves_to_caller() {
    Long owner = createUser("rm");
    Long other = createUser("rm2");
    ProjectResponse p = newProject(owner, "SR2");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    issueRepository.insert(p.id(), 1, "mine", null, "MID", null, owner);
    issueRepository.insert(p.id(), 2, "theirs", null, "MID", null, other);

    var resp = searchService.search(owner, p.key(), Map.of("reporter", "me"));

    assertThat(resp.items()).extracting(IssueResponse::title).containsExactly("mine");
  }

  /**
   * 횡단 경로(/me/issues → searchMemberOf) 에서도 reporter 필터가 적용되는지 검증. 실제 프론트 소비 경로이므로 project-scoped
   * search() 와 별도로 보호한다.
   */
  @Test
  void filter_reporter_me_applies_on_cross_project_searchMine() {
    Long owner = createUser("rx");
    Long other = createUser("rx2");
    ProjectResponse p = newProject(owner, "SR3");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    issueRepository.insert(p.id(), 1, "x-mine", null, "MID", null, owner);
    issueRepository.insert(p.id(), 2, "x-theirs", null, "MID", null, other);

    var resp = searchService.searchMine(owner, Map.of("reporter", "me"));

    assertThat(resp.items()).extracting(IssueResponse::title).containsExactly("x-mine");
  }
}

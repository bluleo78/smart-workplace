package com.workplace.watcher.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WatcherAutoEnroller 자동 등록 통합 테스트 (create/update 훅 경로). */
@Transactional
class WatcherAutoEnrollerTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueWatcherRepository watcherRepository;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;

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
  void reporter_is_auto_enrolled_on_create() {
    Long u = createUser("a");
    ProjectResponse p = newProject(u, "AE1");

    var resp =
        issueService.create(u, p.key(), new CreateIssueRequest("t", null, "MID", null, null));

    var watchers = watcherRepository.findUserIdsByIssue(resp.id());
    assertThat(watchers).contains(u);
  }

  @Test
  void new_assignee_is_auto_enrolled_on_update() {
    Long owner = createUser("b");
    Long assignee = createUser("c");
    ProjectResponse p = newProject(owner, "AE2");
    memberRepository.insert(p.id(), assignee, "MEMBER");
    var issue =
        issueService.create(owner, p.key(), new CreateIssueRequest("t", null, "MID", null, null));

    issueService.update(
        owner,
        p.key(),
        issue.number(),
        new UpdateIssueRequest(null, null, null, null, null, assignee, false, false));

    var watchers = watcherRepository.findUserIdsByIssue(issue.id());
    assertThat(watchers).contains(assignee);
  }
}

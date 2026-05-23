package com.workplace.watcher.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WatcherService 통합 테스트. */
@Transactional
class WatcherServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WatcherService watcherService;
  @Autowired IssueRepository issueRepository;
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
  void member_can_watch_and_unwatch_idempotently() {
    Long owner = createUser("w1");
    ProjectResponse p = newProject(owner, "W1");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);

    watcherService.watch(owner, p.key(), 1);
    watcherService.watch(owner, p.key(), 1); // idempotent
    assertThat(watcherService.list(owner, p.key(), 1)).hasSize(1);

    watcherService.unwatch(owner, p.key(), 1);
    watcherService.unwatch(owner, p.key(), 1); // idempotent
    assertThat(watcherService.list(owner, p.key(), 1)).isEmpty();
  }

  @Test
  void non_member_watch_forbidden() {
    Long owner = createUser("w2");
    Long other = createUser("x2");
    ProjectResponse p = newProject(owner, "W2");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);

    assertThatThrownBy(() -> watcherService.watch(other, p.key(), 1))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void watched_issues_filters_out_non_member_projects() {
    Long u = createUser("w3");
    ProjectResponse p = newProject(u, "W3");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, u, null);
    watcherService.watch(u, p.key(), 1);

    assertThat(watcherService.watchedIssues(u, null, 30).items()).hasSize(1);

    memberRepository.delete(p.id(), u); // 멤버 박탈
    assertThat(watcherService.watchedIssues(u, null, 30).items()).isEmpty();
  }
}

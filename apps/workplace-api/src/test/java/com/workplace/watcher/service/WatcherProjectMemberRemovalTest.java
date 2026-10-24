package com.workplace.watcher.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트에서 빠진 사람은 그 프로젝트 이슈의 워처에서도 빠진다 (WP-476).
 *
 * <p>워처 row 가 남으면 제거 뒤 생긴 댓글·상태 변경 알림, 활동 피드, 실시간 이벤트가 계속 그 사람에게 가고 바뀐 이슈 제목까지 보인다. 제거 뒤에도 그 프로젝트를
 * 볼 수 있는 사람(OPEN 프로젝트)의 워처는 남긴다.
 */
@Transactional
class WatcherProjectMemberRemovalTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WatcherService watcherService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @Autowired IssueWatcherRepository watcherRepository;

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
    // 프로젝트 멤버 추가는 같은 테넌트 구성원만 받는다(WP-417).
    com.workplace.support.TestFixtures.addMember(dsl, id, 1L);
    return id;
  }

  private ProjectResponse newProject(Long ownerId, String type) {
    String key =
        "WR" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(ownerId, new CreateProjectRequest(key, "P", "x", type));
  }

  @Test
  void 멤버를_제거하면_그_프로젝트_이슈의_워처에서_빠진다() {
    Long owner = createUser("o");
    Long member = createUser("m");
    ProjectResponse p = newProject(owner, "TEAM");
    long issue1 =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "t1", null, "MID", null, owner).id();
    long issue2 =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 2, "t2", null, "MID", null, owner).id();
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    watcherService.watch(member, p.key(), 1);
    watcherService.watch(member, p.key(), 2);
    watcherService.watch(owner, p.key(), 1);

    projectService.removeMember(owner, p.key(), member);

    assertThat(watcherRepository.findUserIdsByIssue(issue1)).containsExactly(owner);
    assertThat(watcherRepository.findUserIdsByIssue(issue2)).isEmpty();
  }

  @Test
  void OPEN_프로젝트는_제거_뒤에도_볼_수_있으니_워처를_남긴다() {
    Long owner = createUser("o");
    Long member = createUser("m");
    ProjectResponse p = newProject(owner, "OPEN");
    long issue1 =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "t1", null, "MID", null, owner).id();
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    watcherService.watch(member, p.key(), 1);

    projectService.removeMember(owner, p.key(), member);

    assertThat(watcherRepository.findUserIdsByIssue(issue1)).containsExactly(member);
  }
}

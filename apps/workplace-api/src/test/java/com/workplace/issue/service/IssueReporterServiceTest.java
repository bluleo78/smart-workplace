package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.InvalidReporterException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * IssueReporterService 통합 테스트(WP-944) — 누가 바꿀 수 있나(OWNER·ADMIN·지금 보고자), 누구로 바꿀 수 있나(사람·활성·프로젝트를 볼 수
 * 있음), 바꾼 뒤 이력·watcher·상세 권한 플래그.
 */
@Transactional
class IssueReporterServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueReporterService service;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired IssueWatcherRepository watcherRepository;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;

  /** 테넌트#1 ACTIVE 멤버십을 가진 사람(USER 역할) 사용자. */
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

  private ProjectResponse newProject(Long ownerId, String prefix, String type) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
    return projectService.create(ownerId, new CreateProjectRequest(key, "P-" + prefix, "x", type));
  }

  @Test
  void owner_changes_reporter_records_history_and_enrolls_watcher() {
    Long owner = createUser("ro");
    Long reporter = createUser("rr");
    Long next = createUser("rn");
    ProjectResponse p = newProject(owner, "RP1", "TEAM");
    projectService.addMember(owner, p.key(), new AddMemberRequest(reporter, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(next, "MEMBER"));
    IssueRow issue =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "t", null, "MID", null, reporter);

    var result = service.change(owner, p.key(), 1, next);

    assertThat(result.id()).isEqualTo(next);
    assertThat(issueRepository.findById(issue.id()).orElseThrow().reporterId()).isEqualTo(next);
    assertThat(historyRepository.findByIssue(issue.id()))
        .anyMatch(
            h ->
                "REPORTER_CHANGED".equals(h.eventType())
                    && "rr".equals(h.fromValue())
                    && "rn".equals(h.toValue()));
    assertThat(watcherRepository.findUserIdsByIssue(issue.id())).contains(next);
  }

  @Test
  void current_reporter_can_hand_over_and_loses_change_right() {
    Long owner = createUser("ho");
    Long reporter = createUser("hr");
    Long next = createUser("hn");
    ProjectResponse p = newProject(owner, "RP2", "TEAM");
    projectService.addMember(owner, p.key(), new AddMemberRequest(reporter, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(next, "MEMBER"));
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "t", null, "MID", null, reporter);

    assertThat(issueService.get(reporter, p.key(), 1).viewerCanChangeReporter()).isTrue();
    service.change(reporter, p.key(), 1, next);

    // 넘긴 뒤에는 일반 멤버라 다시 바꿀 수 없다 — 권한은 지금 보고자를 따른다.
    assertThat(issueService.get(reporter, p.key(), 1).viewerCanChangeReporter()).isFalse();
    assertThatThrownBy(() -> service.change(reporter, p.key(), 1, reporter))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void plain_member_cannot_change_reporter() {
    Long owner = createUser("mo");
    Long member = createUser("mm");
    ProjectResponse p = newProject(owner, "RP3", "TEAM");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "t", null, "MID", null, owner);

    assertThat(issueService.get(member, p.key(), 1).viewerCanChangeReporter()).isFalse();
    assertThatThrownBy(() -> service.change(member, p.key(), 1, member))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void agent_cannot_become_reporter() {
    Long owner = createUser("ao");
    Long agent = createAgentUserWithMembership("aa");
    ProjectResponse p = newProject(owner, "RP4", "TEAM");
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(() -> service.change(owner, p.key(), 1, agent))
        .isInstanceOf(InvalidReporterException.class)
        .hasMessageContaining("AI");
  }

  @Test
  void team_project_rejects_non_member_but_open_project_allows() {
    Long owner = createUser("oo");
    Long stranger = createUser("os");
    ProjectResponse team = newProject(owner, "RP5", "TEAM");
    ProjectResponse open = newProject(owner, "RP6", "OPEN");
    IssueSeeds.insert(issueRepository, baseDsl, team.id(), 1, "t", null, "MID", null, owner);
    IssueRow openIssue =
        IssueSeeds.insert(issueRepository, baseDsl, open.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(() -> service.change(owner, team.key(), 1, stranger))
        .isInstanceOf(InvalidReporterException.class);

    // OPEN 은 워크스페이스 전원이 볼 수 있어 멤버가 아니어도 보고자가 될 수 있다.
    service.change(owner, open.key(), 1, stranger);
    assertThat(issueRepository.findById(openIssue.id()).orElseThrow().reporterId())
        .isEqualTo(stranger);
  }

  @Test
  void same_reporter_is_noop_without_history() {
    Long owner = createUser("so");
    ProjectResponse p = newProject(owner, "RP7", "TEAM");
    IssueRow issue =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "t", null, "MID", null, owner);

    service.change(owner, p.key(), 1, owner);

    assertThat(historyRepository.findByIssue(issue.id()))
        .noneMatch(h -> "REPORTER_CHANGED".equals(h.eventType()));
  }
}

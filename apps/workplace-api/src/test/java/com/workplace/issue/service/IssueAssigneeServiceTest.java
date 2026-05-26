package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.IssueAssigneeAgentRestrictionException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.repository.UserRepository;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueAssigneeService 통합 테스트 — 집합 교체, 멤버십 가드, history, watcher 자동 등록. */
@Transactional
class IssueAssigneeServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueAssigneeService service;
  @Autowired IssueAssigneeRepository repo;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired IssueWatcherRepository watcherRepository;
  @Autowired ProjectService projectService;
  @Autowired UserRepository userRepository;

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

  /** AGENT 유저 생성 (password=NULL, kind='AGENT'). 권한 분기 통합 테스트용. */
  private Long createAgentUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, "AGENT")
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
  void empty_to_two_users_assigns_and_records_history_and_enrolls_watchers() {
    Long owner = createUser("a");
    Long u1 = createUser("a1");
    Long u2 = createUser("a2");
    ProjectResponse p = newProject(owner, "AS1");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(u2, "MEMBER"));
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    var result = service.replace(owner, p.key(), 1, List.of(u1, u2));

    assertThat(result).hasSize(2);
    assertThat(historyRepository.findByIssue(issue.id()))
        .anyMatch(h -> "ASSIGNEES_CHANGED".equals(h.eventType()));
    assertThat(watcherRepository.findUserIdsByIssue(issue.id())).contains(u1, u2);
  }

  @Test
  void swap_user1_to_user2() {
    Long owner = createUser("b");
    Long u1 = createUser("b1");
    Long u2 = createUser("b2");
    ProjectResponse p = newProject(owner, "AS2");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(u2, "MEMBER"));
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(u1));

    service.replace(owner, p.key(), 1, List.of(u2));

    assertThat(repo.findUserIdsByIssue(issue.id())).containsExactly(u2);
  }

  @Test
  void non_member_user_throws_400() {
    Long owner = createUser("c");
    Long stranger = createUser("c-strange");
    ProjectResponse p = newProject(owner, "AS3");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(() -> service.replace(owner, p.key(), 1, List.of(stranger)))
        .isInstanceOf(InvalidAssigneeForProjectException.class);
  }

  @Test
  void non_member_caller_throws_403() {
    Long owner = createUser("d");
    Long stranger = createUser("d-strange");
    ProjectResponse p = newProject(owner, "AS4");
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(() -> service.replace(stranger, p.key(), 1, List.of()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void same_set_does_not_record_history() {
    Long owner = createUser("e");
    Long u1 = createUser("e1");
    ProjectResponse p = newProject(owner, "AS5");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(u1));
    long before =
        historyRepository.findByIssue(issue.id()).stream()
            .filter(h -> "ASSIGNEES_CHANGED".equals(h.eventType()))
            .count();

    service.replace(owner, p.key(), 1, List.of(u1));

    long after =
        historyRepository.findByIssue(issue.id()).stream()
            .filter(h -> "ASSIGNEES_CHANGED".equals(h.eventType()))
            .count();
    assertThat(after).isEqualTo(before);
  }

  @Test
  void empty_array_removes_all() {
    Long owner = createUser("f");
    Long u1 = createUser("f1");
    Long u2 = createUser("f2");
    ProjectResponse p = newProject(owner, "AS6");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(u2, "MEMBER"));
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(u1, u2));

    var result = service.replace(owner, p.key(), 1, List.of());

    assertThat(result).isEmpty();
    assertThat(repo.findUserIdsByIssue(issue.id())).isEmpty();
  }

  @Test
  void agent_unassigning_only_self_succeeds() {
    Long owner = createUser("ag-owner");
    Long agent = createAgentUser("ag-self");
    ProjectResponse p = newProject(owner, "AGSELF");
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(agent));

    var result = service.replace(agent, p.key(), 1, List.of());

    assertThat(result).isEmpty();
  }

  @Test
  void agent_unassigning_someone_else_throws_403() {
    Long owner = createUser("ag2-owner");
    Long other = createUser("ag2-other");
    Long agent = createAgentUser("ag2-self");
    ProjectResponse p = newProject(owner, "AGOTH");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(other, agent));

    assertThatThrownBy(() -> service.replace(agent, p.key(), 1, List.of(agent)))
        .isInstanceOf(IssueAssigneeAgentRestrictionException.class);
  }

  @Test
  void agent_adding_new_user_throws_403() {
    Long owner = createUser("ag3-owner");
    Long other = createUser("ag3-other");
    Long agent = createAgentUser("ag3-self");
    ProjectResponse p = newProject(owner, "AGADD");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(agent));

    assertThatThrownBy(() -> service.replace(agent, p.key(), 1, List.of(agent, other)))
        .isInstanceOf(IssueAssigneeAgentRestrictionException.class);
  }

  @Test
  void agent_solo_removing_self_succeeds() {
    Long owner = createUser("ag4-owner");
    Long agent = createAgentUser("ag4-self");
    ProjectResponse p = newProject(owner, "AGSOL");
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(agent));

    var result = service.replace(agent, p.key(), 1, List.of());

    assertThat(result).isEmpty();
  }

  @Test
  void human_assignee_changes_unaffected_by_agent_branch() {
    Long owner = createUser("ag5-owner");
    Long other = createUser("ag5-other");
    ProjectResponse p = newProject(owner, "AGHUM");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    var result = service.replace(owner, p.key(), 1, List.of(other));

    assertThat(result).hasSize(1);
    assertThat(result.get(0).id()).isEqualTo(other);
  }
}

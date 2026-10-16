package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueResponse;
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
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
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
  @Autowired IssueService issueService;
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
    // 테넌트#1 ACTIVE 멤버십 — MembershipGuard(#713) 가 addMember 대상의 테넌트 소속을 검증하므로 필요.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
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
    Long agent = createAgentUserWithMembership("ag-self");
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
    Long agent = createAgentUserWithMembership("ag2-self");
    ProjectResponse p = newProject(owner, "AGOTH");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(other, agent));

    // 거부 문구는 MCP 결과로 AI 에게 전달되므로 허용되는 경우(자기 제외·바로 아래 빈 하위 항목 맡기)를 안내해야 한다(WP-375).
    assertThatThrownBy(() -> service.replace(agent, p.key(), 1, List.of(agent)))
        .isInstanceOf(IssueAssigneeAgentRestrictionException.class)
        .hasMessageContaining("담당자에서 자기를 빼거나")
        .hasMessageContaining("담당자 없는 바로 아래 하위 항목");
  }

  @Test
  void agent_adding_new_user_throws_403() {
    Long owner = createUser("ag3-owner");
    Long other = createUser("ag3-other");
    Long agent = createAgentUserWithMembership("ag3-self");
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
    Long agent = createAgentUserWithMembership("ag4-self");
    ProjectResponse p = newProject(owner, "AGSOL");
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(agent));

    var result = service.replace(agent, p.key(), 1, List.of());

    assertThat(result).isEmpty();
  }

  /** 개인 프로젝트: 멤버만 담당자로 지정 가능 — 비멤버 AGENT·HUMAN 모두 거부, 멤버 AGENT 는 통과 (#418 정책 통일). */
  @Test
  void replace_personalMemberOnlyPolicy() {
    Long owner = createUser("owner5");
    Long agent = createAgentUserWithMembership("bot5");
    Long stranger = createUser("stranger5");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "p", null, "PERSONAL"));
    IssueResponse issue =
        issueService.create(
            owner,
            personal.key(),
            new CreateIssueRequest("t", null, null, null, null, null, null, null));
    // 비멤버 AGENT → 거부
    assertThatThrownBy(() -> service.replace(owner, personal.key(), issue.number(), List.of(agent)))
        .isInstanceOf(InvalidAssigneeForProjectException.class);
    // 비멤버 HUMAN → 거부
    assertThatThrownBy(
            () -> service.replace(owner, personal.key(), issue.number(), List.of(stranger)))
        .isInstanceOf(InvalidAssigneeForProjectException.class);
    // AGENT 멤버 등록 후 → 담당 가능
    projectService.addMember(owner, personal.key(), new AddMemberRequest(agent, "MEMBER"));
    assertThatCode(() -> service.replace(owner, personal.key(), issue.number(), List.of(agent)))
        .doesNotThrowAnyException();
  }

  /** 비활성화(is_active=false)된 사용자는 신규 담당자로 지정할 수 없다 (#624). */
  @Test
  void inactive_user_cannot_be_newly_assigned() {
    Long owner = createUser("inact-owner");
    Long member = createUser("inact-member");
    ProjectResponse p = newProject(owner, "INACT1");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(member)).execute();

    assertThatThrownBy(() -> service.replace(owner, p.key(), 1, List.of(member)))
        .isInstanceOf(InvalidAssigneeForProjectException.class);
  }

  /**
   * WP-417: 이 워크스페이스에서 정지(멤버십 SUSPENDED)된 구성원은 전역 계정이 활성이어도 신규 담당자로 지정할 수 없다 — 관리자의 「활성 상태」 끄기는 이제
   * 멤버십만 바꾼다.
   */
  @Test
  void workspace_suspended_member_cannot_be_newly_assigned() {
    Long owner = createUser("susp-owner");
    Long member = createUser("susp-member");
    ProjectResponse p = newProject(owner, "SUSP1");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    TestFixtures.suspendMember(dsl, member, 1L);

    assertThatThrownBy(() -> service.replace(owner, p.key(), 1, List.of(member)))
        .isInstanceOf(InvalidAssigneeForProjectException.class);
    // 프로젝트 멤버 목록의 active 도 이 워크스페이스 기준(정지 → false), 다른 멤버는 그대로 true.
    var members = memberRepository.findAllByProject(p.id());
    assertThat(members)
        .filteredOn(m -> m.userId().equals(member))
        .singleElement()
        .satisfies(m -> assertThat(m.active()).isFalse());
    assertThat(members)
        .filteredOn(m -> m.userId().equals(owner))
        .singleElement()
        .satisfies(m -> assertThat(m.active()).isTrue());
  }

  /** WP-417: 이슈를 만들 때도 이 워크스페이스에서 정지된 구성원은 담당자로 지정할 수 없다(교체 경로와 같은 규칙). */
  @Test
  void workspace_suspended_member_cannot_be_assigned_on_create() {
    Long owner = createUser("susp-c-owner");
    Long member = createUser("susp-c-member");
    ProjectResponse p = newProject(owner, "SUSPC");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    TestFixtures.suspendMember(dsl, member, 1L);

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    p.key(),
                    new CreateIssueRequest(
                        "t", null, null, null, List.of(member), null, null, null)))
        .isInstanceOf(InvalidAssigneeForProjectException.class);
  }

  /**
   * 이미 담당 중이던 사용자가 비활성화되어도, 그 상태를 그대로 유지하는(재지정 아닌) replace 는 막지 않는다 — 범위 밖(#624 명시)인 자동 해제와는 별개로,
   * 활성 검증은 신규 추가(toAdd)에만 적용된다.
   */
  @Test
  void inactive_user_already_assigned_kept_when_reasserting_same_set() {
    Long owner = createUser("inact2-owner");
    Long member = createUser("inact2-member");
    ProjectResponse p = newProject(owner, "INACT2");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(member));
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(member)).execute();

    // 동일 집합 재지정(diff 없음, toAdd 비어있음) — 활성 검증 대상 아님
    assertThatCode(() -> service.replace(owner, p.key(), 1, List.of(member)))
        .doesNotThrowAnyException();
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

  @Test
  void agent_cannot_claim_child_whose_parent_link_was_made_by_another_agent() {
    Long owner = createUser("ag6-owner");
    Long agentA = createAgentUserWithMembership("ag6-a");
    Long agentB = createAgentUserWithMembership("ag6-b");
    ProjectResponse p = newProject(owner, "AGPAR");
    projectService.addMember(owner, p.key(), new AddMemberRequest(agentA, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(agentB, "MEMBER"));
    var parent = issueRepository.insert(p.id(), 1, "부모", null, "MID", null, owner);
    var child = issueRepository.insert(p.id(), 2, "자식", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(agentA));
    // 다른 AI(B)가 부모 관계를 만든 상태(setParent 와 같은 결과 — 부모 갱신 + PARENT_CHANGED 이력).
    issueRepository.updateParent(child.id(), parent.id());
    historyRepository.insert(
        child.id(), agentB, IssueHistoryEventType.PARENT_CHANGED.name(), null, "{}");

    // 같은 운영자가 AI 를 여럿 두어 서로 옮겨 주는 우회도 막는다 — 부모 관계는 사람이 만든 것만 근거로 친다.
    assertThatThrownBy(() -> service.replace(agentA, p.key(), 2, List.of(agentA)))
        .isInstanceOf(IssueAssigneeAgentRestrictionException.class);

    // 사람이 다시 부모 관계를 만들면(마지막 변경자가 사람) 맡을 수 있다.
    historyRepository.insert(
        child.id(), owner, IssueHistoryEventType.PARENT_CHANGED.name(), null, "{}");
    assertThat(service.replace(agentA, p.key(), 2, List.of(agentA)).get(0).id()).isEqualTo(agentA);
  }
}

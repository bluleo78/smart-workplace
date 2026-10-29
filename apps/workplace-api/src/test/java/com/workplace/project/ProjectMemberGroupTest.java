package com.workplace.project;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT_MEMBER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.label.repository.LabelRepository;
import com.workplace.notify.repository.NotificationRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.project.service.ProjectMemberGroupService;
import com.workplace.project.service.ProjectMemberGroupService.ProjectDepartmentAudienceShrunk;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import com.workplace.user.service.UserGroupService;
import com.workplace.watcher.repository.IssueWatcherRepository;
import com.workplace.watcher.service.WatcherService;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 팀 프로젝트(TEAM·OPEN) 멤버에 조직도 부서(부서 자체)를 둔다(WP-1057).
 *
 * <ul>
 *   <li>부서와 하위 부서의 활성 사람 구성원이 MEMBER 로 프로젝트에 들어온다. 소속은 판정 때마다 다시 본다.
 *   <li>부서 행은 MEMBER 만(OWNER 400), 조직도 부서만(개인·없는 그룹 400), 팀 프로젝트만(개인 프로젝트 409).
 *   <li>실효 역할 = 직접 멤버 역할과 부서(MEMBER) 중 높은 것.
 *   <li>멤버 목록(후보 원천)은 실효 멤버 — 부서로 들어온 사람은 direct=false 로 함께 나온다.
 *   <li>실효 멤버가 아니게 된 사람(부서 행 제거·부서에서 빠짐·정지)은 멤버 제거와 같이 정리된다 — 담당 해제·이력·AI 작업 취소·워처.
 *   <li>프로젝트 목록·이슈·라벨·이슈 대화 등 가시성 판정과 접근 가드 메서드가 부서 멤버십을 따른다.
 * </ul>
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다. 그래서 커밋 직전 리스너(조직도 변경 뒤 정리)는 테스트에서
 * 직접 부른다(WikiSpaceMemberGroupTest 와 같은 방식).
 */
@Transactional
@RecordApplicationEvents
class ProjectMemberGroupTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberGroupService memberGroupService;
  @Autowired ProjectMemberRepository memberRepository;
  @Autowired ProjectRepository projectRepository;
  @Autowired ProjectAccessGuard guard;
  @Autowired IssueRepository issueRepository;
  @Autowired LabelRepository labelRepository;
  @Autowired IssueStakeholderLookup stakeholderLookup;
  @Autowired NotificationRepository notificationRepository;
  @Autowired WatcherService watcherService;
  @Autowired IssueWatcherRepository watcherRepository;
  @Autowired UserGroupService groupService;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 프로젝트 OWNER(직접 멤버)
  private long devMemberId; // 개발팀 직속 구성원(직접 멤버 아님)
  private long backendMemberId; // 개발팀 > 백엔드 구성원
  private long strangerId; // 어느 부서에도 없음
  private long devId; // 조직도 부서 「개발팀」
  private long backendId; // 개발팀의 하위 부서 「백엔드」
  private ProjectResponse team;
  private String suffix;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    suffix = UUID.randomUUID().toString().substring(0, 8);
    ownerId = human("owner");
    devMemberId = human("dev");
    backendMemberId = human("backend");
    strangerId = human("stranger");
    team = project(ownerId, "TEAM");
    devId = group("개발팀-" + suffix, "SHARED", null, null);
    backendId = group("백엔드-" + suffix, "SHARED", devId, null);
    member(devId, devMemberId);
    member(backendId, backendMemberId);
  }

  @AfterEach
  void clearAuth() {
    SecurityContextHolder.clearContext();
  }

  /** TEAM 프로젝트에 부서를 더하면 부서·하위 부서 구성원이 MEMBER 로 프로젝트를 연다. 부서 밖 사람은 404. */
  @Test
  void department_and_sub_department_members_get_access_on_team_project() throws Exception {
    JsonNode added = json(addGroup(team.key(), devId, null).andExpect(status().isCreated()));
    assertThat(added.get("groupId").asLong()).isEqualTo(devId);
    assertThat(added.get("name").asText()).isEqualTo("개발팀-" + suffix);
    assertThat(added.get("role").asText()).isEqualTo("MEMBER");
    assertThat(added.get("memberCount").asInt()).isEqualTo(2); // 직속 1 + 하위 부서 1

    for (long user : List.of(devMemberId, backendMemberId)) {
      call(get("/api/v1/projects/{key}", team.key()), user)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.viewerRole").value("MEMBER"))
          .andExpect(jsonPath("$.viewerIsMember").value(true));
      call(get("/api/v1/projects/{key}/issues", team.key()), user).andExpect(status().isOk());
    }
    call(get("/api/v1/projects/{key}", team.key()), strangerId).andExpect(status().isNotFound());

    JsonNode list =
        json(
            call(get("/api/v1/projects/{key}/member-groups", team.key()), backendMemberId)
                .andExpect(status().isOk()));
    assertThat(list).hasSize(1);
    assertThat(list.get(0).get("memberCount").asInt()).isEqualTo(2);
  }

  /** OPEN 프로젝트에도 부서를 둘 수 있다 — 부서 구성원은 (테넌트 전원 읽기와 별개로) 멤버 역할을 받는다. */
  @Test
  void department_can_be_added_to_open_project() throws Exception {
    ProjectResponse open = project(ownerId, "OPEN");
    addGroup(open.key(), devId, "MEMBER").andExpect(status().isCreated());

    call(get("/api/v1/projects/{key}", open.key()), backendMemberId)
        .andExpect(jsonPath("$.viewerRole").value("MEMBER"));
    call(get("/api/v1/projects/{key}", open.key()), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.viewerRole").doesNotExist());
  }

  /** 부서에는 OWNER 를 줄 수 없고(400), 조직도 부서만(개인·없는 그룹 400), 개인 프로젝트는 409, 이미 둔 부서는 409. */
  @Test
  void rejects_owner_role_personal_group_personal_project_and_duplicates() throws Exception {
    addGroup(team.key(), devId, "OWNER").andExpect(status().isBadRequest());
    long personal = group("내그룹-" + suffix, "PERSONAL", null, ownerId);
    member(personal, strangerId);
    addGroup(team.key(), personal, null).andExpect(status().isBadRequest());
    addGroup(team.key(), -1L, null).andExpect(status().isBadRequest());

    ProjectResponse mine = project(ownerId, "PERSONAL");
    addGroup(mine.key(), devId, null).andExpect(status().isConflict());
    assertThat(dsl.fetchCount(PROJECT_MEMBER_GROUP)).isZero();

    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    addGroup(team.key(), devId, null).andExpect(status().isConflict());
  }

  /** 부서로 들어온 사람은 MEMBER 라 멤버 관리(부서·사람 추가)는 할 수 없다 — 403. */
  @Test
  void department_member_cannot_manage_members() throws Exception {
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    call(
            post("/api/v1/projects/{key}/member-groups", team.key())
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("groupId", backendId))),
            devMemberId)
        .andExpect(status().isForbidden());
  }

  /** 실효 역할은 높은 것 — 직접 OWNER + 부서 MEMBER → OWNER. 직접 MEMBER + 부서 → MEMBER(한 번만). */
  @Test
  void higher_role_wins() throws Exception {
    projectService.addMember(ownerId, team.key(), new AddMemberRequest(devMemberId, "OWNER"));
    addGroup(team.key(), devId, null).andExpect(status().isCreated());

    ProjectRow row = row(team);
    assertThat(guard.viewerRole(row, devMemberId)).isEqualTo("OWNER");
    assertThat(guard.isOwner(row, devMemberId)).isTrue();
    assertThat(guard.viewerRole(row, backendMemberId)).isEqualTo("MEMBER");
    assertThat(guard.isOwner(row, backendMemberId)).isFalse();
    call(get("/api/v1/projects/{key}", team.key()), devMemberId)
        .andExpect(jsonPath("$.viewerRole").value("OWNER"));
  }

  /**
   * 멤버 목록(담당자·멘션·필터 후보 원천)은 실효 멤버 — 직접 멤버(direct=true) 뒤에 부서로만 들어온 사람(direct=false, MEMBER). 직접·부서
   * 양쪽에 걸린 사람은 직접 행 하나로만 나온다. 실시간 알림 수신자도 같은 명단이다.
   */
  @Test
  void members_endpoint_returns_effective_members_for_candidates() throws Exception {
    projectService.addMember(ownerId, team.key(), new AddMemberRequest(devMemberId, "MEMBER"));
    addGroup(team.key(), devId, null).andExpect(status().isCreated());

    JsonNode members =
        json(
            call(get("/api/v1/projects/{key}/members", team.key()), backendMemberId)
                .andExpect(status().isOk()));
    List<Long> ids = new ArrayList<>();
    members.forEach(m -> ids.add(m.get("userId").asLong()));
    assertThat(ids).containsExactly(ownerId, devMemberId, backendMemberId);
    assertThat(members.get(1).get("direct").asBoolean()).isTrue();
    JsonNode backend = members.get(2);
    assertThat(backend.get("direct").asBoolean()).isFalse();
    assertThat(backend.get("role").asText()).isEqualTo("MEMBER");
    assertThat(backend.get("active").asBoolean()).isTrue();

    assertThat(memberRepository.findUserIdsByProject(team.id()))
        .containsExactlyInAnyOrder(ownerId, devMemberId, backendMemberId);
    // 프로젝트 카드의 멤버 이름 미리보기도 같은 명단(중복 없음).
    assertThat(memberRepository.findMemberNamesByProjects(List.of(team.id())).get(team.id()))
        .hasSize(3);
  }

  /** 부서로 들어온 사람도 담당자로 지정할 수 있다(AssigneePolicy 가 실효 멤버로 판정). 부서 밖 사람은 거절. */
  @Test
  void department_member_can_be_assigned() throws Exception {
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    issue(1);

    assign(1, List.of(backendMemberId)).andExpect(status().isOk());
    assign(1, List.of(strangerId)).andExpect(status().is4xxClientError());
  }

  /**
   * 부서 행을 빼면 부서로만 들어와 있던 사람은 멤버 제거와 같이 정리된다 — 담당 해제와 이력(행위자 = 뺀 사람), 진행 중 AI 작업 취소, 워처 정리. 직접 멤버로도
   * 들어와 있는 사람은 그대로 둔다.
   */
  @Test
  void removing_department_row_cleans_up_people_who_are_no_longer_members() throws Exception {
    long backend2Id = human("backend2");
    member(backendId, backend2Id);
    projectService.addMember(ownerId, team.key(), new AddMemberRequest(devMemberId, "MEMBER"));
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    long issueId = issue(1);
    assign(1, List.of(devMemberId, backendMemberId)).andExpect(status().isOk());
    watcherService.watch(backendMemberId, team.key(), 1);
    watcherService.watch(devMemberId, team.key(), 1);
    appEvents.clear();

    call(delete("/api/v1/projects/{key}/member-groups/{g}", team.key(), devId), ownerId)
        .andExpect(status().isNoContent());

    // 빠진 사람 전원이 project-member/deleted 한 번에 담긴다(사람마다 이벤트를 내지 않는다). 부서 id 는 project-member 에 싣지 않고
    // 부서 행
    // 리소스로 따로 알린다 — 제거 정리 리스너가 ids 를 사용자 id 로 읽기 때문이다.
    List<ResourceChangedEvent> memberEvents = resourceEvents("project-member");
    assertThat(memberEvents).hasSize(1);
    assertThat(memberEvents.get(0).op()).isEqualTo("deleted");
    assertThat(memberEvents.get(0).ids()).containsExactlyInAnyOrder(backendMemberId, backend2Id);
    List<ResourceChangedEvent> groupEvents = resourceEvents("project-member-group");
    assertThat(groupEvents).hasSize(1);
    assertThat(groupEvents.get(0).op()).isEqualTo("deleted");
    assertThat(groupEvents.get(0).ids()).containsExactly(devId);

    call(delete("/api/v1/projects/{key}/member-groups/{g}", team.key(), devId), ownerId)
        .andExpect(status().isNotFound());

    assertThat(assignees(issueId)).containsExactly(devMemberId);
    assertThat(unassignHistoryActors(issueId, backendMemberId)).containsExactly(ownerId);
    assertThat(unassignHistoryActors(issueId, devMemberId)).isEmpty();
    assertThat(watcherRepository.findUserIdsByIssue(issueId)).containsExactly(devMemberId);
    call(get("/api/v1/projects/{key}", team.key()), backendMemberId)
        .andExpect(status().isNotFound());
  }

  /** 직접 멤버 행을 빼도 부서로 여전히 멤버면 담당·워처는 그대로다(아직 프로젝트를 볼 수 있다). */
  @Test
  void removing_direct_row_keeps_assignment_while_department_grants_membership() throws Exception {
    projectService.addMember(ownerId, team.key(), new AddMemberRequest(devMemberId, "MEMBER"));
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    long issueId = issue(1);
    assign(1, List.of(devMemberId)).andExpect(status().isOk());
    watcherService.watch(devMemberId, team.key(), 1);

    // 제거 확인창의 영향 수 — 부서로 계속 멤버라 해제될 담당이 없다(0). 부서 행을 빼면 실제 담당 수가 보인다.
    assertThat(projectService.assignedIssueCount(ownerId, team.key(), devMemberId)).isZero();
    call(
            get("/api/v1/projects/{key}/members/{u}/assigned-issue-count", team.key(), devMemberId),
            ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(0));
    // 부서로 걸리지 않는 직접 멤버(소유자)는 담당 수 그대로.
    assign(1, List.of(devMemberId, ownerId)).andExpect(status().isOk());
    assertThat(projectService.assignedIssueCount(ownerId, team.key(), ownerId)).isEqualTo(1);

    projectService.removeMember(ownerId, team.key(), devMemberId);

    assertThat(assignees(issueId)).containsExactlyInAnyOrder(devMemberId, ownerId);
    assertThat(watcherRepository.findUserIdsByIssue(issueId)).contains(devMemberId);
    // 부서로만 들어온 사람은 직접 멤버 제거 대상이 아니다(404).
    assertThatThrownBy(() -> projectService.removeMember(ownerId, team.key(), backendMemberId))
        .isInstanceOf(ProjectNotFoundException.class);
  }

  /**
   * 조직도에서 부서를 빠지면 커밋 직전 정리가 그 사람을 멤버 제거와 같이 정리한다 — 부서 구성원 감소 이벤트가 영향받는 프로젝트의 변경 전 명단을 모으고, 정리 리스너가
   * 이제 실효 멤버가 아닌 사람만 담당 해제(이력)·AI 작업 취소한다.
   */
  @Test
  void leaving_department_cleans_up_like_member_removal() throws Exception {
    TestFixtures.grantRole(dsl, ownerId, "ADMIN"); // 조직도 쓰기 권한
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    long issueId = issue(1);
    assign(1, List.of(devMemberId, backendMemberId)).andExpect(status().isOk());
    long workId = activeAgentWork(issueId, backendMemberId);
    actAs(ownerId);
    appEvents.clear();

    groupService.removeMember(ownerId, backendId, "MEMBER", backendMemberId);

    List<ProjectDepartmentAudienceShrunk> events =
        appEvents.stream(ProjectDepartmentAudienceShrunk.class).toList();
    assertThat(events).hasSize(1);
    assertThat(events.get(0).before()).containsKey(team.id());
    memberGroupService.onDepartmentAudienceShrunk(events.get(0));

    assertThat(resourceEvents("project-member"))
        .singleElement()
        .satisfies(ev -> assertThat(ev.ids()).containsExactly(backendMemberId));
    assertThat(assignees(issueId)).containsExactly(devMemberId);
    assertThat(unassignHistoryActors(issueId, backendMemberId)).containsExactly(ownerId);
    assertThat(unassignHistoryActors(issueId, devMemberId)).isEmpty();
    assertThat(agentWorkState(workId)).isEqualTo("CANCELED");
  }

  /**
   * 구성원이 정지되면 부서로 들어와 있던 프로젝트에서 정리된다 — 정지는 부서 구성원 판정(활성 사람만)에서 빠진다. 관리 화면의 「활성 상태」 끄기(계정 비활성)가 곧 이
   * 정지다(WP-417 이후 전역 user.is_active 를 끄는 운영 경로는 없다, WP-1128). 멤버 제거와 같이 담당·AI 작업·워처를 모두 정리한다.
   */
  @Test
  void suspended_department_member_is_cleaned_up() throws Exception {
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    long issueId = issue(1);
    assign(1, List.of(backendMemberId)).andExpect(status().isOk());
    long workId = activeAgentWork(issueId, backendMemberId);
    watcherService.watch(backendMemberId, team.key(), 1);
    actAs(ownerId);

    TestFixtures.suspendMember(dsl, backendMemberId, 1L);
    memberGroupService.onWorkspaceMembershipSuspended(
        new WorkspaceMembershipSuspended(1L, backendMemberId));

    assertThat(assignees(issueId)).isEmpty();
    assertThat(unassignHistoryActors(issueId, backendMemberId)).containsExactly(ownerId);
    assertThat(agentWorkState(workId)).isEqualTo("CANCELED");
    assertThat(watcherRepository.findUserIdsByIssue(issueId)).doesNotContain(backendMemberId);
  }

  /**
   * 조직도에서 부서를 지우면 멤버 부서 행이 CASCADE 로 사라진다 — 빠지는 사람이 없어도(모두 직접 멤버) 영향받은 프로젝트에 부서 행 변경 알림이 가서 열어 둔 멤버
   * 창이 지워진 부서 행을 다시 받는다. 멤버 제거 알림(project-member/deleted)은 없다.
   */
  @Test
  void deleting_department_in_org_chart_notifies_member_groups_even_if_nobody_leaves()
      throws Exception {
    TestFixtures.grantRole(dsl, ownerId, "ADMIN"); // 조직도 쓰기 권한
    projectService.addMember(ownerId, team.key(), new AddMemberRequest(backendMemberId, "MEMBER"));
    addGroup(team.key(), backendId, null).andExpect(status().isCreated());
    actAs(ownerId);
    appEvents.clear();

    groupService.delete(ownerId, backendId);

    List<ProjectDepartmentAudienceShrunk> events =
        appEvents.stream(ProjectDepartmentAudienceShrunk.class).toList();
    assertThat(events).hasSize(1);
    assertThat(events.get(0).before()).containsKey(team.id());
    memberGroupService.onDepartmentAudienceShrunk(events.get(0));

    assertThat(dsl.fetchCount(PROJECT_MEMBER_GROUP)).isZero();
    assertThat(resourceEvents("project-member")).isEmpty();
    List<ResourceChangedEvent> groupEvents = resourceEvents("project-member-group");
    assertThat(groupEvents).hasSize(1);
    assertThat(groupEvents.get(0).op()).isEqualTo("updated");
    assertThat(groupEvents.get(0).scopeId()).isEqualTo(team.id());
    assertThat(guard.viewerRole(row(team), backendMemberId)).isEqualTo("MEMBER");
  }

  /** 부서를 지우면 멤버 부서 행도 사라지고(CASCADE) 그 구성원은 더 열 수 없다. */
  @Test
  void deleting_department_removes_row() throws Exception {
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    dsl.deleteFrom(USER_GROUP).where(USER_GROUP.ID.eq(devId)).execute();

    assertThat(dsl.fetchCount(PROJECT_MEMBER_GROUP)).isZero();
    call(get("/api/v1/projects/{key}", team.key()), devMemberId).andExpect(status().isNotFound());
  }

  /**
   * 가시성 판정(공용 ProjectMembership) — 프로젝트 목록, 내 프로젝트 라벨, 이슈 대화 참여, 이슈 참조 하이드레이션이 부서 멤버십을 따른다. 부서에서
   * 빠지면 다시 막힌다.
   */
  @Test
  void visibility_queries_honor_department_membership() throws Exception {
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    long issueId = issue(1);
    labelRepository.insert(team.id(), "라벨-" + suffix, "blue", ownerId);

    assertThat(projectKeys(backendMemberId)).contains(team.key());
    assertThat(labelRepository.findByMemberProjects(backendMemberId))
        .anySatisfy(l -> assertThat(l.projectId()).isEqualTo(team.id()));
    assertThat(stakeholderLookup.isProjectMember(team.id(), backendMemberId)).isTrue();
    assertThat(issueRepository.findVisibleRefsByIds(backendMemberId, List.of(issueId))).hasSize(1);
    // 이슈 알림 수신자 거르기 — 직접 멤버·부서(하위 부서 포함) 구성원은 남고 부서 밖 사람은 빠진다.
    assertThat(
            notificationRepository.filterCanReadIssue(
                issueId, List.of(ownerId, devMemberId, backendMemberId, strangerId)))
        .containsExactlyInAnyOrder(ownerId, devMemberId, backendMemberId);

    dsl.deleteFrom(USER_GROUP_MEMBER)
        .where(USER_GROUP_MEMBER.GROUP_ID.eq(backendId))
        .and(USER_GROUP_MEMBER.TARGET_ID.eq(backendMemberId))
        .execute();

    assertThat(projectKeys(backendMemberId)).doesNotContain(team.key());
    assertThat(labelRepository.findByMemberProjects(backendMemberId))
        .noneSatisfy(l -> assertThat(l.projectId()).isEqualTo(team.id()));
    assertThat(stakeholderLookup.isProjectMember(team.id(), backendMemberId)).isFalse();
    assertThat(issueRepository.findVisibleRefsByIds(backendMemberId, List.of(issueId))).isEmpty();
    assertThat(
            notificationRepository.filterCanReadIssue(
                issueId, List.of(ownerId, devMemberId, backendMemberId, strangerId)))
        .containsExactlyInAnyOrder(ownerId, devMemberId);
  }

  /** 접근 가드 메서드마다 부서 멤버십을 본다 — 부서 구성원은 MEMBER 판정을 통과하고 OWNER 판정은 통과하지 못한다. 부서 밖 사람은 모두 거절. */
  @Test
  void access_guard_methods_honor_department_membership() throws Exception {
    addGroup(team.key(), devId, null).andExpect(status().isCreated());
    ProjectRow row = row(team);

    assertThat(guard.canRead(row.id(), backendMemberId)).isTrue();
    assertThat(guard.isMemberOrAdmin(row, backendMemberId)).isTrue();
    assertThat(guard.viewerRole(row, backendMemberId)).isEqualTo("MEMBER");
    assertThat(guard.isOwner(row, backendMemberId)).isFalse();
    assertThat(guard.lockReadable(row, backendMemberId)).isTrue();
    assertThat(guard.assertMember(team.key(), backendMemberId).id()).isEqualTo(team.id());
    assertThat(guard.assertWithRole(team.key(), backendMemberId, "MEMBER").id())
        .isEqualTo(team.id());
    assertThatThrownBy(() -> guard.assertWithRole(team.key(), backendMemberId, "OWNER"))
        .isInstanceOf(RuntimeException.class);

    assertThat(guard.canRead(row.id(), strangerId)).isFalse();
    assertThat(guard.isMemberOrAdmin(row, strangerId)).isFalse();
    assertThat(guard.viewerRole(row, strangerId)).isNull();
    assertThat(guard.lockReadable(row, strangerId)).isFalse();
    assertThatThrownBy(() -> guard.assertMember(team.key(), strangerId))
        .isInstanceOf(RuntimeException.class);
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private ResultActions addGroup(String key, long groupId, String role) throws Exception {
    Map<String, Object> body = new java.util.HashMap<>();
    body.put("groupId", groupId);
    if (role != null) body.put("role", role);
    return call(
        post("/api/v1/projects/{key}/member-groups", key)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)),
        ownerId);
  }

  private ResultActions assign(int number, List<Long> userIds) throws Exception {
    return call(
        put("/api/v1/projects/{key}/issues/{n}/assignees", team.key(), number)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of("userIds", userIds))),
        ownerId);
  }

  private long issue(int number) {
    return IssueSeeds.insert(
            issueRepository, dsl, team.id(), number, "이슈-" + number, null, "MID", null, ownerId)
        .id();
  }

  private List<Long> assignees(long issueId) {
    return dsl.select(ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_ASSIGNEE.USER_ID);
  }

  /** 그 사람(removedUserId)을 담당에서 뺀 이력(ASSIGNEES_CHANGED 의 removed)의 행위자 — 담당 해제 이력이 남았는지 본다. */
  private List<Long> unassignHistoryActors(long issueId, long removedUserId) throws Exception {
    List<Long> actors = new ArrayList<>();
    for (var r :
        dsl.select(ISSUE_HISTORY.ACTOR_ID, ISSUE_HISTORY.TO_VALUE)
            .from(ISSUE_HISTORY)
            .where(ISSUE_HISTORY.ISSUE_ID.eq(issueId))
            .and(ISSUE_HISTORY.EVENT_TYPE.eq("ASSIGNEES_CHANGED"))
            .fetch()) {
      JsonNode removed = om.readTree(r.value2()).path("removed");
      for (JsonNode u : removed) {
        if (u.path("id").asLong() == removedUserId) actors.add(r.value1());
      }
    }
    return actors;
  }

  /** 담당자(workerId)의 진행 중 AI 작업 한 건을 시드한다. */
  private long activeAgentWork(long issueId, long workerId) {
    return dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, workerId)
        .set(AGENT_WORK.STATE, "WORKING")
        .returning(AGENT_WORK.ID)
        .fetchOne()
        .getId();
  }

  private String agentWorkState(long workId) {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ID.eq(workId))
        .fetchOne(AGENT_WORK.STATE);
  }

  /** 기록된 resource.changed 중 그 리소스의 것(발행 순). */
  private List<ResourceChangedEvent> resourceEvents(String resource) {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(ev -> resource.equals(ev.resource()))
        .toList();
  }

  /** 사용자에게 보이는 프로젝트 key — 목록 조회 본체(지연 프로비저닝은 별도 트랜잭션으로 커밋되므로 건너뛴다). */
  private List<String> projectKeys(long userId) {
    return projectService.queryProjects(userId, 0, 100).content().stream()
        .map(ProjectResponse::key)
        .toList();
  }

  private ProjectRow row(ProjectResponse p) {
    return projectRepository.findById(p.id()).orElseThrow();
  }

  /** 요청 밖 리스너(조직도 변경 뒤 정리)의 행위자 — 요청 사용자처럼 인증 주체를 세운다. */
  private void actAs(long userId) {
    SecurityContextHolder.getContext()
        .setAuthentication(new UsernamePasswordAuthenticationToken(userId, null, List.of()));
  }

  private ProjectResponse project(long owner, String type) {
    String key =
        "PG" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(owner, new CreateProjectRequest(key, "P-" + suffix, "x", type));
  }

  private long human(String prefix) {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }

  /** 그룹 시드 — PERSONAL 이면 owner 가 소유자. */
  private long group(String name, String visibility, Long parentId, Long owner) {
    return dsl.insertInto(USER_GROUP)
        .set(USER_GROUP.NAME, name)
        .set(USER_GROUP.VISIBILITY, visibility)
        .set(USER_GROUP.PARENT_ID, parentId)
        .set(USER_GROUP.OWNER_ID, owner)
        .returning(USER_GROUP.ID)
        .fetchOne()
        .getId();
  }

  private void member(long groupId, long userId) {
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, groupId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, userId)
        .execute();
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}

package com.workplace.project.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.MemberResponse;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.UpdateMemberRoleRequest;
import com.workplace.project.dto.UpdateProjectRequest;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.exception.UserNotFoundException;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** ProjectService 통합 테스트. 실제 DB + @Transactional 롤백 패턴. */
@Transactional
class ProjectServiceTest extends IntegrationTestBase {

  @Autowired private ProjectService projectService;
  @Autowired private ProjectIssueSequenceRepository sequenceRepository;
  @Autowired private DSLContext dsl;

  private Long ownerId;
  private Long otherUserId;

  @BeforeEach
  void setUp() {
    ownerId = createUser("owner");
    otherUserId = createUser("other");
  }

  /** 유니크 username 으로 사용자 시드. */
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
    // 테넌트#1 ACTIVE 멤버십 — MembershipGuard(#713) 가 addMember 대상의 테넌트 소속을 검증하므로 필요.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 유니크 key 생성 (대문자/숫자 2~10자). */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  /** 격리된 테스트용 테넌트 시드. */
  private Long seedTenant() {
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, "t713-project-" + System.nanoTime())
        .set(TENANT.NAME, "Other Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** tenant#1 이 아닌 다른 테넌트에만 소속된 사용자 시드 — 테넌트 경계 검증용. */
  private Long createUserInTenant(String prefix, Long tenantId) {
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
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /**
   * #713 — OWNER 가 현재 테넌트에 소속되지 않은(다른 테넌트) 사용자를 프로젝트 멤버로 등록할 수 없어야 한다. #843 부터는 없는 사용자와 같은 404 로
   * 응답한다(403 은 권한 문제로 오해되고, 타 테넌트 사용자 존재를 드러냄).
   */
  @Test
  void addMember_otherTenantUser_throwsUserNotFound() {
    Long owner = createUser("owner-ot713");
    Long otherTenantId = seedTenant();
    Long otherTenantUser = createUserInTenant("other-ot713", otherTenantId);
    String key = uniqueKey("OT7");
    projectService.create(owner, new CreateProjectRequest(key, "테넌트경계", null));

    assertThatThrownBy(
            () ->
                projectService.addMember(
                    owner, key, new AddMemberRequest(otherTenantUser, "MEMBER")))
        .isInstanceOf(UserNotFoundException.class);
  }

  /** 개인 프로젝트 멤버 목록: 합성 AGENT 주입 없음 — AGENT 추가 전에는 OWNER 만, 추가 후에는 실제 멤버 행만 (#418 정책 통일). */
  @Test
  void listMembers_personal_noSyntheticAgents() {
    Long owner = createUser("owner4");
    Long agent = createAgentUserWithMembership("bot");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "AI랑", null, "PERSONAL"));
    // AGENT 추가 전: OWNER 만 (합성 주입 없음)
    List<MemberResponse> before = projectService.listMembers(owner, personal.key());
    assertThat(before).hasSize(1);
    assertThat(before).anyMatch(m -> m.userId().equals(owner) && "OWNER".equals(m.role()));
    assertThat(before).noneMatch(m -> "AGENT".equals(m.kind()) && !m.userId().equals(owner));
    // AGENT 멤버 추가 후: 실제 AGENT 행 포함
    projectService.addMember(owner, personal.key(), new AddMemberRequest(agent, "MEMBER"));
    List<MemberResponse> after = projectService.listMembers(owner, personal.key());
    assertThat(after).anyMatch(m -> m.userId().equals(agent));
  }

  /** 개인 프로젝트: AGENT 멤버 추가 허용, HUMAN 추가는 여전히 거부 (#418 정책 통일). */
  @Test
  void addMember_personalProject_allowsAgent_rejectsHuman() {
    Long owner = createUser("owner-pa");
    Long agent = createAgentUserWithMembership("bot-pa");
    Long otherHuman = createUser("human-pa");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "개인PA", null, "PERSONAL"));
    // AGENT 추가 성공
    MemberResponse m =
        projectService.addMember(owner, personal.key(), new AddMemberRequest(agent, "MEMBER"));
    assertThat(m.userId()).isEqualTo(agent);
    assertThat(m.role()).isEqualTo("MEMBER"); // 개인 프로젝트 AGENT 는 항상 MEMBER 강제
    // HUMAN 추가는 거부
    assertThatThrownBy(
            () ->
                projectService.addMember(
                    owner, personal.key(), new AddMemberRequest(otherHuman, "MEMBER")))
        .isInstanceOf(ProjectConflictException.class);
  }

  @Test
  void create_initializesSequenceAndAddsOwnerMember() {
    String key = uniqueKey("WP");
    ProjectResponse resp =
        projectService.create(ownerId, new CreateProjectRequest(key, "Workplace", "v1"));

    assertThat(resp.key()).isEqualTo(key);
    assertThat(resp.ownerId()).isEqualTo(ownerId);

    // project 행 존재
    boolean projectExists =
        dsl.fetchExists(dsl.selectOne().from(PROJECT).where(PROJECT.KEY.eq(key)));
    assertThat(projectExists).isTrue();

    // project_member 에 OWNER 행
    String role =
        dsl.select(PROJECT_MEMBER.ROLE)
            .from(PROJECT_MEMBER)
            .where(PROJECT_MEMBER.PROJECT_ID.eq(resp.id()).and(PROJECT_MEMBER.USER_ID.eq(ownerId)))
            .fetchOne(PROJECT_MEMBER.ROLE);
    assertThat(role).isEqualTo("OWNER");

    // project_issue_sequence 시퀀스 초기화 (next_number=1)
    Integer nextNumber =
        dsl.select(PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER)
            .from(PROJECT_ISSUE_SEQUENCE)
            .where(PROJECT_ISSUE_SEQUENCE.PROJECT_ID.eq(resp.id()))
            .fetchOne(PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER);
    assertThat(nextNumber).isEqualTo(1);

    // allocateNext 동작: 1 발급되고 next_number=2 가 됨
    int allocated = sequenceRepository.allocateNext(resp.id());
    assertThat(allocated).isEqualTo(1);
  }

  @Test
  void create_team_setsTypeTeamAndNotDefault() {
    String key = uniqueKey("WP");
    ProjectResponse resp =
        projectService.create(ownerId, new CreateProjectRequest(key, "Workplace", "v1", "TEAM"));
    assertThat(resp.type()).isEqualTo("TEAM");
    assertThat(resp.isDefault()).isFalse();
  }

  @Test
  void create_personal_autoGeneratesKeyAndSetsType() {
    ProjectResponse resp =
        projectService.create(ownerId, new CreateProjectRequest(null, "사이드 토이", null, "PERSONAL"));
    assertThat(resp.type()).isEqualTo("PERSONAL");
    assertThat(resp.isDefault()).isFalse();
    assertThat(resp.key()).startsWith("P");
    assertThat(resp.name()).isEqualTo("사이드 토이");
    String role =
        dsl.select(PROJECT_MEMBER.ROLE)
            .from(PROJECT_MEMBER)
            .where(PROJECT_MEMBER.PROJECT_ID.eq(resp.id()).and(PROJECT_MEMBER.USER_ID.eq(ownerId)))
            .fetchOne(PROJECT_MEMBER.ROLE);
    assertThat(role).isEqualTo("OWNER");
  }

  @Test
  void create_duplicateKey_throwsConflict() {
    String key = uniqueKey("DUP");
    projectService.create(ownerId, new CreateProjectRequest(key, "First", null));

    assertThatThrownBy(
            () -> projectService.create(ownerId, new CreateProjectRequest(key, "Second", null)))
        .isInstanceOf(ProjectConflictException.class);
  }

  /** 삭제된 프로젝트의 key 는 예약 유지하되, 거절 문구가 삭제된 프로젝트 몫임을 알린다(WP-692). */
  @Test
  void create_keyOfDeletedProject_throwsConflictWithDeletedMessage() {
    String key = uniqueKey("GONE");
    projectService.create(ownerId, new CreateProjectRequest(key, "Old", null));
    projectService.softDelete(ownerId, key);

    assertThatThrownBy(
            () -> projectService.create(ownerId, new CreateProjectRequest(key, "New", null)))
        .isInstanceOf(ProjectConflictException.class)
        .hasMessage("삭제된 프로젝트가 쓰던 key 라 다시 쓸 수 없습니다: " + key + " — 다른 key 를 써 주세요");
  }

  /** 지금 쓰는 프로젝트의 key 는 기존 문구 그대로(WP-692). */
  @Test
  void create_keyOfLiveProject_keepsInUseMessage() {
    String key = uniqueKey("LIVE");
    projectService.create(ownerId, new CreateProjectRequest(key, "First", null));

    assertThatThrownBy(
            () -> projectService.create(ownerId, new CreateProjectRequest(key, "Second", null)))
        .isInstanceOf(ProjectConflictException.class)
        .hasMessage("이미 사용 중인 key 입니다: " + key);
  }

  @Test
  void softDelete_byOwner_marksDeleted() {
    String key = uniqueKey("DEL");
    projectService.create(ownerId, new CreateProjectRequest(key, "ToDelete", null));

    projectService.softDelete(ownerId, key);

    // soft-deleted 는 findByKey 에서 제외 → assertMember 에서 ProjectNotFoundException
    assertThatThrownBy(() -> projectService.get(ownerId, key))
        .isInstanceOf(ProjectNotFoundException.class);
  }

  @Test
  void softDelete_byNonOwner_throwsAccessDenied() {
    String key = uniqueKey("ND");
    ProjectResponse p = projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));

    // otherUserId 를 MEMBER 로 추가
    projectService.addMember(ownerId, key, new AddMemberRequest(otherUserId, "MEMBER"));
    assertThat(p.id()).isNotNull();

    // MEMBER 가 삭제 시도 → 거부
    assertThatThrownBy(() -> projectService.softDelete(otherUserId, key))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void updateMemberRole_lastOwnerDemotion_throwsConflict() {
    String key = uniqueKey("LO");
    projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));

    // OWNER 1명만 있는 상태에서 그 OWNER 를 MEMBER 로 강등
    assertThatThrownBy(
            () ->
                projectService.updateMemberRole(
                    ownerId, key, ownerId, new UpdateMemberRoleRequest("MEMBER")))
        .isInstanceOf(ProjectConflictException.class);
  }

  /**
   * WP-856: 개인 프로젝트에서 주인이 아닌 멤버(AGENT)는 역할 변경으로도 OWNER 가 될 수 없다 — 추가 경로의 「AGENT 는 MEMBER 고정」과 같은
   * 규칙. 확인 카드 사전검증(dry-run)도 같은 술어로 거절한다.
   */
  @Test
  void updateMemberRole_personalAgentToOwner_throwsConflict() {
    Long agent = createAgentUserWithMembership("bot-po");
    ProjectResponse personal = personalProjectWith(agent);

    var toOwner = new UpdateMemberRoleRequest("OWNER");
    assertThatThrownBy(
            () -> projectService.validateUpdateMemberRole(ownerId, personal.key(), agent, toOwner))
        .isInstanceOf(ProjectConflictException.class);
    assertThatThrownBy(
            () -> projectService.updateMemberRole(ownerId, personal.key(), agent, toOwner))
        .isInstanceOf(ProjectConflictException.class)
        .hasMessage("개인 프로젝트는 주인만 소유자가 될 수 있습니다");
    assertThat(memberRole(personal.id(), agent)).isEqualTo("MEMBER");
  }

  /**
   * WP-856: 개인 프로젝트 주인(사람)은 강등·제거할 수 없다 — 다른 소유자가 있어도(이전 결함으로 AGENT 가 OWNER 가 된 데이터) 사람이 자기 공간의 권한을
   * 잃지 않게 막는다. 그런 AGENT 를 MEMBER 로 되돌리는 것은 허용한다.
   */
  @Test
  void updateMemberRole_personalOwnerDemotionOrRemoval_throwsConflict_agentDemotionAllowed() {
    Long agent = createAgentUserWithMembership("bot-pd");
    ProjectResponse personal = personalProjectWith(agent);
    // 이전 결함으로 AGENT 가 OWNER 로 올라간 상태를 직접 만든다.
    setRole(personal.id(), agent, "OWNER");

    assertThatThrownBy(
            () ->
                projectService.updateMemberRole(
                    ownerId, personal.key(), ownerId, new UpdateMemberRoleRequest("MEMBER")))
        .isInstanceOf(ProjectConflictException.class)
        .hasMessage("개인 프로젝트 주인의 역할은 바꿀 수 없습니다");
    assertThat(memberRole(personal.id(), ownerId)).isEqualTo("OWNER");

    // 주인 제거도 막는다 — 다른 소유자(AGENT)가 남아 있어도.
    assertThatThrownBy(() -> projectService.removeMember(ownerId, personal.key(), ownerId))
        .isInstanceOf(ProjectConflictException.class)
        .hasMessage("개인 프로젝트 주인은 제거할 수 없습니다");
    assertThatThrownBy(() -> projectService.validateRemoveMember(ownerId, personal.key(), ownerId))
        .isInstanceOf(ProjectConflictException.class);

    projectService.updateMemberRole(
        ownerId, personal.key(), agent, new UpdateMemberRoleRequest("MEMBER"));
    assertThat(memberRole(personal.id(), agent)).isEqualTo("MEMBER");
  }

  /** ownerId 가 주인인 개인 프로젝트를 만들고 AGENT 를 멤버로 넣는다. */
  private ProjectResponse personalProjectWith(Long agent) {
    ProjectResponse personal =
        projectService.create(ownerId, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    projectService.addMember(ownerId, personal.key(), new AddMemberRequest(agent, "MEMBER"));
    return personal;
  }

  /** 프로젝트 멤버 역할을 DB 에 직접 쓴다 — 이전 결함이 남긴 상태를 만들 때. */
  private void setRole(Long projectId, Long userId, String role) {
    dsl.update(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.ROLE, role)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .and(PROJECT_MEMBER.USER_ID.eq(userId))
        .execute();
  }

  /** WP-856 범위 밖: 팀 프로젝트의 AGENT OWNER 허용 여부는 정책 판단이라 지금 동작(허용)을 그대로 둔다. */
  @Test
  void updateMemberRole_teamAgentToOwner_unchanged() {
    Long agent = createAgentUserWithMembership("bot-to");
    String key = uniqueKey("TO");
    ProjectResponse team =
        projectService.create(ownerId, new CreateProjectRequest(key, "팀TO", null));
    projectService.addMember(ownerId, key, new AddMemberRequest(agent, "MEMBER"));

    projectService.updateMemberRole(ownerId, key, agent, new UpdateMemberRoleRequest("OWNER"));
    assertThat(memberRole(team.id(), agent)).isEqualTo("OWNER");
  }

  /** 프로젝트 멤버의 현재 역할 — DB 에서 직접 읽는다. */
  private String memberRole(Long projectId, Long userId) {
    return dsl.select(PROJECT_MEMBER.ROLE)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .and(PROJECT_MEMBER.USER_ID.eq(userId))
        .fetchOne(PROJECT_MEMBER.ROLE);
  }

  @Test
  void removeMember_lastOwner_throwsConflict() {
    String key = uniqueKey("RM");
    projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));

    assertThatThrownBy(() -> projectService.removeMember(ownerId, key, ownerId))
        .isInstanceOf(ProjectConflictException.class);
  }

  /**
   * #714 — 담당자로 걸린 멤버를 제거하면 issue_assignee 매핑도 함께 정리되어야 한다 (AssigneePolicy 불변식을 멤버십 철회 시점에도 유지).
   */
  @Test
  void removeMember_cleansUpIssueAssigneeMappings() {
    String key = uniqueKey("GA");
    ProjectResponse project =
        projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));
    projectService.addMember(ownerId, key, new AddMemberRequest(otherUserId, "MEMBER"));

    long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(project.id()))
            .limit(1)
            .fetchOne(ISSUE_TYPE_DEF.ID);
    Long issueId =
        dsl.insertInto(ISSUE)
            .set(ISSUE.PROJECT_ID, project.id())
            .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(project.id(), "TODO"))
            .set(ISSUE.NUMBER, 1)
            .set(ISSUE.TITLE, "유령 담당자 테스트")
            .set(ISSUE.REPORTER_ID, ownerId)
            .set(ISSUE.TYPE_ID, typeId)
            .returning(ISSUE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, otherUserId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, ownerId)
        .execute();

    projectService.removeMember(ownerId, key, otherUserId);

    boolean stillAssigned =
        dsl.fetchExists(
            dsl.selectFrom(ISSUE_ASSIGNEE)
                .where(
                    ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId), ISSUE_ASSIGNEE.USER_ID.eq(otherUserId)));
    assertThat(stillAssigned).isFalse();
    // WP-488 — 조용히 지우지 않고 이슈 이력에 「담당자 해제」를 남긴다(행위자 = 제거한 사람).
    var history =
        dsl.selectFrom(ISSUE_HISTORY)
            .where(
                ISSUE_HISTORY.ISSUE_ID.eq(issueId),
                ISSUE_HISTORY.EVENT_TYPE.eq("ASSIGNEES_CHANGED"))
            .fetch();
    assertThat(history).hasSize(1);
    assertThat(history.get(0).getActorId()).isEqualTo(ownerId);
    assertThat(history.get(0).getToValue())
        .contains("\"removed\"")
        .contains("\"id\":" + otherUserId);
  }

  /** WP-488 — 멤버 제거 확인창이 담당 중인 이슈 수를 알리도록 센다(삭제된 이슈는 빼고). */
  @Test
  void assignedIssueCount_countsLiveIssuesOfTheMember() {
    String key = uniqueKey("GC");
    ProjectResponse project =
        projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));
    projectService.addMember(ownerId, key, new AddMemberRequest(otherUserId, "MEMBER"));
    long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(project.id()))
            .limit(1)
            .fetchOne(ISSUE_TYPE_DEF.ID);
    for (int n = 1; n <= 3; n++) {
      Long id =
          dsl.insertInto(ISSUE)
              .set(ISSUE.PROJECT_ID, project.id())
              .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(project.id(), "TODO"))
              .set(ISSUE.NUMBER, n)
              .set(ISSUE.TITLE, "i" + n)
              .set(ISSUE.REPORTER_ID, ownerId)
              .set(ISSUE.TYPE_ID, typeId)
              .set(ISSUE.DELETED_AT, n == 3 ? java.time.OffsetDateTime.now() : null)
              .returning(ISSUE.ID)
              .fetchOne()
              .getId();
      dsl.insertInto(ISSUE_ASSIGNEE)
          .set(ISSUE_ASSIGNEE.ISSUE_ID, id)
          .set(ISSUE_ASSIGNEE.USER_ID, otherUserId)
          .set(ISSUE_ASSIGNEE.ASSIGNED_BY, ownerId)
          .execute();
    }

    assertThat(projectService.assignedIssueCount(ownerId, key, otherUserId)).isEqualTo(2);
    assertThat(projectService.assignedIssueCount(ownerId, key, ownerId)).isZero();
  }

  @Test
  void addMember_duplicate_throwsConflict() {
    String key = uniqueKey("AD");
    projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));

    MemberResponse first =
        projectService.addMember(ownerId, key, new AddMemberRequest(otherUserId, "MEMBER"));
    assertThat(first.userId()).isEqualTo(otherUserId);

    assertThatThrownBy(
            () ->
                projectService.addMember(ownerId, key, new AddMemberRequest(otherUserId, "MEMBER")))
        .isInstanceOf(ProjectConflictException.class);
  }

  /** 개인 프로젝트에는 사람(HUMAN) 멤버를 추가할 수 없음 — AGENT 만 허용 (#418 정책 통일). */
  @Test
  void addMember_blockedOnPersonalProject_forHuman() {
    ProjectResponse personal =
        projectService.create(ownerId, new CreateProjectRequest(null, "혼자", null, "PERSONAL"));
    assertThatThrownBy(
            () ->
                projectService.addMember(
                    ownerId, personal.key(), new AddMemberRequest(otherUserId, "MEMBER")))
        .isInstanceOf(ProjectConflictException.class);
  }

  /** 비활성화(is_active=false)된 사용자는 신규 멤버로 추가할 수 없다 (#624). */
  @Test
  void addMember_inactiveUser_throwsConflict() {
    String key = uniqueKey("IA");
    projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(otherUserId)).execute();

    assertThatThrownBy(
            () ->
                projectService.addMember(ownerId, key, new AddMemberRequest(otherUserId, "MEMBER")))
        .isInstanceOf(ProjectConflictException.class);
  }

  /**
   * WP-417: 이 워크스페이스에서 정지(멤버십 SUSPENDED)된 구성원은 "없는 사용자(404)"가 아니라 비활성 409 로 거부한다(테넌트 비멤버는 그대로 404).
   */
  @Test
  void addMember_workspaceSuspendedUser_throwsConflictNotNotFound() {
    String key = uniqueKey("SU");
    projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));
    TestFixtures.suspendMember(dsl, otherUserId, 1L);

    assertThatThrownBy(
            () ->
                projectService.addMember(ownerId, key, new AddMemberRequest(otherUserId, "MEMBER")))
        .isInstanceOf(ProjectConflictException.class)
        .hasMessageContaining("비활성화된 사용자는 멤버로 추가할 수 없습니다");
  }

  /** listMembers 응답 MemberResponse 에 active 필드가 사용자의 실제 is_active 값을 반영한다 (#624). */
  @Test
  void listMembers_exposesActiveField() {
    String key = uniqueKey("AC");
    projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));
    projectService.addMember(ownerId, key, new AddMemberRequest(otherUserId, "MEMBER"));
    // 멤버 추가 이후 비활성화 — addMember 는 시점 검증만 하고, 상태 필드는 read 경로에서 실시간 반영되어야 한다.
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(otherUserId)).execute();

    List<MemberResponse> members = projectService.listMembers(ownerId, key);

    assertThat(members)
        .anySatisfy(
            m -> {
              if (m.userId().equals(otherUserId)) {
                assertThat(m.active()).isFalse();
              }
            });
    assertThat(members).anyMatch(m -> m.userId().equals(ownerId) && m.active());
  }

  /** #858 — name 만 보내면 설명은 그대로 남는다(이전엔 전체 덮어쓰기라 null 로 지워졌다). */
  @Test
  void update_nameOnly_keepsDescription() {
    String key = uniqueKey("PU");
    projectService.create(ownerId, new CreateProjectRequest(key, "원래이름", "원래설명"));

    ProjectResponse updated =
        projectService.update(
            ownerId, key, new UpdateProjectRequest("새이름", null, null, null, null));

    assertThat(updated.name()).isEqualTo("새이름");
    assertThat(updated.description()).isEqualTo("원래설명");
  }

  /** #858 — 설명만 보내면 이름은 그대로, clearDescription 이면 설명이 비워진다. */
  @Test
  void update_descriptionOnly_andClear() {
    String key = uniqueKey("PD");
    projectService.create(ownerId, new CreateProjectRequest(key, "이름", "설명"));

    ProjectResponse described =
        projectService.update(
            ownerId, key, new UpdateProjectRequest(null, "새설명", null, null, null));
    assertThat(described.name()).isEqualTo("이름");
    assertThat(described.description()).isEqualTo("새설명");

    ProjectResponse cleared =
        projectService.update(ownerId, key, new UpdateProjectRequest(null, null, true, null, null));
    assertThat(cleared.name()).isEqualTo("이름");
    assertThat(cleared.description()).isNull();
  }

  /** WP-1011 — 연결된 저장소는 보낸 칸만 바뀌고(이름·설명 그대로), 빈 문자열로 보내면 지워진다. 다른 칸만 고쳐도 남아 있다. */
  @Test
  void update_repository_setKeepAndClear() {
    String key = uniqueKey("PR");
    projectService.create(ownerId, new CreateProjectRequest(key, "이름", "설명"));

    ProjectResponse linked =
        projectService.update(
            ownerId,
            key,
            new UpdateProjectRequest(
                null, null, null, " https://github.com/acme/app.git ", "develop"));
    assertThat(linked.repositoryUrl()).isEqualTo("https://github.com/acme/app.git");
    assertThat(linked.repositoryBranch()).isEqualTo("develop");
    assertThat(linked.name()).isEqualTo("이름");
    assertThat(linked.description()).isEqualTo("설명");

    ProjectResponse renamed =
        projectService.update(
            ownerId, key, new UpdateProjectRequest("새이름", null, null, null, null));
    assertThat(renamed.repositoryUrl()).isEqualTo("https://github.com/acme/app.git");
    assertThat(projectService.get(ownerId, key).repositoryBranch()).isEqualTo("develop");

    // 주소만 지워도 브랜치가 함께 지워진다 — 다음에 다른 저장소를 연결할 때 옛 브랜치가 따라붙지 않게.
    ProjectResponse cleared =
        projectService.update(ownerId, key, new UpdateProjectRequest(null, null, null, "", null));
    assertThat(cleared.repositoryUrl()).isNull();
    assertThat(cleared.repositoryBranch()).isNull();
  }
}

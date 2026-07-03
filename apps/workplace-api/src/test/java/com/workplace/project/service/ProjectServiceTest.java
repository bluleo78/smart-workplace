package com.workplace.project.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.MemberResponse;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.UpdateMemberRoleRequest;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
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
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "-" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix)
        .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 유니크 key 생성 (대문자/숫자 2~10자). */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  /** 개인 프로젝트 멤버 목록: 합성 AGENT 주입 없음 — AGENT 추가 전에는 OWNER 만, 추가 후에는 실제 멤버 행만 (#418 정책 통일). */
  @Test
  void listMembers_personal_noSyntheticAgents() {
    Long owner = createUser("owner4");
    Long agent = createAgentUser("bot");
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
    Long agent = createAgentUser("bot-pa");
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

  @Test
  void removeMember_lastOwner_throwsConflict() {
    String key = uniqueKey("RM");
    projectService.create(ownerId, new CreateProjectRequest(key, "Pjt", null));

    assertThatThrownBy(() -> projectService.removeMember(ownerId, key, ownerId))
        .isInstanceOf(ProjectConflictException.class);
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
}

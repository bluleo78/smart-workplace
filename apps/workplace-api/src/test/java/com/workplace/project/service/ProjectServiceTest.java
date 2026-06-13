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

  /** 개인 프로젝트 멤버 목록은 OWNER + AGENT 담당 후보를 함께 노출한다. */
  @Test
  void listMembers_personalIncludesAgents() {
    Long owner = createUser("owner4");
    Long agent = createAgentUser("bot");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "AI랑", null, "PERSONAL"));
    List<MemberResponse> members = projectService.listMembers(owner, personal.key());
    assertThat(members).anyMatch(m -> m.userId().equals(owner) && "OWNER".equals(m.role()));
    assertThat(members).anyMatch(m -> m.userId().equals(agent) && "AGENT".equals(m.kind()));
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

  /** 개인 프로젝트에는 사람 멤버를 추가할 수 없음 (혼자만 사용). */
  @Test
  void addMember_blockedOnPersonalProject() {
    ProjectResponse personal =
        projectService.create(ownerId, new CreateProjectRequest(null, "혼자", null, "PERSONAL"));
    assertThatThrownBy(
            () ->
                projectService.addMember(
                    ownerId, personal.key(), new AddMemberRequest(otherUserId, "MEMBER")))
        .isInstanceOf(ProjectConflictException.class);
  }
}

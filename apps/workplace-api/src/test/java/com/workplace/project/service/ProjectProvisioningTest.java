package com.workplace.project.service;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.dto.PageResponse;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 기본 개인 프로젝트 지연 프로비저닝 통합 테스트.
 *
 * <p>provisioner.ensureDefaultPersonal 은 REQUIRES_NEW 서브 트랜잭션에서 실제로 커밋하므로 클래스-레벨 @Transactional
 * 롤백으로는 격리되지 않는다(커밋된 caller 가 필요하고, 생성된 "개인 작업" 프로젝트가 롤백을 통과해 잔존). 따라서 비-Tx 로 두고 자기-id
 * 스코프 @AfterEach 로 회수한다 — project.owner_id 는 CASCADE 아님이라 project 를 먼저
 * 삭제(member/sequence/issue_type CASCADE), 다음 user_role, 마지막 user 순.
 */
class ProjectProvisioningTest extends IntegrationTestBase {

  @Autowired private ProjectService projectService;
  @Autowired private ProjectRepository projectRepository;
  @Autowired private DSLContext dsl;

  // 만든 user id 추적 → @AfterEach 에서 project(소유)+user_role+user 회수 (병렬세션 안전: 전역 truncate 금지).
  private final List<Long> createdUserIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (createdUserIds.isEmpty()) return;
    // project.owner_id 는 ON DELETE CASCADE 아님 → project 를 먼저 지워야 user 삭제 가능.
    dsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.in(createdUserIds)).execute();
    dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(createdUserIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
  }

  /** 유니크 username 으로 HUMAN 사용자 시드 후 id 추적. */
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
    createdUserIds.add(id);
    return id;
  }

  /** role_name 의 역할을 user 에게 부여. */
  private void grantRole(Long userId, String roleName) {
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  /** 유니크 key 생성 (대문자/숫자 2~10자). */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  @Test
  void list_provisionsDefaultPersonalForHuman() {
    Long human = createUser("solo");
    var page = projectService.list(human, 0, 50);
    long defaults =
        page.content().stream().filter(p -> "PERSONAL".equals(p.type()) && p.isDefault()).count();
    assertThat(defaults).isEqualTo(1);
    // 두 번째 호출에서도 기본 개인 프로젝트는 정확히 1개 (멱등 — 이미 존재하면 추가 생성 안 함).
    var page2 = projectService.list(human, 0, 50);
    long defaults2 =
        page2.content().stream().filter(p -> "PERSONAL".equals(p.type()) && p.isDefault()).count();
    assertThat(defaults2).isEqualTo(1);
  }

  @Test
  void list_callerIsAdmin_returnsAllActiveProjects() {
    Long ownerId = createUser("owner");
    Long otherUserId = createUser("other");
    // other 가 만든 프로젝트 — owner 는 멤버 아님
    String key = uniqueKey("ADM");
    projectService.create(otherUserId, new CreateProjectRequest(key, "By Other", null));

    // owner 에게 ADMIN 역할 부여
    grantRole(ownerId, "ADMIN");

    PageResponse<ProjectResponse> result = projectService.list(ownerId, 0, 50);
    assertThat(result.content().stream().anyMatch(p -> p.key().equals(key))).isTrue();
  }

  @Test
  void list_callerIsNotMember_excludesProject() {
    Long ownerId = createUser("owner");
    Long otherUserId = createUser("other");
    // other 가 만든 프로젝트
    String key = uniqueKey("EX");
    projectService.create(otherUserId, new CreateProjectRequest(key, "By Other", null));

    // owner 는 비-멤버, 비-ADMIN
    PageResponse<ProjectResponse> result = projectService.list(ownerId, 0, 50);
    assertThat(result.content().stream().noneMatch(p -> p.key().equals(key))).isTrue();
  }

  /** ADMIN 은 모든 TEAM 을 보지만 남의 PERSONAL 은 보면 안 됨 (완전 비공개). */
  @Test
  void list_adminDoesNotSeeOthersPersonal() {
    Long other = createUser("other");
    projectService.create(other, new CreateProjectRequest(null, "남의 개인", null, "PERSONAL"));
    Long admin = createUser("admin");
    grantRole(admin, "ADMIN");
    var page = projectService.list(admin, 0, 100);
    boolean seesOthersPersonal =
        page.content().stream()
            .anyMatch(p -> "PERSONAL".equals(p.type()) && p.ownerId().equals(other));
    assertThat(seesOthersPersonal).isFalse();
    // 단, 본인이 프로비저닝받은 기본 개인 프로젝트는 ADMIN 도 본인 것이므로 보여야 함
    boolean seesOwnPersonal =
        page.content().stream()
            .anyMatch(p -> "PERSONAL".equals(p.type()) && p.ownerId().equals(admin));
    assertThat(seesOwnPersonal).isTrue();
  }

  /** 기본 개인 프로젝트(is_default)는 삭제 차단 — OWNER 라도 불가. */
  @Test
  void softDelete_blocksDefaultPersonal() {
    Long human = createUser("solo2");
    projectService.list(human, 0, 10); // 기본 개인 프로젝트 프로비저닝
    ProjectRow def = projectRepository.findDefaultPersonal(human).orElseThrow();
    assertThatThrownBy(() -> projectService.softDelete(human, def.key()))
        .isInstanceOf(ProjectConflictException.class);
  }

  /** 기본이 아닌 개인 프로젝트는 소유자가 삭제 가능 (positive path). */
  @Test
  void softDelete_allowsNonDefaultPersonal() {
    Long human = createUser("solo3");
    var personal =
        projectService.create(human, new CreateProjectRequest(null, "삭제가능", null, "PERSONAL"));
    assertThatCode(() -> projectService.softDelete(human, personal.key()))
        .doesNotThrowAnyException();
  }
}

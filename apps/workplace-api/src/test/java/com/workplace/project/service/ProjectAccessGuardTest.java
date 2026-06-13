package com.workplace.project.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * ProjectAccessGuard 통합 테스트. PERSONAL 프로젝트는 ADMIN 도 우회할 수 없고 소유자만 접근 가능함을 검증.
 *
 * <p>list() 를 호출하지 않으므로(REQUIRES_NEW 프로비저닝 없음) 클래스-레벨 @Transactional 롤백으로 격리된다. create() 의 PERSONAL
 * 경로(createPersonal)는 별도 propagation 없이 테스트 트랜잭션에 합류하므로 같은 tx 내에서 accessGuard 에 보인다.
 */
@Transactional
class ProjectAccessGuardTest extends IntegrationTestBase {

  @Autowired private ProjectAccessGuard accessGuard;
  @Autowired private ProjectService projectService;
  @Autowired private DSLContext dsl;

  /** 유니크 username 으로 HUMAN 사용자 시드. */
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

  /** role_name 의 역할을 user 에게 부여. */
  private void grantRole(Long userId, String roleName) {
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  /** PERSONAL 은 ADMIN(비소유자)도 거부하고 소유자만 통과. */
  @Test
  void assertMember_personalDeniesAdminNonOwner() {
    Long owner = createUser("owner");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "내 비밀", null, "PERSONAL"));
    Long admin = createUser("admin");
    grantRole(admin, "ADMIN");
    assertThatThrownBy(() -> accessGuard.assertMember(personal.key(), admin))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatCode(() -> accessGuard.assertMember(personal.key(), owner))
        .doesNotThrowAnyException();
  }
}

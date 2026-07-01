package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.TenantScopedIntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 이슈 삭제 권한 통합 테스트.
 *
 * <p>삭제 허용: OPEN 비멤버 reporter 본인, 프로젝트 OWNER, TEAM/OPEN ADMIN. 삭제 거부: 비멤버·비reporter stranger(403).
 */
@Transactional
class OpenIssueDeleteTest extends TenantScopedIntegrationTest {

  @Autowired IssueService issueService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  private OpenScenario.Result openScenario() {
    return OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  private OpenScenario.Result teamScenario() {
    return OpenScenario.createTeam(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  /**
   * OPEN 비멤버 reporter 는 자신이 생성한 이슈를 삭제할 수 있다. 기존 assertMember 선검증이 남아 있으면
   * ProjectAccessDeniedException 으로 실패(RED 단계 확인 지점).
   */
  @Test
  void open_non_member_reporter_deletes_own_issue() {
    var s = openScenario();
    assertThatCode(() -> issueService.softDelete(s.reporterId(), s.projectKey(), s.issueNumber()))
        .doesNotThrowAnyException();
  }

  /** 비멤버·비reporter stranger 는 OPEN 이슈를 삭제할 수 없다 — 403. */
  @Test
  void open_stranger_cannot_delete() {
    var s = openScenario();
    assertThatThrownBy(
            () -> issueService.softDelete(s.strangerId(), s.projectKey(), s.issueNumber()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /**
   * OPEN 프로젝트에서 비멤버·비reporter — 즉 테넌트 소속으로 자신만의 이슈를 생성할 수 있는 유효한 사용자이지만 해당 이슈의 reporter 가 아닌 경우 — 는
   * 타인의 이슈를 삭제할 수 없다.
   *
   * <p>보안 경계 핀: reporter 가 되면 삭제할 수 있다는 권한이 "나의 이슈"에만 국한됨을 명시한다. {@code softDelete} 의 {@code
   * isReporter = row.reporterId().equals(callerId)} 가드가 다른 사용자(stranger)에 대해 false 를 반환해 {@link
   * ProjectAccessDeniedException} 으로 이어져야 한다.
   */
  @Test
  void open_non_reporter_non_member_cannot_delete() {
    var s = openScenario();
    // strangerId: 동일 테넌트 소속·비멤버·이슈의 reporter 가 아닌 별개 사용자.
    // OPEN 프로젝트에서 자신의 이슈는 생성 가능하지만, 타인(reporterId)의 이슈는 삭제 불가.
    assertThatThrownBy(
            () -> issueService.softDelete(s.strangerId(), s.projectKey(), s.issueNumber()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /**
   * ADMIN 역할을 가진 사용자는 TEAM 프로젝트 이슈를 삭제할 수 있다. 기존 assertMember(ADMIN 우회) + assertWithRole(ADMIN 우회)
   * 조합으로 허용하던 능력을 resolve 전환 후에도 유지.
   */
  @Test
  void admin_can_delete_team_issue() {
    var s = teamScenario();
    // stranger 에게 ADMIN 역할 부여 (tenant 1 의 시스템 ADMIN role id=1)
    long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, s.strangerId())
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();

    assertThatCode(() -> issueService.softDelete(s.strangerId(), s.projectKey(), s.issueNumber()))
        .doesNotThrowAnyException();
  }
}

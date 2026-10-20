package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 이슈 삭제 권한 통합 테스트.
 *
 * <p>삭제 허용: OPEN 비멤버 reporter 본인, 프로젝트 OWNER, TEAM/OPEN ADMIN. 삭제 거부: 비멤버·비reporter stranger(403).
 */
@Transactional
class OpenIssueDeleteTest extends IntegrationTestBase {

  @Autowired IssueService issueService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired IssueAssigneeRepository assigneeRepository;
  @Autowired IssueCommentRepository commentRepository;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

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

  /** 비멤버 제보자는 처리팀이 손대면(담당자) 더는 지울 수 없고, 화면 삭제 버튼도 꺼진다. OWNER 는 그대로 지운다(WP-634). */
  @Test
  void open_non_member_reporter_cannot_delete_after_team_assigned() {
    var s = openScenario();
    assigneeRepository.add(s.issueId(), s.ownerId(), s.ownerId());
    assertThatThrownBy(
            () -> issueService.softDelete(s.reporterId(), s.projectKey(), s.issueNumber()))
        .isInstanceOf(ProjectAccessDeniedException.class)
        .hasMessageContaining("처리팀");
    assertThat(issueService.get(s.reporterId(), s.projectKey(), s.issueNumber()).viewerCanDelete())
        .isFalse();
    assertThatCode(() -> issueService.softDelete(s.ownerId(), s.projectKey(), s.issueNumber()))
        .doesNotThrowAnyException();
  }

  /** 다른 사람이 코멘트를 달면 제보자는 지울 수 없다 — 제보자 자신의 코멘트는 막지 않는다(WP-634). */
  @Test
  void open_non_member_reporter_cannot_delete_after_others_comment() {
    var s = openScenario();
    long id = s.issueId();
    commentRepository.insert(id, s.reporterId(), "추가 정보입니다");
    assertThat(issueService.get(s.reporterId(), s.projectKey(), s.issueNumber()).viewerCanDelete())
        .isTrue();
    commentRepository.insert(id, s.ownerId(), "원인 분석: 내부 메모");
    assertThatThrownBy(
            () -> issueService.softDelete(s.reporterId(), s.projectKey(), s.issueNumber()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 상태가 「할 일」이 아니게 되면(진행 중 등) 제보자는 지울 수 없다(WP-634). */
  @Test
  void open_non_member_reporter_cannot_delete_after_status_changed() {
    var s = openScenario();
    dsl.update(ISSUE).set(ISSUE.STATUS, "IN_PROGRESS").where(ISSUE.ID.eq(s.issueId())).execute();
    assertThatThrownBy(
            () -> issueService.softDelete(s.reporterId(), s.projectKey(), s.issueNumber()))
        .isInstanceOf(ProjectAccessDeniedException.class);
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

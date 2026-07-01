package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.TenantScopedIntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 이슈 생성 경로 개방 통합 테스트.
 *
 * <p>Task 5(A): 비멤버가 OPEN 프로젝트에 이슈를 생성할 수 있고, reporter == callerId 임을 검증한다. TEAM 프로젝트는 여전히 비멤버 생성
 * 거부(ProjectAccessDeniedException).
 */
@Transactional
class OpenIssueCreateTest extends TenantScopedIntegrationTest {

  @Autowired IssueService issueService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  /** 테스트용 CreateIssueRequest 헬퍼 — 제목만 필수, 나머지 null. */
  private static CreateIssueRequest suggestion(String title) {
    return new CreateIssueRequest(title, null, null, null, null, null, null);
  }

  private OpenScenario.Result openScenario() {
    return OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  private OpenScenario.Result teamScenario() {
    return OpenScenario.createTeam(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  /** 비멤버(stranger)가 OPEN 프로젝트에 이슈 생성 → 성공, reporter == stranger. */
  @Test
  void non_member_creates_issue_in_open_project() {
    var s = openScenario();
    // assertIssueCreatable 개방 전: assertMember 가 403 을 던짐 (RED 단계)
    var created = issueService.create(s.strangerId(), s.projectKey(), suggestion("다크모드 지원"));
    assertThat(created).isNotNull();

    // 생성 직후 조회 — reporter 가 stranger 본인인지 확인. IssueDetailResponse.summary().reporterId() 경로.
    var detail = issueService.get(s.strangerId(), s.projectKey(), created.number());
    assertThat(detail.summary().reporterId()).isEqualTo(s.strangerId());
  }

  /** TEAM 프로젝트는 비멤버 이슈 생성 거부(ProjectAccessDeniedException). */
  @Test
  void non_member_cannot_create_in_team_project() {
    var s = teamScenario();
    assertThatThrownBy(() -> issueService.create(s.strangerId(), s.projectKey(), suggestion("x")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }
}

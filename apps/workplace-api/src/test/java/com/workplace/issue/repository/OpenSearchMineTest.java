package com.workplace.issue.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueSearchQuery;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * IssueRepository.searchMemberOf — OPEN 프로젝트 reporter(비멤버) 포함 통합 테스트.
 *
 * <p>Task 9: 비멤버가 OPEN 프로젝트에 올린 이슈가 홈 "내 이슈"(searchMemberOf) 결과에 포함되는지 검증한다. TEAM 프로젝트의
 * 비멤버·비reporter 는 여전히 제외됨도 함께 확인한다.
 */
@Transactional
class OpenSearchMineTest extends IntegrationTestBase {

  @Autowired IssueRepository repo;
  @Autowired IssueTypeService issueTypeService;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  /** 모든 필터 없는 빈 쿼리. */
  private IssueSearchQuery emptyQuery() {
    return new IssueSearchQuery(
        null, null, null, false, null, null, null, null, 50, null, null, null, null, null, null,
        null, null, null, null, null);
  }

  private OpenScenario.Result openScenario() {
    return OpenScenario.create(dsl, issueTypeService, repo, sequenceRepository, 1L);
  }

  private OpenScenario.Result teamScenario() {
    return OpenScenario.createTeam(dsl, issueTypeService, repo, sequenceRepository, 1L);
  }

  /**
   * 핵심 검증: OPEN 프로젝트의 비멤버 reporter 가 searchMemberOf 로 자신이 올린 이슈를 볼 수 있어야 한다.
   *
   * <p>변경 전: reporter 는 프로젝트 멤버가 아니라 멤버십 EXISTS 에서 누락되어 빈 결과 반환 → FAIL. 변경 후: OPEN + reporter 조건 OR
   * 이 추가되어 이슈 포함 → PASS.
   */
  @Test
  void reporter_sees_own_open_issue_in_search_mine() {
    var s = openScenario();
    var rows = repo.searchMemberOf(s.reporterId(), emptyQuery());
    // reporter(비멤버)가 올린 이슈가 결과에 포함되어야 한다.
    assertThat(rows).anyMatch(r -> r.id().equals(s.issueId()));
  }

  /** 회귀 검증: OPEN 프로젝트의 정식 멤버는 여전히 해당 프로젝트 이슈를 볼 수 있어야 한다(멤버십 EXISTS 경로 유지). */
  @Test
  void member_still_sees_open_project_issues() {
    var s = openScenario();
    var rows = repo.searchMemberOf(s.memberId(), emptyQuery());
    assertThat(rows).anyMatch(r -> r.id().equals(s.issueId()));
  }

  /** 경계 검증: TEAM 프로젝트의 비멤버·비reporter(stranger) 는 여전히 결과에서 제외되어야 한다. OR 확장이 TEAM 프로젝트로 번지지 않음 보장. */
  @Test
  void stranger_cannot_see_team_project_issue_via_search_mine() {
    var s = teamScenario();
    var rows = repo.searchMemberOf(s.strangerId(), emptyQuery());
    // stranger 는 멤버도 reporter 도 아니므로 TEAM 이슈가 포함되어서는 안 된다.
    assertThat(rows).noneMatch(r -> r.id().equals(s.issueId()));
  }

  /** 경계 검증: TEAM 프로젝트의 reporter(비멤버) 역시 제외 — reporter OR 는 OPEN 에만 적용. */
  @Test
  void reporter_cannot_see_team_project_issue_via_search_mine() {
    var s = teamScenario();
    var rows = repo.searchMemberOf(s.reporterId(), emptyQuery());
    assertThat(rows).noneMatch(r -> r.id().equals(s.issueId()));
  }
}

package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 이슈 검색(보드/목록) 경로 개방 통합 테스트.
 *
 * <p>Task 5(B): IssueSearchService.search 의 가드를 assertMember → assertReadable 로 교체하여 비멤버도 OPEN 프로젝트
 * 보드를 볼 수 있도록 한다. TEAM 프로젝트는 여전히 비멤버 검색 거부.
 */
@Transactional
class OpenIssueSearchTest extends IntegrationTestBase {

  @Autowired IssueSearchService issueSearchService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
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

  /** 비멤버(stranger)가 OPEN 프로젝트 보드(search) 조회 → 성공, 시드 이슈가 결과에 포함. */
  @Test
  void non_member_can_search_open_project_board() {
    var s = openScenario();
    // assertReadable 개방 전: assertMember 가 403 을 던짐 (RED 단계)
    var result = issueSearchService.search(s.strangerId(), s.projectKey(), Map.of());
    assertThat(result).isNotNull();
    // IssueSearchResponse.items() 로 목록 접근
    assertThat(result.items()).isNotEmpty();
  }

  /** TEAM 프로젝트는 비멤버 보드 검색 거부(ProjectAccessDeniedException). */
  @Test
  void non_member_cannot_search_team_project_board() {
    var s = teamScenario();
    assertThatThrownBy(() -> issueSearchService.search(s.strangerId(), s.projectKey(), Map.of()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }
}

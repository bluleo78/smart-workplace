package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
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
 * OPEN 프로젝트 이슈 조회 경로 개방 + viewer capability 플래그 통합 테스트.
 *
 * <p>@Transactional 롤백 격리 + TenantContext 를 테넌트 1로 고정해 RLS GUC 주입을 보장한다(비-tx 시 seed/read 전부 실패).
 */
@Transactional
class OpenIssueReadTest extends IntegrationTestBase {

  @Autowired IssueService issueService;
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

  /** 비멤버가 OPEN 이슈 상세를 200 으로 조회하고, viewer 별 capability 플래그가 정책과 일치한다. */
  @Test
  void non_member_reads_open_issue_with_capability_flags() {
    var s = openScenario();

    // 비멤버 stranger 가 조회 → 200, 편집 불가(비멤버·비reporter)
    var detail = issueService.get(s.strangerId(), s.projectKey(), s.issueNumber());
    assertThat(detail).isNotNull();
    assertThat(detail.viewerCanEditContent()).isFalse();
    assertThat(detail.viewerCanEditWorkflow()).isFalse();

    // reporter(비멤버) 가 조회 → 내용 수정 가능, 워크플로 불가
    var asReporter = issueService.get(s.reporterId(), s.projectKey(), s.issueNumber());
    assertThat(asReporter.viewerCanEditContent()).isTrue();
    assertThat(asReporter.viewerCanEditWorkflow()).isFalse();

    // 처리팀 MEMBER 가 조회 → 워크플로/내용 모두 가능 (isMemberOrAdmin true-path 검증)
    var asMember = issueService.get(s.memberId(), s.projectKey(), s.issueNumber());
    assertThat(asMember.viewerCanEditWorkflow()).isTrue();
    assertThat(asMember.viewerCanEditContent()).isTrue();
  }

  /** 삭제 권한 플래그: reporter 본인·OWNER 는 true, 비관련 stranger 는 false. */
  @Test
  void delete_capability_flag_for_reporter_and_owner() {
    var s = openScenario();

    var asStranger = issueService.get(s.strangerId(), s.projectKey(), s.issueNumber());
    assertThat(asStranger.viewerCanDelete()).isFalse();

    var asReporter = issueService.get(s.reporterId(), s.projectKey(), s.issueNumber());
    assertThat(asReporter.viewerCanDelete()).isTrue();

    var asOwner = issueService.get(s.ownerId(), s.projectKey(), s.issueNumber());
    assertThat(asOwner.viewerCanDelete()).isTrue();
  }

  /** TEAM 프로젝트는 비멤버 조회 거부 — 개방은 OPEN 에만 적용. */
  @Test
  void non_member_cannot_read_team_issue() {
    var s = OpenScenario.createTeam(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    assertThatThrownBy(() -> issueService.get(s.strangerId(), s.projectKey(), s.issueNumber()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }
}

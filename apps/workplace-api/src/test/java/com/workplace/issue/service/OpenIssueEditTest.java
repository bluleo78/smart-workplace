package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.TenantScopedIntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 "내용 vs 워크플로" 필드 게이트 통합 테스트.
 *
 * <p>OPEN 이슈의 reporter(비멤버)는 제목/본문(내용)만 수정 가능하고, 상태/우선순위/마감일(워크플로)은 처리팀(멤버)만 변경 가능함을
 * 검증한다. @Transactional 롤백 격리 + TenantContext 를 테넌트 1로 고정해 RLS GUC 주입을 보장한다.
 */
@Transactional
class OpenIssueEditTest extends TenantScopedIntegrationTest {

  @Autowired IssueService issueService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  private OpenScenario.Result openScenario() {
    return OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  /** OPEN reporter(비멤버)는 제목(내용) 수정 성공 — 워크플로 필드는 건드리지 않음. */
  @Test
  void open_reporter_edits_content_only() {
    var s = openScenario();
    var titleReq = new UpdateIssueRequest("제목수정", null, null, null, null, false);
    var updated = issueService.update(s.reporterId(), s.projectKey(), s.issueNumber(), titleReq);
    assertThat(updated.summary().title()).isEqualTo("제목수정");
  }

  /** OPEN reporter 가 상태(워크플로)를 바꾸려 하면 403 — 처리팀(멤버)만 가능. */
  @Test
  void open_reporter_cannot_change_status() {
    var s = openScenario();
    var statusReq = new UpdateIssueRequest(null, null, "DONE", null, null, false);
    assertThatThrownBy(
            () -> issueService.update(s.reporterId(), s.projectKey(), s.issueNumber(), statusReq))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 비멤버·비reporter stranger 는 내용조차 수정 불가 — 403. */
  @Test
  void open_stranger_cannot_edit_content() {
    var s = openScenario();
    var titleReq = new UpdateIssueRequest("해킹", null, null, null, null, false);
    assertThatThrownBy(
            () -> issueService.update(s.strangerId(), s.projectKey(), s.issueNumber(), titleReq))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 처리팀 MEMBER 는 워크플로(상태) 변경 성공. */
  @Test
  void member_edits_workflow() {
    var s = openScenario();
    var statusReq = new UpdateIssueRequest(null, null, "IN_PROGRESS", null, null, false);
    var updated = issueService.update(s.memberId(), s.projectKey(), s.issueNumber(), statusReq);
    assertThat(updated.summary().status()).isEqualTo("IN_PROGRESS");
  }
}

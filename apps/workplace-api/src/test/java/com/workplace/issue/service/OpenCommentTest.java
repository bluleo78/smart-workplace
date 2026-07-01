package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
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
 * OPEN 프로젝트 댓글 게이트 통합 테스트.
 *
 * <p>댓글 작성 = 멤버/ADMIN 또는 OPEN reporter 본인만. 임의 테넌트 유저(stranger)는 목록 조회만 가능하고 작성은
 * 403. @Transactional 롤백 격리 + TenantContext 테넌트 1 고정으로 RLS GUC 주입 보장.
 */
@Transactional
class OpenCommentTest extends IntegrationTestBase {

  @Autowired IssueCommentService commentService;
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

  /** OPEN reporter(비멤버)는 자신이 만든 이슈에 댓글 작성 성공. */
  @Test
  void open_reporter_can_comment() {
    var s = openScenario();
    var resp = commentService.create(s.reporterId(), s.issueId(), new CreateCommentRequest("문의"));
    assertThat(resp.id()).isNotNull();
    assertThat(resp.body()).isEqualTo("문의");
  }

  /** 비멤버·비reporter stranger 는 댓글 작성 불가 — 403. */
  @Test
  void open_stranger_cannot_comment() {
    var s = openScenario();
    assertThatThrownBy(
            () ->
                commentService.create(s.strangerId(), s.issueId(), new CreateCommentRequest("스팸")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 비멤버 stranger 도 OPEN 이슈 댓글 목록 조회는 가능(읽기 개방). */
  @Test
  void open_stranger_can_list_comments() {
    var s = openScenario();
    var list = commentService.list(s.strangerId(), s.issueId());
    assertThat(list).isNotNull();
  }
}

package com.workplace.issue.service;

import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.UpdateCommentRequest;
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

  /** OPEN reporter(비멤버)는 자기 이슈에 단 자기 댓글을 계속 수정·삭제할 수 있다(작성 권한이 있으므로). */
  @Test
  void open_reporter_can_edit_and_delete_own_comment() {
    var s = openScenario();
    var c = commentService.create(s.reporterId(), s.issueId(), new CreateCommentRequest("문의"));
    var edited =
        commentService.update(s.reporterId(), s.issueId(), c.id(), new UpdateCommentRequest("수정"));
    assertThat(edited.body()).isEqualTo("수정");
    commentService.delete(s.reporterId(), s.issueId(), c.id());
  }

  /**
   * WP-492: 프로젝트에서 빠진 사람은 OPEN 이라 이슈를 계속 읽을 수 있어도, 예전에 단 자기 댓글을 수정·삭제할 수 없다 — 작성과 같은 쓰기
   * 권한(assertContentWritable)을 본다.
   */
  @Test
  void removed_member_cannot_edit_or_delete_own_comment() {
    var s = openScenario();
    var c = commentService.create(s.memberId(), s.issueId(), new CreateCommentRequest("처리 중"));
    dsl.deleteFrom(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(s.project().id()))
        .and(PROJECT_MEMBER.USER_ID.eq(s.memberId()))
        .execute();

    assertThatThrownBy(
            () ->
                commentService.update(
                    s.memberId(), s.issueId(), c.id(), new UpdateCommentRequest("제거 뒤 수정")))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> commentService.delete(s.memberId(), s.issueId(), c.id()))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> commentService.validateDeletable(s.memberId(), s.issueId(), c.id()))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThat(commentService.list(s.ownerId(), s.issueId()))
        .singleElement()
        .satisfies(r -> assertThat(r.body()).isEqualTo("처리 중"));
  }
}

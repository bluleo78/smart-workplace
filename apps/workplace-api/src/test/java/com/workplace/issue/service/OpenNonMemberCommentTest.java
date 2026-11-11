package com.workplace.issue.service;

import static com.workplace.jooq.Tables.PROJECT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1495 「비멤버 댓글 허용」 설정 통합 테스트. 접수함(OPEN) 프로젝트가 설정을 켜면 비멤버(stranger)도 댓글을 달고 자기 댓글을 고칠 수 있지만, 이슈
 * 내용 수정·이슈 채팅 같은 다른 쓰기는 그대로 막혀야 한다. @Transactional 롤백 격리 + TenantContext 테넌트 1 고정.
 */
@Transactional
@RecordApplicationEvents
class OpenNonMemberCommentTest extends IntegrationTestBase {

  @Autowired IssueCommentService commentService;
  @Autowired IssueService issueService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired ProjectRepository projectRepository;
  @Autowired ProjectAccessGuard accessGuard;
  @Autowired IssueCommentReactionService reactionService;
  @Autowired ApplicationEvents events;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  private OpenScenario.Result openScenario() {
    return OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  /** 프로젝트의 비멤버 댓글 허용 설정을 직접 바꾼다(서비스 경로는 ProjectServiceTest 가 검증). */
  private void setNonMemberComment(OpenScenario.Result s, boolean value) {
    dsl.update(PROJECT)
        .set(PROJECT.NON_MEMBER_COMMENT, value)
        .where(PROJECT.ID.eq(s.project().id()))
        .execute();
  }

  /** 켜면 비멤버·비reporter 도 댓글을 달 수 있다. */
  @Test
  void enabled_stranger_can_comment() {
    var s = openScenario();
    setNonMemberComment(s, true);

    var resp =
        commentService.create(s.strangerId(), s.issueId(), new CreateCommentRequest("나도 겪었어요"));

    assertThat(resp.body()).isEqualTo("나도 겪었어요");
  }

  /** 켜 둔 동안 비멤버는 자기 댓글을 수정·삭제할 수 있다. */
  @Test
  void enabled_stranger_can_edit_and_delete_own_comment() {
    var s = openScenario();
    setNonMemberComment(s, true);
    var c = commentService.create(s.strangerId(), s.issueId(), new CreateCommentRequest("처음"));

    var edited =
        commentService.update(s.strangerId(), s.issueId(), c.id(), new UpdateCommentRequest("수정"));
    assertThat(edited.body()).isEqualTo("수정");
    commentService.delete(s.strangerId(), s.issueId(), c.id());
  }

  /** 켜 있어도 남의 댓글은 수정·삭제할 수 없다. */
  @Test
  void enabled_stranger_cannot_edit_or_delete_others_comment() {
    var s = openScenario();
    setNonMemberComment(s, true);
    var c = commentService.create(s.memberId(), s.issueId(), new CreateCommentRequest("처리 중"));

    assertThatThrownBy(
            () ->
                commentService.update(
                    s.strangerId(), s.issueId(), c.id(), new UpdateCommentRequest("가로채기")))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> commentService.delete(s.strangerId(), s.issueId(), c.id()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 기본(끔)이면 비멤버 댓글은 403 + 댓글 전용 문구. */
  @Test
  void disabled_stranger_cannot_comment() {
    var s = openScenario();

    assertThatThrownBy(
            () ->
                commentService.create(s.strangerId(), s.issueId(), new CreateCommentRequest("스팸")))
        .isInstanceOf(ProjectAccessDeniedException.class)
        .hasMessage("이 이슈에 댓글을 달 권한이 없습니다");
  }

  /** 설정을 끄면 전에 단 비멤버의 댓글도 더는 수정할 수 없다(쓰기 권한이 사라졌으므로). */
  @Test
  void turned_off_stranger_cannot_edit_own_comment() {
    var s = openScenario();
    setNonMemberComment(s, true);
    var c = commentService.create(s.strangerId(), s.issueId(), new CreateCommentRequest("처음"));
    setNonMemberComment(s, false);

    assertThatThrownBy(
            () ->
                commentService.update(
                    s.strangerId(), s.issueId(), c.id(), new UpdateCommentRequest("끈 뒤 수정")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 켜 있어도 이슈 제목 수정은 여전히 막힌다 — 댓글만 개방한다. */
  @Test
  void enabled_stranger_still_cannot_edit_issue_content() {
    var s = openScenario();
    setNonMemberComment(s, true);
    var titleReq =
        new UpdateIssueRequest(
            "제목수정", null, null, null, null, false, null, false, null, false, null, null, null);

    assertThatThrownBy(
            () -> issueService.update(s.strangerId(), s.projectKey(), s.issueNumber(), titleReq))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 이슈 채팅은 canWriteContent 판정을 쓴다 — 설정을 켜도 비멤버는 여전히 false. */
  @Test
  void enabled_stranger_still_cannot_post_issue_chat() {
    var s = openScenario();
    setNonMemberComment(s, true);
    var project = projectRepository.findById(s.project().id()).orElseThrow();

    assertThat(project.nonMemberComment()).isTrue();
    assertThat(accessGuard.canWriteContent(project, s.reporterId(), s.strangerId())).isFalse();
  }

  /** 상세의 viewerCanComment 가 설정을 따른다 — reporter·멤버는 항상 true. */
  @Test
  void detail_flag_follows_setting() {
    var s = openScenario();

    assertThat(detailFlag(s, s.strangerId())).isFalse();
    assertThat(detailFlag(s, s.reporterId())).isTrue();
    assertThat(detailFlag(s, s.memberId())).isTrue();

    setNonMemberComment(s, true);
    assertThat(detailFlag(s, s.strangerId())).isTrue();
  }

  private boolean detailFlag(OpenScenario.Result s, long callerId) {
    return issueService.get(callerId, s.projectKey(), s.issueNumber()).viewerCanComment();
  }

  /**
   * 설정으로만 댓글을 단 비멤버의 댓글도 IssueCommentedEvent 는 발행된다(알림·SSE 용) — 다만 actorCanWriteContent=false 라 AI
   * 발사는 건너뛰고, IssueHumanReplyPosted 는 아예 내지 않는다.
   */
  @Test
  void enabled_stranger_comment_publishes_event_flagged_non_writer_and_no_human_reply() {
    var s = openScenario();
    setNonMemberComment(s, true);

    commentService.create(s.strangerId(), s.issueId(), new CreateCommentRequest("AI 야 해줘"));

    var published = events.stream(IssueCommentedEvent.class).toList();
    assertThat(published).hasSize(1);
    assertThat(published.get(0).actorCanWriteContent()).isFalse();
    assertThat(events.stream(IssueHumanReplyPosted.class)).isEmpty();
  }

  /** 멤버 댓글은 actorCanWriteContent=true 이고 IssueHumanReplyPosted 도 나간다. */
  @Test
  void member_comment_publishes_writer_event_and_human_reply() {
    var s = openScenario();
    setNonMemberComment(s, true);

    commentService.create(s.memberId(), s.issueId(), new CreateCommentRequest("확인 중"));

    var published = events.stream(IssueCommentedEvent.class).toList();
    assertThat(published).hasSize(1);
    assertThat(published.get(0).actorCanWriteContent()).isTrue();
    assertThat(events.stream(IssueHumanReplyPosted.class)).hasSize(1);
  }

  /** 켠 OPEN 에서 비멤버도 댓글에 반응을 달 수 있다. */
  @Test
  void enabled_stranger_can_react() {
    var s = openScenario();
    setNonMemberComment(s, true);
    var c = commentService.create(s.memberId(), s.issueId(), new CreateCommentRequest("처리 중"));

    reactionService.add(s.strangerId(), s.issueId(), c.id(), "👍");
    reactionService.remove(s.strangerId(), s.issueId(), c.id(), "👍");
  }

  /** 끈 OPEN 에서는 비멤버 반응이 403. */
  @Test
  void disabled_stranger_cannot_react() {
    var s = openScenario();
    var c = commentService.create(s.memberId(), s.issueId(), new CreateCommentRequest("처리 중"));

    assertThatThrownBy(() -> reactionService.add(s.strangerId(), s.issueId(), c.id(), "👍"))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }
}

package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentDeletedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentUpdatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 코멘트 서비스. 코멘트 작업 전 이슈 → 프로젝트 멤버십을 검증한다. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueCommentService {

  private final IssueRepository issueRepository;
  private final IssueCommentRepository commentRepository;
  private final ProjectAccessGuard accessGuard;
  private final ProjectRepository projectRepository;
  private final com.workplace.watcher.service.WatcherAutoEnroller watcherAutoEnroller;
  private final IssueAssigneeRepository assigneeRepository;
  private final UserRepository userRepository;
  private final ApplicationEventPublisher publisher;

  /**
   * 이슈 → 프로젝트 → 조회 가드(readable). OPEN 은 테넌트 전원 조회 허용(RLS 가 테넌트 경계 보장). 프로젝트 row 반환.
   *
   * <p>읽기 진입점(list) 및 author/OWNER 판정 전 base 접근(update/delete)에 사용한다. 작성(create)은 별도로
   * assertContentWritable 로 더 강하게 게이트한다.
   */
  private ProjectRow assertIssueReadable(Long issueId, Long callerId) {
    return assertIssueReadableWithIssue(issueId, callerId).project();
  }

  /** issue/project 를 함께 반환하는 버전 — update/delete 에서 이벤트 payload(issueNumber/title) 구성에 재사용. */
  private IssueAndProject assertIssueReadableWithIssue(Long issueId, Long callerId) {
    var issue =
        issueRepository.findById(issueId).orElseThrow(() -> new IssueNotFoundException(issueId));
    var project =
        projectRepository
            .findById(issue.projectId())
            .orElseThrow(() -> new ProjectNotFoundException("id=" + issue.projectId()));
    accessGuard.assertReadable(project.key(), callerId);
    return new IssueAndProject(issue, project);
  }

  private record IssueAndProject(com.workplace.issue.dto.IssueRow issue, ProjectRow project) {}

  /** 이슈 코멘트 목록 조회. OPEN 은 테넌트 전원 조회 가능(readable). */
  @Transactional(readOnly = true)
  public List<IssueCommentResponse> list(Long callerId, Long issueId) {
    assertIssueReadable(issueId, callerId);
    return commentRepository.findByIssue(issueId);
  }

  /**
   * 코멘트 생성. 작성 = 멤버/ADMIN 또는 (OPEN && 이슈 reporter 본인)만(assertContentWritable). 임의 테넌트 유저는 목록 조회만
   * 가능하고 작성은 403. 작성자를 자동으로 issue watcher 로 등록한다.
   */
  public IssueCommentResponse create(Long callerId, Long issueId, CreateCommentRequest req) {
    var issue =
        issueRepository.findById(issueId).orElseThrow(() -> new IssueNotFoundException(issueId));
    var project =
        projectRepository
            .findById(issue.projectId())
            .orElseThrow(() -> new ProjectNotFoundException("id=" + issue.projectId()));
    // 댓글 작성 자격: 멤버/ADMIN 또는 OPEN 이슈 reporter 본인. 그 외(임의 테넌트 reader)는 403.
    accessGuard.assertContentWritable(project, issue.reporterId(), callerId);
    var resp = commentRepository.insert(issueId, callerId, req.body());
    watcherAutoEnroller.enroll(issueId, callerId);

    // 도메인 이벤트 발행 (AFTER_COMMIT 에서 ai-agent 발사 후보) — issue 는 위에서 이미 로드해 재사용.
    var assignees = assigneeRepository.findByIssue(issueId);
    var actor =
        userRepository
            .findById(callerId)
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .orElse(null);
    String issueKey = project.key() + "-" + issue.number();
    publisher.publishEvent(
        new IssueCommentedEvent(
            issueId,
            project.key(),
            issueKey,
            issue.number(),
            issue.title(),
            actor,
            assignees,
            resp.id(),
            req.body(),
            Instant.now()));

    return resp;
  }

  /** 코멘트 수정 (본인 또는 프로젝트 OWNER) — delete 와 동일한 권한 모델. */
  public IssueCommentResponse update(
      Long callerId, Long issueId, Long commentId, UpdateCommentRequest req) {
    var issueAndProject = assertIssueReadableWithIssue(issueId, callerId);
    var issue = issueAndProject.issue();
    var project = issueAndProject.project();
    var existing =
        commentRepository
            .findById(commentId)
            .orElseThrow(() -> new IssueCommentNotFoundException(commentId));
    boolean isAuthor = existing.authorId().equals(callerId);
    boolean isOwner = false;
    try {
      accessGuard.assertWithRole(project.key(), callerId, "OWNER");
      isOwner = true;
    } catch (ProjectAccessDeniedException ignored) {
      // OWNER 아님 — isAuthor 만으로 판단
    }
    if (!isAuthor && !isOwner) {
      throw new ProjectAccessDeniedException("본인 코멘트 또는 OWNER 만 수정할 수 있습니다");
    }
    commentRepository.update(commentId, req.body());
    var updated = commentRepository.findById(commentId).orElseThrow();

    // 도메인 이벤트 발행 — create() 와 동일 패턴(#717, SSE 실시간 반영 갭 해소).
    var assignees = assigneeRepository.findByIssue(issueId);
    var actor =
        userRepository
            .findById(callerId)
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .orElse(null);
    String issueKey = project.key() + "-" + issue.number();
    publisher.publishEvent(
        new IssueCommentUpdatedEvent(
            issueId,
            project.key(),
            issueKey,
            issue.number(),
            issue.title(),
            actor,
            assignees,
            commentId,
            req.body(),
            Instant.now()));

    return updated;
  }

  /** 코멘트 soft-delete (본인 또는 프로젝트 OWNER). */
  public void delete(Long callerId, Long issueId, Long commentId) {
    var issueAndProject = assertIssueReadableWithIssue(issueId, callerId);
    var issue = issueAndProject.issue();
    var project = issueAndProject.project();
    var existing =
        commentRepository
            .findById(commentId)
            .orElseThrow(() -> new IssueCommentNotFoundException(commentId));
    boolean isAuthor = existing.authorId().equals(callerId);
    boolean isOwner = false;
    try {
      accessGuard.assertWithRole(project.key(), callerId, "OWNER");
      isOwner = true;
    } catch (ProjectAccessDeniedException ignored) {
      // OWNER 아님 — isAuthor 만으로 판단
    }
    if (!isAuthor && !isOwner) {
      throw new ProjectAccessDeniedException("코멘트 삭제 권한이 없습니다");
    }
    commentRepository.softDelete(commentId);

    // 도메인 이벤트 발행 — create() 와 동일 패턴(#717, SSE 실시간 반영 갭 해소).
    var assignees = assigneeRepository.findByIssue(issueId);
    var actor =
        userRepository
            .findById(callerId)
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .orElse(null);
    String issueKey = project.key() + "-" + issue.number();
    publisher.publishEvent(
        new IssueCommentDeletedEvent(
            issueId,
            project.key(),
            issueKey,
            issue.number(),
            issue.title(),
            actor,
            assignees,
            commentId,
            Instant.now()));
  }
}

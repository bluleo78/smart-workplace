package com.workplace.issue.service;

import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.dto.UserSummary;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.exception.IssueNotFoundException;
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

  /** 이슈 → 프로젝트 → 멤버십 가드. 프로젝트 row 반환. */
  private ProjectRow assertIssueAccess(Long issueId, Long callerId) {
    var issue =
        issueRepository.findById(issueId).orElseThrow(() -> new IssueNotFoundException(issueId));
    var project =
        projectRepository
            .findById(issue.projectId())
            .orElseThrow(() -> new ProjectNotFoundException("id=" + issue.projectId()));
    accessGuard.assertMember(project.key(), callerId);
    return project;
  }

  /** 이슈 코멘트 목록 조회. */
  @Transactional(readOnly = true)
  public List<IssueCommentResponse> list(Long callerId, Long issueId) {
    assertIssueAccess(issueId, callerId);
    return commentRepository.findByIssue(issueId);
  }

  /** 코멘트 생성. 작성자를 자동으로 issue watcher 로 등록. */
  public IssueCommentResponse create(Long callerId, Long issueId, CreateCommentRequest req) {
    var project = assertIssueAccess(issueId, callerId);
    var resp = commentRepository.insert(issueId, callerId, req.body());
    watcherAutoEnroller.enroll(issueId, callerId);

    // 도메인 이벤트 발행 (AFTER_COMMIT 에서 ai-agent 발사 후보)
    var issue = issueRepository.findById(issueId).orElseThrow();
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
    var project = assertIssueAccess(issueId, callerId);
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
    return commentRepository.findById(commentId).orElseThrow();
  }

  /** 코멘트 soft-delete (본인 또는 프로젝트 OWNER). */
  public void delete(Long callerId, Long issueId, Long commentId) {
    var project = assertIssueAccess(issueId, callerId);
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
  }
}

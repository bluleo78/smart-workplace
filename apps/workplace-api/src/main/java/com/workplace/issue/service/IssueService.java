package com.workplace.issue.service;

import com.workplace.global.dto.PageResponse;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 라이프사이클 서비스. 멤버십 가드 + 시퀀스 발급 + 히스토리 기록을 조합한다. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueService {

  private final IssueRepository issueRepository;
  private final IssueCommentRepository commentRepository;
  private final IssueHistoryRepository historyRepository;
  private final IssueLabelRepository issueLabelRepository;
  private final IssueAttachmentRepository issueAttachmentRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectIssueSequenceRepository sequenceRepository;
  private final ProjectMemberRepository memberRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final com.workplace.watcher.service.WatcherAutoEnroller watcherAutoEnroller;

  /**
   * 신규 이슈 생성. priority 기본값(MID)을 서비스에서 보정. assigneeIds 가 비어있지 않으면 issue_assignee 매핑까지 동시 INSERT.
   */
  public IssueResponse create(Long callerId, String projectKey, CreateIssueRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);

    // 1) 담당자 멤버십 검증
    List<Long> assigneeIds = req.assigneeIds() == null ? List.of() : req.assigneeIds();
    if (!assigneeIds.isEmpty()) {
      var memberIds = memberRepository.findUserIdsByProject(project.id());
      if (!new HashSet<>(memberIds).containsAll(assigneeIds)) {
        throw new InvalidAssigneeForProjectException();
      }
    }

    int number = sequenceRepository.allocateNext(project.id());
    var row =
        issueRepository.insert(
            project.id(),
            number,
            req.title(),
            req.body(),
            req.priority() != null ? req.priority() : "MID",
            req.dueDate(),
            callerId);

    // 2) issue_assignee 매핑 INSERT
    for (Long uid : assigneeIds) {
      assigneeRepository.add(row.id(), uid, callerId);
    }

    // 3) watcher 자동 등록: reporter + 각 assignee (caller 와 다를 때만)
    watcherAutoEnroller.enroll(row.id(), callerId);
    for (Long uid : assigneeIds) {
      if (!uid.equals(callerId)) watcherAutoEnroller.enroll(row.id(), uid);
    }

    return IssueResponse.from(project.key(), row);
  }

  /** 프로젝트 내 이슈 목록 페이지 조회. */
  @Transactional(readOnly = true)
  public PageResponse<IssueResponse> list(Long callerId, String projectKey, int page, int size) {
    var project = accessGuard.assertMember(projectKey, callerId);
    long total = issueRepository.countByProject(project.id());
    var rows = issueRepository.findByProject(project.id(), page, size);
    int totalPages = (size == 0) ? 0 : (int) Math.ceil((double) total / size);
    return new PageResponse<>(
        rows.stream().map(r -> IssueResponse.from(project.key(), r)).toList(),
        page,
        size,
        total,
        totalPages);
  }

  /** 이슈 상세 조회 (요약 + 본문 + 코멘트 + 히스토리 + 담당자). */
  @Transactional(readOnly = true)
  public IssueDetailResponse get(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var labels = issueLabelRepository.findLabelsByIssue(row.id());
    var attachments = issueAttachmentRepository.findByIssue(row.id());
    var assignees = assigneeRepository.findByIssue(row.id());
    var comments = commentRepository.findByIssue(row.id());
    var history = historyRepository.findByIssue(row.id());
    return new IssueDetailResponse(
        IssueResponse.fromWithFullDetails(
            project.key(), row, labels, attachments.size(), assignees),
        row.body(),
        comments,
        history,
        attachments);
  }

  /** 이슈 부분 수정. null 필드는 변경 없음, clearDueDate 플래그로 명시적 NULL 설정 지원. 담당자는 별도 PUT /assignees 흐름에서 관리. */
  public IssueDetailResponse update(
      Long callerId, String projectKey, int number, UpdateIssueRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var before =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    String newTitle = req.title() != null ? req.title() : before.title();
    String newBody = req.body() != null ? req.body() : before.body();
    String newStatus = req.status() != null ? req.status() : before.status();
    String newPriority = req.priority() != null ? req.priority() : before.priority();
    LocalDate newDue =
        Boolean.TRUE.equals(req.clearDueDate())
            ? null
            : (req.dueDate() != null ? req.dueDate() : before.dueDate());

    // closed_at 전이: 종료 상태로 진입 시 now(), 재오픈 시 NULL, 그 외 유지
    boolean wasClosed = before.status().equals("DONE") || before.status().equals("CANCELED");
    boolean nowClosed = newStatus.equals("DONE") || newStatus.equals("CANCELED");
    Instant newClosedAt;
    if (nowClosed && !wasClosed) {
      newClosedAt = Instant.now();
    } else if (!nowClosed && wasClosed) {
      newClosedAt = null;
    } else {
      newClosedAt = before.closedAt();
    }

    issueRepository.updateAll(
        before.id(), newTitle, newBody, newStatus, newPriority, newDue, newClosedAt);
    var after = issueRepository.findById(before.id()).orElseThrow();
    historyRecorder.recordChanges(callerId, before, after);

    return get(callerId, projectKey, number);
  }

  /** DnD 등에서 status 만 변경. update(...) 의 단축 경로 — 히스토리 기록도 동일하게 수행. */
  public IssueDetailResponse updateStatus(
      Long callerId, String projectKey, int number, String newStatus) {
    var req = new UpdateIssueRequest(null, null, newStatus, null, null, false);
    return update(callerId, projectKey, number, req);
  }

  /** 이슈 soft-delete. reporter 본인 또는 프로젝트 OWNER 만 가능. */
  public void softDelete(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    boolean isReporter = row.reporterId().equals(callerId);
    boolean isOwner = false;
    try {
      accessGuard.assertWithRole(projectKey, callerId, "OWNER");
      isOwner = true;
    } catch (ProjectAccessDeniedException ignored) {
      // OWNER 아님 — isReporter 만으로 판단
    }

    if (!isReporter && !isOwner) {
      throw new ProjectAccessDeniedException("이슈 삭제는 reporter 또는 OWNER 만 가능합니다");
    }
    issueRepository.softDelete(row.id());
  }
}

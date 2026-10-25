package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.exception.InvalidReporterException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.IssueDomainEvents.IssueReporterChangedEvent;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import com.workplace.watcher.service.WatcherAutoEnroller;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 보고자 바꾸기(WP-944). 보고자는 내용 쓰기·삭제 권한에 쓰이므로(ProjectAccessGuard) 담당자와 달리 바꿀 수 있는 사람을 좁힌다 — 프로젝트
 * OWNER·ADMIN 과 지금 보고자 본인(넘겨주기)만. 권한은 「현재 보고자」를 따라가 원래 보고자는 (멤버가 아니면) 쓰기·삭제 권한을 잃는다.
 *
 * <p>새 보고자는 사람(HUMAN)이고 이 워크스페이스에서 활성이며 프로젝트를 볼 수 있어야 한다. 바꾸면 이력(REPORTER_CHANGED)을 남기고 새 보고자를
 * watcher 로 넣고 알림(REPORTER_ASSIGNED)을 보낸다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueReporterService {

  private final IssueRepository issueRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final WatcherAutoEnroller watcherAutoEnroller;
  private final UserRepository userRepository;
  private final ApplicationEventPublisher publisher;
  private final IssueChangeNotifier changeNotifier;

  /** 보고자를 userId 로 바꾸고 새 보고자 요약을 돌려준다. 이미 그 사람이면 아무것도 바꾸지 않는다. */
  public UserSummary change(Long callerId, String projectKey, int number, Long userId) {
    // 볼 수 없는 프로젝트는 없는 것과 같은 404(WP-588).
    var project = accessGuard.assertReadable(projectKey, callerId);
    // 이슈 행을 잠가 동시 변경이 서로의 이력·알림을 덮어쓰지 않게 한다.
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    if (!accessGuard.canChangeReporter(project, issue.reporterId(), callerId)) {
      throw new ProjectAccessDeniedException("보고자는 프로젝트 소유자·관리자나 지금 보고자만 바꿀 수 있습니다");
    }

    List<AssigneeInfo> found =
        userRepository.findAssigneeInfos(List.of(userId), TenantContext.get());
    if (found.isEmpty()) {
      throw new InvalidReporterException("보고자로 지정할 사용자를 찾을 수 없습니다");
    }
    AssigneeInfo target = found.get(0);
    if (UserKind.isAgent(target.kind())) {
      throw new InvalidReporterException("AI 구성원은 보고자로 지정할 수 없습니다");
    }
    if (!target.isActive()) {
      throw new InvalidReporterException("비활성 사용자는 보고자로 지정할 수 없습니다");
    }
    if (userId.equals(issue.reporterId())) {
      return target.toSummary();
    }
    // 새 보고자가 이 프로젝트를 볼 수 있어야 한다 — 멤버라서 볼 수 있으면 멤버 행을 잠가 같은 순간의 멤버 제거와 엇갈리지 않게 한다(WP-776).
    if (!accessGuard.lockReadable(project, userId)) {
      throw new InvalidReporterException("이 프로젝트를 볼 수 없는 사람은 보고자로 지정할 수 없습니다");
    }

    UserSummary from =
        issue.reporterId() == null
            ? null
            : userRepository.findById(issue.reporterId()).map(UserResponse::toSummary).orElse(null);
    UserSummary to = target.toSummary();

    issueRepository.updateReporter(issue.id(), userId);
    historyRecorder.recordReporterChanged(callerId, issue.id(), from, to);
    changeNotifier.updatedWithoutTouch(project, number, issue.id(), callerId);
    watcherAutoEnroller.enroll(project, issue.id(), userId, callerId);

    var actor = userRepository.findById(callerId).map(UserResponse::toSummary).orElse(null);
    publisher.publishEvent(
        new IssueReporterChangedEvent(
            issue.id(),
            project.key(),
            project.key() + "-" + issue.number(),
            issue.title(),
            actor,
            from,
            to,
            Instant.now()));
    return to;
  }
}

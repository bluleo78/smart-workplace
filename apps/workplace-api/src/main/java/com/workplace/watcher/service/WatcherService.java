package com.workplace.watcher.service;

import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.LabelSummary;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.repository.UserRepository;
import com.workplace.watcher.dto.WatcherResponse;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Watcher add/remove + 이슈 watcher 목록 + /me/watched-issues. */
@Service
@Transactional
@RequiredArgsConstructor
public class WatcherService {

  private final IssueWatcherRepository watcherRepository;
  private final IssueRepository issueRepository;
  private final IssueLabelRepository issueLabelRepository;
  private final ProjectRepository projectRepository;
  private final UserRepository userRepository;
  private final ProjectAccessGuard accessGuard;
  private final ApplicationEventPublisher eventPublisher;

  /**
   * 멤버가 본인을 issue watcher 로 등록. 신규 row 가 실제로 insert 된 경우에만 {@link WatcherAddedEvent} 를 발행 — 이미
   * watcher 인 경우(멱등 no-op) 이벤트 중복 발행을 방지.
   */
  public void watch(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    boolean inserted = watcherRepository.add(issue.id(), callerId);
    if (inserted) {
      eventPublisher.publishEvent(
          new WatcherAddedEvent(issue.id(), callerId, callerId, Instant.now()));
    }
  }

  /** 본인 watcher 해제. */
  public void unwatch(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    watcherRepository.remove(issue.id(), callerId);
  }

  /**
   * 이슈 watcher 목록(user JOIN) — read 진입점. OPEN 은 테넌트 전원 조회 허용(assertReadable). 단, watch/unwatch(구독
   * 토글)는 write 이므로 assertMember 유지 — 비멤버는 목록은 보되 구독은 불가.
   */
  @Transactional(readOnly = true)
  public List<WatcherResponse> list(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var ids = watcherRepository.findUserIdsByIssue(issue.id());
    if (ids.isEmpty()) return List.of();
    return userRepository.findByIds(ids).stream()
        .map(u -> new WatcherResponse(u.id(), u.username(), u.name()))
        .toList();
  }

  /** /me/watched-issues — 멤버십 필터로 비멤버 프로젝트 이슈는 자동 숨김. */
  @Transactional(readOnly = true)
  public IssueSearchResponse watchedIssues(Long callerId, String cursorStr, int size) {
    int clamped = Math.max(1, Math.min(100, size));
    IssueCursor cursor = cursorStr == null ? null : IssueCursor.decode(cursorStr);

    var issueIds = watcherRepository.findIssueIdsByUser(callerId);
    if (issueIds.isEmpty()) return new IssueSearchResponse(List.of(), null, false);

    var rows = issueRepository.findByIdsActiveMemberOf(issueIds, callerId, cursor, clamped);
    Map<Long, List<LabelSummary>> labelsByIssue =
        issueLabelRepository.findLabelsByIssueIds(rows.stream().map(IssueRow::id).toList());
    var items =
        rows.stream()
            .map(
                r -> {
                  var proj = projectRepository.findById(r.projectId()).orElseThrow();
                  return IssueResponse.fromWithLabels(
                      proj.key(), r, labelsByIssue.getOrDefault(r.id(), List.of()));
                })
            .toList();

    String nextCursor = null;
    boolean hasMore = false;
    if (!rows.isEmpty() && rows.size() >= clamped) {
      var last = rows.get(rows.size() - 1);
      nextCursor = IssueCursor.encode(last.updatedAt(), last.id());
      hasMore = true;
    }
    return new IssueSearchResponse(items, nextCursor, hasMore);
  }
}

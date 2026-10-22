package com.workplace.watcher.service;

import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.LabelSummary;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.repository.UserRepository;
import com.workplace.watcher.dto.WatcherResponse;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
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
  private final WatcherAutoEnroller watcherAutoEnroller;
  private final IssueChangeNotifier changeNotifier;

  /**
   * 본인을 issue watcher 로 등록. 신규 row 가 실제로 insert 된 경우에만 WatcherAddedEvent 를 발행 — 이미 watcher 인 경우(멱등
   * no-op) 이벤트 중복 발행을 방지.
   *
   * <p>볼 수 있는 이슈면 구독할 수 있다(assertReadable, WP-631) — 공개 접수함(OPEN)은 비멤버도 이슈를 올리고 코멘트하며 제보자로 자동
   * 구독되는데, 멤버만 허용하면 자기 구독을 끄지도 다시 켜지도 못했다. 구독은 자기 알림 설정일 뿐 이슈를 바꾸지 않고, 알림으로 받는 내용도 이미 볼 수 있는 이슈의
   * 것이다.
   */
  public void watch(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    // 멤버 제거가 먼저 커밋됐으면 볼 수 없는 프로젝트와 같은 404(WP-776) — 아래 등록도 같은 잠금으로 거른다.
    if (!accessGuard.lockReadable(project, callerId)) {
      throw ProjectNotFoundException.hidden();
    }
    // 등록 + WatcherAddedEvent 발행은 자동 등록과 같은 진입점을 쓴다(신규 insert 때만 발행).
    if (watcherAutoEnroller.enroll(project, issue.id(), callerId, callerId)) {
      // 실시간 무효화 — 실제 insert 가 일어났을 때만. 워치는 이슈 작업이 아니므로 AI 작업을 시작·재개하지 않는 알림을 쓴다(WP-377).
      changeNotifier.updatedWithoutTouch(project, number, issue.id(), callerId);
    }
  }

  /** 본인 watcher 해제 — 구독과 같은 규칙(볼 수 있는 이슈, WP-631). */
  public void unwatch(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    watcherRepository.remove(issue.id(), callerId);
    // 워치 해제도 이슈 작업이 아니다 — AI 작업 터치 없는 알림(WP-377).
    changeNotifier.updatedWithoutTouch(project, number, issue.id(), callerId);
  }

  /** 이슈 watcher 목록(user JOIN) — read 진입점. OPEN 은 테넌트 전원 조회 허용(assertReadable). */
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

  /**
   * /me/watched-issues — 멤버인 프로젝트와 공개 접수함(OPEN) 프로젝트의 이슈만. 멤버에서 빠진 TEAM 프로젝트 이슈는 숨긴다. OPEN 은 비멤버도
   * 구독할 수 있어(WP-631) 함께 보여 준다 — 알림은 오는데 어디서 구독 중인지 볼 수 없던 문제.
   */
  @Transactional(readOnly = true)
  public IssueSearchResponse watchedIssues(Long callerId, String cursorStr, int size) {
    int clamped = Math.max(1, Math.min(100, size));
    IssueCursor cursor = cursorStr == null ? null : IssueCursor.decode(cursorStr);

    var issueIds = watcherRepository.findIssueIdsByUser(callerId);
    if (issueIds.isEmpty()) return new IssueSearchResponse(List.of(), null, false);

    var rows = issueRepository.findByIdsReadableWatchedBy(issueIds, callerId, cursor, clamped);
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

package com.workplace.issue.service;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueVersionsResponse;
import com.workplace.issue.dto.ReplaceVersionsRequest;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueVersionRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.version.dto.VersionKind;
import com.workplace.version.dto.VersionRow;
import com.workplace.version.dto.VersionSummary;
import com.workplace.version.exception.VersionException;
import com.workplace.version.repository.VersionRepository;
import com.workplace.version.repository.VersionRepository.IssueVersionSummaries;
import com.workplace.version.repository.VersionRepository.LockMode;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈에 수정 버전(FIX)·영향 버전(AFFECTS)을 붙이고 떼는 서비스(WP-888) — {@link IssueComponentService} 와 같은 모양에
 * 종류(kind)가 하나 더 있다. 담당자는 바꾸지 않고, 변경 알림은 AI 작업을 건드리지 않는 {@code updatedWithoutTouch} 만 낸다.
 *
 * <p>잠금은 항상 한 방향 <b>이슈 행(FOR UPDATE) → 버전 행(공유 잠금, id 순)</b> 이다. 출시 옮기기·삭제는 같은 순서로 잡으므로 서로 기다리는 고리가
 * 생기지 않는다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueVersionService {

  private final IssueVersionRepository issueVersionRepository;
  private final VersionRepository versionRepository;
  private final IssueRepository issueRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;

  /**
   * 버전 집합 교체. 보낸 종류만 바꾸고(빠진 키는 유지), 이 프로젝트에 없는 id 는 400 VERSION_NOT_FOUND, 보관된 버전을 새로 붙이면 400
   * VERSION_ARCHIVED — 이미 붙어 있던 보관 버전은 그대로 둘 수 있다. 출시된 버전은 자유롭게 붙인다.
   *
   * @return 교체 뒤 이슈의 두 종류 버전(목록 순서)
   */
  public IssueVersionsResponse replace(
      Long callerId, String projectKey, int number, ReplaceVersionsRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    // 이슈 행 잠금 — 현재 집합 읽기→diff→반영이 한 덩어리가 되게 한다(구성요소와 같다). 이후 버전 행 잠금은 반드시 이 뒤.
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    List<Long> fixIds = req.fixVersionIds() == null ? null : distinct(req.fixVersionIds());
    List<Long> affectsIds =
        req.affectsVersionIds() == null ? null : distinct(req.affectsVersionIds());

    // 두 종류에 요청된 모든 id 를 id 순으로 한 번에 공유 잠금 — 「보관됨 확인 → INSERT」 사이에 동시 보관·삭제가 끼지 못한다.
    Set<Long> all = new LinkedHashSet<>();
    if (fixIds != null) all.addAll(fixIds);
    if (affectsIds != null) all.addAll(affectsIds);
    List<VersionRow> locked = versionRepository.lockByIds(all, LockMode.SHARE);
    // 다른 프로젝트의 id 도 같이 잠기지만 곧 400 으로 끝나므로 무해하다(교착 순서는 id 순이라 그대로 안전).
    Set<Long> inProject =
        locked.stream()
            .filter(v -> v.projectId() == project.id())
            .map(VersionRow::id)
            .collect(Collectors.toSet());
    if (!inProject.containsAll(all)) throw VersionException.notInProject();

    // 지금 붙은 두 종류를 한 번에 읽어 두 종류의 diff 에 함께 쓴다 — 수정 쪽 쓰기는 영향 쪽 행을 바꾸지 않는다.
    IssueVersionSummaries before = currentSummaries(issue.id());
    // 검증을 모두 끝낸 뒤 쓴다 — 한 종류가 보관 거절이면 다른 종류도 반영되지 않는다(예외로 트랜잭션 롤백이기도 하다).
    Set<Long> toAddIds = new LinkedHashSet<>();
    if (fixIds != null) toAddIds.addAll(newlyAttached(before.fix(), fixIds, locked));
    if (affectsIds != null) toAddIds.addAll(newlyAttached(before.affects(), affectsIds, locked));
    // 새로 붙일 행은 목록 순서로 한 번 읽는다 — 이력의 added 순서가 버전 목록 순서가 되게.
    List<VersionRow> addRows = versionRepository.findByIds(project.id(), toAddIds);
    // 쓰기는 공통 경로(applyChange)로 — 행·이력·알림이 출시·삭제 옮기기와 같은 모양이 된다.
    if (fixIds != null) {
      applyChange(
          issue,
          project,
          VersionKind.FIX,
          before.fix(),
          within(addRows, fixIds),
          detached(before.fix(), fixIds),
          callerId);
    }
    if (affectsIds != null) {
      applyChange(
          issue,
          project,
          VersionKind.AFFECTS,
          before.affects(),
          within(addRows, affectsIds),
          detached(before.affects(), affectsIds),
          callerId);
    }

    var both = currentSummaries(issue.id());
    return new IssueVersionsResponse(both.fix(), both.affects());
  }

  /**
   * 한 종류에서 새로 붙일 버전 id(잠근 순서). 보관된 버전은 새로 붙이는 것만 막는다 — 처음 걸린 이름을 알려 준다. 이미 붙은 것은 보관돼 있어도 그대로 둔다.
   */
  private static List<Long> newlyAttached(
      List<VersionSummary> current, List<Long> requested, List<VersionRow> locked) {
    Set<Long> currentIds = ids(current);
    Set<Long> target = new LinkedHashSet<>(requested);
    List<VersionRow> toAdd =
        locked.stream()
            .filter(v -> target.contains(v.id()) && !currentIds.contains(v.id()))
            .toList();
    toAdd.stream()
        .filter(VersionRow::archived)
        .findFirst()
        .ifPresent(
            v -> {
              throw VersionException.archived(v.name());
            });
    return toAdd.stream().map(VersionRow::id).toList();
  }

  /** 교체에서 뗄 버전 id — 지금 붙었지만 목표에 없는 것. */
  private static Set<Long> detached(List<VersionSummary> current, List<Long> requested) {
    Set<Long> target = Set.copyOf(requested);
    return current.stream()
        .map(VersionSummary::id)
        .filter(id -> !target.contains(id))
        .collect(Collectors.toSet());
  }

  /** rows 가운데 ids 에 든 것(rows 순서). */
  private static List<VersionRow> within(List<VersionRow> rows, List<Long> ids) {
    Set<Long> wanted = Set.copyOf(ids);
    return rows.stream().filter(v -> wanted.contains(v.id())).toList();
  }

  /**
   * 이슈의 한 종류 버전을 더하고 뗀다 — 행 쓰기·이력(차이가 있을 때만)·화면 갱신 알림({@code updatedWithoutTouch})을 한 덩어리로 하는 공통 쓰기
   * 경로다. 이미 붙은 것을 더하거나 안 붙은 것을 떼는 요청은 조용히 건너뛴다.
   *
   * <p>호출자가 이미 잠금을 잡았다고 가정한다 — 순서는 이슈 행(FOR UPDATE) → 버전 행. 이 메서드는 잠그지 않는다.
   *
   * <p>{@code add} 대상의 유효성은 <b>호출자가 쓰기 전에 검증</b>한다 — 이 메서드는 이슈와 다른 프로젝트의 id 를 조용히 버리고, 보관된(또는 출시
   * 옮기기에서 이미 출시된) 버전도 거절하지 않는다. 교체는 VERSION_NOT_FOUND·VERSION_ARCHIVED 로, 출시·삭제 옮기기는
   * VERSION_MOVE_TARGET_INVALID 로 미리 막는다.
   *
   * @return 실제로 바뀐 게 있으면 true
   */
  public boolean applyChange(
      long issueId, String kind, Set<Long> add, Set<Long> remove, Long actor) {
    var issue = findIssue(issueId);
    var project =
        projectRepository
            .findById(issue.projectId())
            .orElseThrow(() -> new IllegalStateException("프로젝트 없음: " + issue.projectId()));
    List<VersionRow> addRows =
        add == null || add.isEmpty() ? List.of() : versionRepository.findByIds(project.id(), add);
    return applyChange(
        issue, project, kind, ofKind(currentSummaries(issueId), kind), addRows, remove, actor);
  }

  /**
   * {@link #applyChange(long, String, Set, Set, Long)} 의 출시·삭제 옮기기용 — 이슈마다 같은 프로젝트·대상 버전 행을 다시 읽지
   * 않도록 호출부가 한 번 읽어 넘긴다(대상은 호출부가 이미 같은 프로젝트로 검증했다). 이슈 행과 현재 버전은 이슈마다 읽는다.
   */
  public boolean applyChange(
      long issueId,
      ProjectRow project,
      String kind,
      List<VersionRow> addRows,
      Set<Long> remove,
      Long actor) {
    var issue = findIssue(issueId);
    return applyChange(
        issue, project, kind, ofKind(currentSummaries(issueId), kind), addRows, remove, actor);
  }

  /** 공통 쓰기 본체 — 이미 가진 이슈·프로젝트·현재 요약으로 diff 를 내고 쓴다. addRows 순서가 이력의 added 순서다. */
  private boolean applyChange(
      IssueRow issue,
      ProjectRow project,
      String kind,
      List<VersionSummary> before,
      Collection<VersionRow> addRows,
      Collection<Long> remove,
      Long actor) {
    Set<Long> current = ids(before);
    List<VersionRow> toAdd = addRows.stream().filter(v -> !current.contains(v.id())).toList();
    List<VersionSummary> removed =
        remove == null ? List.of() : before.stream().filter(s -> remove.contains(s.id())).toList();
    if (toAdd.isEmpty() && removed.isEmpty()) return false;
    write(issue.id(), kind, toAdd, removed, actor);
    // 정리성 쓰기라 AI 작업을 건드리지 않는 알림을 쓴다.
    changeNotifier.updatedWithoutTouch(project, issue.number(), issue.id(), actor);
    return true;
  }

  /** 연결 행 쓰기 + 이력 한 건. */
  private void write(
      long issueId, String kind, List<VersionRow> toAdd, List<VersionSummary> removed, Long actor) {
    for (VersionRow v : toAdd) issueVersionRepository.add(issueId, v.id(), kind);
    for (VersionSummary s : removed) issueVersionRepository.remove(issueId, s.id(), kind);
    historyRecorder.recordVersionsChanged(
        actor, issueId, kind, toAdd.stream().map(VersionRow::toSummary).toList(), removed);
  }

  private IssueRow findIssue(long issueId) {
    return issueRepository
        .findById(issueId)
        .orElseThrow(() -> new IllegalStateException("이슈 없음: " + issueId));
  }

  /** 이슈의 지금 두 종류 버전 요약(각각 목록 순서). */
  private IssueVersionSummaries currentSummaries(long issueId) {
    return versionRepository
        .summariesByIssueIdsBothKinds(List.of(issueId))
        .getOrDefault(issueId, IssueVersionSummaries.EMPTY);
  }

  private static List<VersionSummary> ofKind(IssueVersionSummaries both, String kind) {
    return VersionKind.isFix(kind) ? both.fix() : both.affects();
  }

  private static Set<Long> ids(List<VersionSummary> list) {
    return list.stream().map(VersionSummary::id).collect(Collectors.toSet());
  }

  private static List<Long> distinct(List<Long> ids) {
    return List.copyOf(new LinkedHashSet<>(ids));
  }
}

package com.workplace.issue.service;

import com.workplace.cycle.dto.CycleStatus;
import com.workplace.cycle.dto.CycleSummary;
import com.workplace.cycle.exception.CompletedCycleNotAssignableException;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.repository.CycleRepository;
import com.workplace.issue.dto.CycleProgress;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueCycleRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈에 사이클 집합을 통째로 교체. diff 만 INSERT/DELETE. (v1: history 기록 없음.) */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueCycleService {

  private final IssueCycleRepository issueCycleRepository;
  private final IssueRepository issueRepository;
  private final CycleRepository cycleRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueChangeNotifier changeNotifier;

  /** 이슈에 연결된 사이클 요약 조회 — 조회 가드(OPEN 은 테넌트 전원 개방, 상세 프로퍼티 레일 로드용). */
  @Transactional(readOnly = true)
  public List<CycleSummary> list(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    return issueCycleRepository.findCyclesByIssue(issue.id());
  }

  /** 이슈 사이클 집합 교체 — 멤버 가드, 프로젝트 일관성 검증, diff INSERT/DELETE. */
  public List<CycleSummary> replace(
      Long callerId, String projectKey, int number, List<Long> cycleIds) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    List<Long> normalized = cycleIds == null ? List.of() : cycleIds;

    // 1) 모든 cycleIds 가 같은 프로젝트 소속인지 검증
    if (!normalized.isEmpty()) {
      var cycles = cycleRepository.findByIds(normalized);
      Set<Long> normalizedSet = new HashSet<>(normalized);
      if (cycles.size() != normalizedSet.size()) {
        throw new InvalidCycleForProjectException();
      }
      for (var c : cycles) {
        if (!c.projectId().equals(project.id())) {
          throw new InvalidCycleForProjectException();
        }
      }
    }

    // 2) 현재 연결과 diff
    Set<Long> current = new HashSet<>(issueCycleRepository.findCycleIdsByIssue(issue.id()));
    Set<Long> target = new HashSet<>(normalized);
    Set<Long> toAdd = new HashSet<>(target);
    toAdd.removeAll(current);
    Set<Long> toRemove = new HashSet<>(current);
    toRemove.removeAll(target);

    for (Long id : toAdd) issueCycleRepository.add(issue.id(), id);
    for (Long id : toRemove) issueCycleRepository.remove(issue.id(), id);

    // 실시간 무효화 — diff 가 있을 때만(no-op 은 미발행)
    if (!toAdd.isEmpty() || !toRemove.isEmpty()) {
      changeNotifier.updated(project, number, issue.id(), callerId);
    }

    return issueCycleRepository.findCyclesByIssue(issue.id());
  }

  /**
   * 사이클 간 이동 — 사이클 페이지 드래그 앤 드롭(#881).
   *
   * <p>from 연결만 끊고 to 연결만 추가한다(그 외 사이클 연결은 유지). null 은 백로그(사이클 없음)를 뜻한다. 집합 통째 교체(replace)를 쓰면
   * 클라이언트가 현재 집합을 알아야 하고 동시 변경을 덮어쓰므로, 차분 한 쌍을 서버에서 원자적으로 적용한다. 이미 끊긴 from·이미 붙은 to 는 멱등으로 건너뛴다(다른
   * 곳에서 먼저 바뀐 경우).
   *
   * <p>실제 적용한 차분(removedFrom·addedTo)을 함께 돌려준다 — 이동은 대칭이 아니라(예: {A,B} 에서 A→B 는 {B}), 클라이언트 되돌리기는
   * from/to 를 뒤집는 대신 이 차분만 역적용해야 원래 집합이 복원된다.
   */
  public MoveResult move(
      Long callerId, String projectKey, int number, Long fromCycleId, Long toCycleId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    // 같은 섹션으로의 이동은 변화 없음.
    if (Objects.equals(fromCycleId, toCycleId)) {
      return new MoveResult(issueCycleRepository.findCyclesByIssue(issue.id()), false, false);
    }

    // 대상 사이클 검증 — 같은 프로젝트 소속 + 완료 사이클 차단. from 은 끊기만 하므로 연결 여부로 충분하다.
    if (toCycleId != null) {
      var to =
          cycleRepository
              .findById(toCycleId)
              .filter(c -> c.projectId().equals(project.id()))
              .orElseThrow(InvalidCycleForProjectException::new);
      if (CycleStatus.COMPLETED.equals(to.status())) {
        throw new CompletedCycleNotAssignableException();
      }
    }

    // add/remove 는 멱등이고 영향 행 수를 돌려주므로 사전 조회 없이 실제 적용 여부를 얻는다.
    boolean removedFrom =
        fromCycleId != null && issueCycleRepository.remove(issue.id(), fromCycleId) > 0;
    boolean addedTo = toCycleId != null && issueCycleRepository.add(issue.id(), toCycleId) > 0;
    // 실시간 무효화 — 실제 변경이 있을 때만(no-op 은 미발행)
    if (removedFrom || addedTo) {
      changeNotifier.updated(project, number, issue.id(), callerId);
    }

    return new MoveResult(issueCycleRepository.findCyclesByIssue(issue.id()), removedFrom, addedTo);
  }

  /** 이동 결과 — 이동 후 사이클 집합 + 실제로 from 을 끊었는지·to 를 붙였는지(되돌리기용 차분). */
  public record MoveResult(List<CycleSummary> cycles, boolean removedFrom, boolean addedTo) {}

  /** 프로젝트 전 사이클 진행 집계 — 멤버 가드. */
  @Transactional(readOnly = true)
  public List<CycleProgress> progress(Long callerId, String projectKey) {
    var project = accessGuard.assertMember(projectKey, callerId);
    return issueCycleRepository.progressByProject(project.id());
  }
}

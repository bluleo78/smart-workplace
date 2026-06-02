package com.workplace.issue.service;

import com.workplace.cycle.dto.CycleSummary;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.repository.CycleRepository;
import com.workplace.issue.dto.CycleProgress;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueCycleRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.HashSet;
import java.util.List;
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

  /** 이슈에 연결된 사이클 요약 조회 — 멤버 가드. */
  @Transactional(readOnly = true)
  public List<CycleSummary> list(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
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

    return issueCycleRepository.findCyclesByIssue(issue.id());
  }

  /** 프로젝트 전 사이클 진행 집계 — 멤버 가드. */
  @Transactional(readOnly = true)
  public List<CycleProgress> progress(Long callerId, String projectKey) {
    var project = accessGuard.assertMember(projectKey, callerId);
    return issueCycleRepository.progressByProject(project.id());
  }
}

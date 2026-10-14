package com.workplace.issue.service;

import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.LabelSummary;
import com.workplace.label.exception.InvalidLabelForProjectException;
import com.workplace.label.repository.LabelRepository;
import com.workplace.label.service.LabelService;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈에 라벨 집합을 통째로 교체. diff 만 INSERT/DELETE 하고 LABELS_CHANGED 한 건 기록. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueLabelService {

  private final IssueLabelRepository issueLabelRepository;
  private final IssueRepository issueRepository;
  private final LabelRepository labelRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;
  private final LabelService labelService;

  /** 이슈 라벨 집합 교체(id 만) — {@link #replace(Long, String, int, List, List)} 참고. */
  public List<LabelSummary> replace(
      Long callerId, String projectKey, int number, List<Long> labelIds) {
    return replace(callerId, projectKey, number, labelIds, null);
  }

  /**
   * 이슈 라벨 집합 교체 — 멤버 가드, 프로젝트 일관성 검증, diff 기록. labelNames(WP-394)는 이름으로 붙일 라벨로, 프로젝트에 없으면 같은 트랜잭션에서
   * 기본 색으로 만들어 labelIds 와 합친다.
   */
  public List<LabelSummary> replace(
      Long callerId, String projectKey, int number, List<Long> labelIds, List<String> labelNames) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    // 1) 요청으로 받은 labelIds 가 모두 같은 프로젝트 소속인지 검증(중복 id 는 하나로)
    List<Long> requested =
        labelIds == null ? List.of() : List.copyOf(new LinkedHashSet<>(labelIds));
    if (!requested.isEmpty()) {
      var labels = labelRepository.findByIds(requested);
      if (labels.size() != requested.size()
          || labels.stream().anyMatch(l -> !l.projectId().equals(project.id()))) {
        throw new InvalidLabelForProjectException();
      }
    }
    // WP-394 이름 라벨 — 이 프로젝트에서 찾거나 만든 id 라 소속 검증이 필요 없다. 교체와 같은 트랜잭션이라 실패하면 함께 롤백된다.
    List<Long> normalized = labelService.mergeWithNames(project, callerId, requested, labelNames);

    // 2) 현재 부착 라벨과 diff 계산
    Set<Long> current = new HashSet<>(issueLabelRepository.findLabelIdsByIssue(issue.id()));
    Set<Long> target = new HashSet<>(normalized);
    Set<Long> toAdd = new HashSet<>(target);
    toAdd.removeAll(current);
    Set<Long> toRemove = new HashSet<>(current);
    toRemove.removeAll(target);

    for (Long id : toAdd) {
      issueLabelRepository.add(issue.id(), id);
    }
    for (Long id : toRemove) {
      issueLabelRepository.remove(issue.id(), id);
    }

    // 3) diff 가 있을 때만 history 기록
    if (!toAdd.isEmpty() || !toRemove.isEmpty()) {
      var addedSummaries =
          labelRepository.findByIds(new ArrayList<>(toAdd)).stream()
              .map(r -> new LabelSummary(r.id(), r.name(), r.colorToken()))
              .toList();
      var removedSummaries =
          labelRepository.findByIds(new ArrayList<>(toRemove)).stream()
              .map(r -> new LabelSummary(r.id(), r.name(), r.colorToken()))
              .toList();
      historyRecorder.recordLabelsChanged(callerId, issue.id(), addedSummaries, removedSummaries);
      // 실시간 무효화 — diff 가 있을 때만(no-op 은 미발행)
      changeNotifier.updated(project, number, issue.id(), callerId);
    }

    return issueLabelRepository.findLabelsByIssue(issue.id());
  }
}

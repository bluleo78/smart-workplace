package com.workplace.issue.service;

import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.LabelSummary;
import com.workplace.label.exception.InvalidLabelForProjectException;
import com.workplace.label.repository.LabelRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.ArrayList;
import java.util.HashSet;
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

  /** 이슈 라벨 집합 교체 — 멤버 가드, 프로젝트 일관성 검증, diff 기록. */
  public List<LabelSummary> replace(
      Long callerId, String projectKey, int number, List<Long> labelIds) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    List<Long> normalized = labelIds == null ? List.of() : labelIds;

    // 1) 모든 labelIds 가 같은 프로젝트 소속인지 검증
    if (!normalized.isEmpty()) {
      var labels = labelRepository.findByIds(normalized);
      Set<Long> normalizedSet = new HashSet<>(normalized);
      if (labels.size() != normalizedSet.size()) {
        throw new InvalidLabelForProjectException();
      }
      for (var l : labels) {
        if (!l.projectId().equals(project.id())) {
          throw new InvalidLabelForProjectException();
        }
      }
    }

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
    }

    return issueLabelRepository.findLabelsByIssue(issue.id());
  }
}

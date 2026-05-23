package com.workplace.issue.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.IssueAttachmentResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.label.dto.LabelSummary;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** 이슈 수정 시 before/after 비교 후 변경된 항목에 대해 history row 를 기록한다. body 변경은 소음 방지를 위해 기록 대상에서 제외한다. */
@Component
@RequiredArgsConstructor
public class IssueHistoryRecorder {

  private final IssueHistoryRepository historyRepository;
  private final ObjectMapper objectMapper;

  /** before/after 의 주요 필드 비교 후 변경 항목별로 history row 삽입. */
  public void recordChanges(Long actorId, IssueRow before, IssueRow after) {
    if (!Objects.equals(before.title(), after.title())) {
      historyRepository.insert(
          before.id(), actorId, "TITLE_CHANGED", before.title(), after.title());
    }
    if (!Objects.equals(before.status(), after.status())) {
      historyRepository.insert(
          before.id(), actorId, "STATUS_CHANGED", before.status(), after.status());
    }
    if (!Objects.equals(before.priority(), after.priority())) {
      historyRepository.insert(
          before.id(), actorId, "PRIORITY_CHANGED", before.priority(), after.priority());
    }
    if (!Objects.equals(before.assigneeId(), after.assigneeId())) {
      historyRepository.insert(
          before.id(),
          actorId,
          "ASSIGNEE_CHANGED",
          stringify(before.assigneeId()),
          stringify(after.assigneeId()));
    }
    if (!Objects.equals(before.dueDate(), after.dueDate())) {
      historyRepository.insert(
          before.id(),
          actorId,
          "DUE_DATE_CHANGED",
          stringify(before.dueDate()),
          stringify(after.dueDate()));
    }
  }

  /**
   * 라벨 집합 교체를 한 건의 history 로 기록한다. diff 가 없으면 no-op. payload JSON 은 toValue 필드에 저장한다 (fromValue 는
   * null).
   */
  public void recordLabelsChanged(
      Long actorId, Long issueId, List<LabelSummary> added, List<LabelSummary> removed) {
    if ((added == null || added.isEmpty()) && (removed == null || removed.isEmpty())) {
      return;
    }
    String payload;
    try {
      payload =
          objectMapper.writeValueAsString(
              Map.of(
                  "added", added == null ? List.of() : added,
                  "removed", removed == null ? List.of() : removed));
    } catch (Exception e) {
      payload = "{}";
    }
    historyRepository.insert(issueId, actorId, "LABELS_CHANGED", null, payload);
  }

  /**
   * 이슈 첨부 추가/제거를 한 건의 history 로 기록한다. added/removed 모두 비면 no-op. payload JSON 은 toValue 에 저장
   * ({@code LABELS_CHANGED} 와 동일한 패턴).
   */
  public void recordAttachmentsChanged(
      Long actorId,
      Long issueId,
      List<IssueAttachmentResponse> added,
      List<IssueAttachmentResponse> removed) {
    boolean noAdd = added == null || added.isEmpty();
    boolean noRem = removed == null || removed.isEmpty();
    if (noAdd && noRem) {
      return;
    }
    String payload;
    try {
      payload =
          objectMapper.writeValueAsString(
              Map.of(
                  "added",
                  added == null
                      ? List.of()
                      : added.stream()
                          .map(a -> Map.of("fileId", a.fileId(), "originalName", a.originalName()))
                          .toList(),
                  "removed",
                  removed == null
                      ? List.of()
                      : removed.stream()
                          .map(a -> Map.of("fileId", a.fileId(), "originalName", a.originalName()))
                          .toList()));
    } catch (Exception e) {
      payload = "{}";
    }
    historyRepository.insert(issueId, actorId, "ATTACHMENTS_CHANGED", null, payload);
  }

  /** 객체 → 문자열 (null 보존). */
  private static String stringify(Object v) {
    return v == null ? null : v.toString();
  }
}

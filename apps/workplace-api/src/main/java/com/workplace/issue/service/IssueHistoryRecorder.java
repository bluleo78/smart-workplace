package com.workplace.issue.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.IssueAttachmentResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.UserSummary;
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

  /**
   * before/after 의 주요 필드 비교 후 변경 항목별로 history row 삽입. 담당자는 별도 PUT 흐름에서 ASSIGNEES_CHANGED 로 기록된다.
   */
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

  /**
   * 담당자 집합 교체를 한 건의 history 로 기록한다. diff 0 이면 no-op. payload JSON 은 toValue 필드에 저장한다 (fromValue 는
   * null). 라벨/첨부와 동일한 패턴.
   */
  public void recordAssigneesChanged(
      Long actorId, Long issueId, List<UserSummary> added, List<UserSummary> removed) {
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
                  "added", added == null ? List.of() : added,
                  "removed", removed == null ? List.of() : removed));
    } catch (Exception e) {
      payload = "{}";
    }
    historyRepository.insert(issueId, actorId, "ASSIGNEES_CHANGED", null, payload);
  }

  /**
   * 유형 변경 한 건을 기록. 동일 유형은 호출 안 됨 보장(서비스). payload JSON 은 toValue 필드에 저장하고 fromValue 는 null
   * (라벨/첨부/담당자와 동일 패턴).
   */
  public void recordTypeChanged(
      Long actorId,
      Long issueId,
      com.workplace.issue.dto.IssueTypeSummary from,
      com.workplace.issue.dto.IssueTypeSummary to) {
    String payload;
    try {
      payload =
          objectMapper.writeValueAsString(
              Map.of(
                  "from", Map.of("id", from.id(), "name", from.name()),
                  "to", Map.of("id", to.id(), "name", to.name())));
    } catch (Exception e) {
      payload = "{}";
    }
    historyRepository.insert(issueId, actorId, "TYPE_CHANGED", null, payload);
  }

  /**
   * 부모 변경/해제 한 건을 기록. from/to 는 null 가능 (설정/해제/교체 모두). diff 0 호출은 서비스에서 사전 차단. payload JSON 의 to 값은
   * type 정보 제외 — 렌더링은 응답의 parent.type 으로 처리한다.
   */
  public void recordParentChanged(
      Long actorId,
      Long issueId,
      com.workplace.issue.dto.ParentRef from,
      com.workplace.issue.dto.ParentRef to) {
    String payload;
    try {
      java.util.Map<String, Object> body = new java.util.HashMap<>();
      body.put(
          "from", from == null ? null : Map.of("number", from.number(), "title", from.title()));
      body.put("to", to == null ? null : Map.of("number", to.number(), "title", to.title()));
      payload = objectMapper.writeValueAsString(body);
    } catch (Exception e) {
      payload = "{}";
    }
    historyRepository.insert(issueId, actorId, "PARENT_CHANGED", null, payload);
  }

  /**
   * 의존성 추가 한 건 기록 (Phase 4b). direction = "blocks" | "blockedBy" — 화살표 방향은 호출자가 결정. payload toValue
   * JSON = {other: {number, title}, direction}.
   */
  public void recordDependencyAdded(
      Long actorId, Long issueId, int otherNumber, String otherTitle, String direction) {
    writeDependency(actorId, issueId, otherNumber, otherTitle, direction, "DEPENDENCY_ADDED");
  }

  /** 의존성 제거 한 건 기록 (Phase 4b). 0건 삭제 시 호출 안 됨 — 서비스에서 사전 가드. */
  public void recordDependencyRemoved(
      Long actorId, Long issueId, int otherNumber, String otherTitle, String direction) {
    writeDependency(actorId, issueId, otherNumber, otherTitle, direction, "DEPENDENCY_REMOVED");
  }

  /** 의존성 add/remove 공통 payload 직렬화 + insert. eventType 만 분기. */
  private void writeDependency(
      Long actorId,
      Long issueId,
      int otherNumber,
      String otherTitle,
      String direction,
      String eventType) {
    String payload;
    try {
      payload =
          objectMapper.writeValueAsString(
              Map.of(
                  "other",
                  Map.of("number", otherNumber, "title", otherTitle),
                  "direction",
                  direction));
    } catch (Exception e) {
      payload = "{}";
    }
    historyRepository.insert(issueId, actorId, eventType, null, payload);
  }

  /** 객체 → 문자열 (null 보존). */
  private static String stringify(Object v) {
    return v == null ? null : v.toString();
  }
}

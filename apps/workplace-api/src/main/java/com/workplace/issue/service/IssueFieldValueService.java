package com.workplace.issue.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.dto.FieldTypeValidator;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.UpdateIssueFieldsRequest;
import com.workplace.issue.exception.InvalidFieldForProjectException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueFieldDefRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 custom field 값 PUT 서비스 — 멤버 권한, incoming 만 처리. 모든 def 가 같은 프로젝트인지 검증 → value 검증 → 현재값과 diff
 * → 변경된 필드별 CUSTOM_FIELD_CHANGED history. null/NullNode 값은 row 삭제. 빈 배열 PUT 은 no-op (전체 삭제는 호출자가
 * 명시적으로 null value 들로 전송).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueFieldValueService {

  private final IssueFieldValueRepository valueRepo;
  private final IssueFieldDefRepository defRepo;
  private final IssueRepository issueRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueService issueService;
  private final IssueHistoryRecorder historyRecorder;

  /** 값 집합 변경 + diff history. */
  public IssueDetailResponse replace(
      Long callerId, String projectKey, int number, UpdateIssueFieldsRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    // 1) defId 들이 모두 같은 프로젝트인지 검증
    var defIds =
        req.values().stream()
            .map(UpdateIssueFieldsRequest.FieldValueInput::defId)
            .distinct()
            .toList();
    var defs = defRepo.findByIds(defIds);
    if (defs.size() != defIds.size()) {
      throw new InvalidFieldForProjectException();
    }
    for (var d : defs.values()) {
      if (!d.projectId().equals(project.id())) {
        throw new InvalidFieldForProjectException();
      }
    }

    // 2) 각 value 모양/옵션 검증 (null/NullNode 는 row 삭제 의도이므로 검증 생략)
    for (var v : req.values()) {
      if (v.value() != null && !v.value().isNull()) {
        var def = defs.get(v.defId());
        FieldTypeValidator.validateValue(def.type(), def.options(), v.value());
      }
    }

    // 3) 현재 값과 diff — 변경된 필드만 upsert/delete + history
    Map<Long, JsonNode> current = valueRepo.findValuesByIssue(issue.id());
    for (var v : req.values()) {
      var def = defs.get(v.defId());
      JsonNode before = current.get(v.defId());
      JsonNode after = (v.value() == null || v.value().isNull()) ? null : v.value();

      if (Objects.equals(before, after)) continue; // diff 0 — skip

      if (after == null) {
        valueRepo.delete(issue.id(), v.defId());
      } else {
        valueRepo.upsert(issue.id(), v.defId(), after);
      }
      historyRecorder.recordCustomFieldChanged(
          callerId, issue.id(), v.defId(), def.name(), def.type(), before, after);
    }

    return issueService.get(callerId, projectKey, number);
  }
}

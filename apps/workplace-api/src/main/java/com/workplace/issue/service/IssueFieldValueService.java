package com.workplace.issue.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.dto.FieldTypeValidator;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueFieldDefRow;
import com.workplace.issue.dto.UpdateIssueFieldsRequest;
import com.workplace.issue.exception.InvalidFieldForProjectException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueFieldDefRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
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
  private final IssueChangeNotifier changeNotifier;

  /** 값 집합 변경 + diff history. */
  public IssueDetailResponse replace(
      Long callerId, String projectKey, int number, UpdateIssueFieldsRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    // 1)·2) 정의 소속·값 모양 검증 — 가져오기(importValues)와 같은 규칙을 공유한다.
    var defs = loadValidatedDefs(project.id(), req.values());

    // 3) 현재 값과 diff — 변경된 필드만 upsert/delete + history
    Map<Long, JsonNode> current = valueRepo.findValuesByIssue(issue.id());
    boolean changed = false;
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
      changed = true;
    }

    // 실시간 무효화 — 실제로 바뀐 필드가 있을 때만
    if (changed) {
      changeNotifier.updatedWithoutTouch(project, number, issue.id(), callerId);
    }

    return issueService.get(callerId, projectKey, number);
  }

  /**
   * 이슈 가져오기(WP-883)의 커스텀 필드 값 저장 — {@link #replace} 와 같은 정의 소속·값 검증 뒤 upsert 만 한다. 원본을 옮기는 것이라 변경
   * 이력과 실시간 알림은 남기지 않는다(가져오기 자체가 이슈 생성 알림 한 번을 낸다). 새 이슈라 비교할 이전 값이 없고, null 값은 지정하지 않은 것으로 건너뛴다.
   */
  public void importValues(
      long projectId, long issueId, List<UpdateIssueFieldsRequest.FieldValueInput> values) {
    if (values == null || values.isEmpty()) return;
    loadValidatedDefs(projectId, values);
    for (var v : values) {
      if (v.value() == null || v.value().isNull()) continue;
      valueRepo.upsert(issueId, v.defId(), v.value());
    }
  }

  /**
   * 값 입력의 필드 정의를 읽어 검증한다 — 모두 이 프로젝트 정의여야 하고(아니면 400), null 이 아닌 값은 유형·옵션에 맞아야 한다. 정의는 공유 잠금으로
   * 읽는다(WP-773) — 옵션을 줄이는 수정과 차례를 세워, 검증한 옵션이 저장 전에 지워지지 않게 한다.
   */
  private Map<Long, IssueFieldDefRow> loadValidatedDefs(
      long projectId, List<UpdateIssueFieldsRequest.FieldValueInput> values) {
    var defIds =
        values.stream().map(UpdateIssueFieldsRequest.FieldValueInput::defId).distinct().toList();
    var defs = defRepo.findByIdsForShare(defIds);
    if (defs.size() != defIds.size()) {
      throw new InvalidFieldForProjectException();
    }
    for (var d : defs.values()) {
      if (!d.projectId().equals(projectId)) {
        throw new InvalidFieldForProjectException();
      }
    }
    // null/NullNode 는 row 삭제(수정)·미지정(가져오기) 의도이므로 검증 생략
    for (var v : values) {
      if (v.value() != null && !v.value().isNull()) {
        var def = defs.get(v.defId());
        FieldTypeValidator.validateValue(def.type(), def.options(), v.value());
      }
    }
    return defs;
  }
}

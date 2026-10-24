package com.workplace.issue.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.project.dto.ProjectRow;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 프로젝트 상태 설정 변경의 감사 로그(WP-811) — resource "project_status". 상태는 보드·진행률·완료 처리 기준을 바꾸는 설정이라 누가 언제 무엇을
 * 바꿨는지 남긴다. 호출부(쓰기 성공 직후)와 같은 트랜잭션에서 기록하므로 쓰기가 롤백되면 기록도 함께 사라진다.
 */
@Component
@RequiredArgsConstructor
public class ProjectStatusAudit {

  static final String RESOURCE = "project_status";

  /** 감사 로그 설명에 쓰는 범주 한국어 라벨 — 화면 라벨(할 일·진행 중·완료·취소)과 같다. */
  private static final Map<String, String> CATEGORY_LABELS =
      Map.of(
          IssueStatuses.TODO, "할 일",
          IssueStatuses.IN_PROGRESS, "진행 중",
          IssueStatuses.DONE, "완료",
          IssueStatuses.CANCELED, "취소");

  private final AuditLogService auditLogService;
  private final UserRepository userRepository;

  /** 상태 추가 — CREATE, resourceId = 새 상태 id. */
  public void created(Long callerId, ProjectRow project, ProjectStatusRow row) {
    var metadata = base(project);
    metadata.put("name", row.name());
    metadata.put("category", row.category());
    metadata.put("color", row.color());
    log(callerId, "CREATE", row.id(), project.key() + " 상태 '" + row.name() + "' 추가", metadata);
  }

  /** 상태 이름·색 변경 — UPDATE. 바뀐 항목만 {from, to} 로 남긴다(보내지 않았거나 같은 값이면 키 없음). */
  public void updated(
      Long callerId, ProjectRow project, ProjectStatusRow before, ProjectStatusRow after) {
    var metadata = base(project);
    putChange(metadata, "name", before.name(), after.name());
    putChange(metadata, "color", before.color(), after.color());
    log(callerId, "UPDATE", after.id(), project.key() + " 상태 '" + after.name() + "' 수정", metadata);
  }

  /** 같은 범주 안 순서 변경 — UPDATE. 상태 하나가 아니라 범주 전체의 변경이라 resourceId 는 프로젝트 id, 전후 이름 순서를 남긴다. */
  public void reordered(
      Long callerId,
      ProjectRow project,
      String category,
      List<String> beforeNames,
      List<String> afterNames) {
    var metadata = base(project);
    // 다른 metadata 와 같이 키 순서를 유지한다(Map.of 는 순서가 정해지지 않는다)
    var reorder = new LinkedHashMap<String, Object>();
    reorder.put("category", category);
    reorder.put("from", beforeNames);
    reorder.put("to", afterNames);
    metadata.put("reorder", reorder);
    log(
        callerId,
        "UPDATE",
        project.id(),
        project.key() + " " + CATEGORY_LABELS.getOrDefault(category, category) + " 상태 순서 변경",
        metadata);
  }

  /**
   * 상태 삭제 — DELETE. 이슈를 옮긴 대상과 옮긴 이슈(휴지통 포함)·고친 저장된 뷰 수를 함께 남긴다. moveTo 는 사용자가 고른 상태, 고르지 않았는데 휴지통
   * 이슈만 옮겼으면 그 이슈들이 간 같은 범주의 상태, 옮긴 이슈가 하나도 없으면 null 이다.
   */
  public void deleted(
      Long callerId,
      ProjectRow project,
      ProjectStatusRow row,
      ProjectStatusRow moveTo,
      int movedIssueCount,
      int savedViewCount) {
    var metadata = base(project);
    metadata.put("name", row.name());
    metadata.put("category", row.category());
    metadata.put("moveTo", moveTo == null ? null : moveTo.name());
    metadata.put("moveToCategory", moveTo == null ? null : moveTo.category());
    metadata.put("movedIssueCount", movedIssueCount);
    metadata.put("savedViewCount", savedViewCount);
    log(callerId, "DELETE", row.id(), project.key() + " 상태 '" + row.name() + "' 삭제", metadata);
  }

  /** 모든 기록에 공통인 metadata — 어느 프로젝트의 상태인지(키로 거를 수 있게). 순서를 유지하려 LinkedHashMap. */
  private static Map<String, Object> base(ProjectRow project) {
    var metadata = new LinkedHashMap<String, Object>();
    metadata.put("projectKey", project.key());
    return metadata;
  }

  /** 값이 바뀐 경우에만 key → {from, to} 를 넣는다. */
  private static void putChange(Map<String, Object> metadata, String key, String from, String to) {
    if (!Objects.equals(from, to)) {
      var change = new LinkedHashMap<String, Object>();
      change.put("from", from);
      change.put("to", to);
      metadata.put(key, change);
    }
  }

  /** RoleService.audit 와 같은 형태의 성공 기록 — 행위자가 없으면(내부 호출) username 은 "system". */
  private void log(
      Long callerId, String action, Long resourceId, String description, Object metadata) {
    String username =
        callerId == null
            ? "system"
            : userRepository.findById(callerId).map(UserResponse::username).orElse("system");
    auditLogService.log(
        callerId,
        username,
        action,
        RESOURCE,
        String.valueOf(resourceId),
        description,
        null,
        null,
        "SUCCESS",
        null,
        metadata);
  }
}

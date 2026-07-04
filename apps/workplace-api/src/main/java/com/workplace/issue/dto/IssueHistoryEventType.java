package com.workplace.issue.dto;

/** 이슈 히스토리 이벤트 타입 enum. body 변경은 소음 방지를 위해 기록 대상에서 제외. */
public enum IssueHistoryEventType {
  TITLE_CHANGED,
  STATUS_CHANGED,
  PRIORITY_CHANGED,
  // 단일 assignee 시절의 legacy 이벤트 — 신규 기록은 ASSIGNEES_CHANGED 로 통합. 과거 row 렌더링 호환용.
  ASSIGNEE_CHANGED,
  ASSIGNEES_CHANGED,
  DUE_DATE_CHANGED,
  // 시작일 변경 — 타임라인 간트뷰. Phase 5.
  START_DATE_CHANGED,
  // 마일스톤 연결/해제 — 타임라인 간트뷰. Phase 5.
  MILESTONE_CHANGED,
  LABELS_CHANGED,
  ATTACHMENTS_CHANGED,
  TYPE_CHANGED,
  // 부모(SUBTASK) 변경/해제 — Phase 4a.
  PARENT_CHANGED,
  // 의존성 추가/제거 — Phase 4b.
  DEPENDENCY_ADDED,
  DEPENDENCY_REMOVED,
  // 프로젝트 custom field 값 변경 — Phase 4c. payload: {defId, name, type, from, to}
  CUSTOM_FIELD_CHANGED
}

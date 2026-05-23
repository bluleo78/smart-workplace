package com.workplace.issue.dto;

/** 이슈 히스토리 이벤트 타입 enum. body 변경은 소음 방지를 위해 기록 대상에서 제외. */
public enum IssueHistoryEventType {
  TITLE_CHANGED,
  STATUS_CHANGED,
  PRIORITY_CHANGED,
  ASSIGNEE_CHANGED,
  DUE_DATE_CHANGED,
  LABELS_CHANGED
}

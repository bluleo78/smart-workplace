package com.workplace.notify.dto;

/**
 * 알림 종류 — DB 의 notification.type(VARCHAR) 과 name() 으로 매핑. ISSUE 계열은 issue_id, REMINDER 는 event_id 를
 * 채운다.
 */
public enum NotificationType {
  ASSIGNED,
  COMMENTED,
  STATUS_CHANGED,
  REMINDER
}

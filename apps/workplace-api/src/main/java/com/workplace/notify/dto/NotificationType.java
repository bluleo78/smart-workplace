package com.workplace.notify.dto;

/** 알림 종류 — DB 의 notification.type(VARCHAR) 과 name() 으로 매핑. Phase 2 에서 MENTIONED 추가 예정. */
public enum NotificationType {
  ASSIGNED,
  COMMENTED,
  STATUS_CHANGED
}

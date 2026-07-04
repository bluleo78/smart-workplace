package com.workplace.notify.dto;

/**
 * 알림 종류 — DB 의 notification.type(VARCHAR) 과 name() 으로 매핑. ISSUE 계열은 issue_id, REMINDER 는 event_id 를
 * 채운다.
 */
public enum NotificationType {
  ASSIGNED,
  COMMENTED,
  STATUS_CHANGED,
  PRIORITY_CHANGED, // 우선순위 변경(상태 변경과 대칭, 임계치 조건 없음, #613)
  REMINDER,
  CALENDAR_INVITED, // 일정 초대 수신(피초대자)
  CALENDAR_RSVP_CHANGED // 참석자 RSVP 변경(주최자 수신)
}

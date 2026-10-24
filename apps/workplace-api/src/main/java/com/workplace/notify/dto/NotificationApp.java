package com.workplace.notify.dto;

/**
 * 알림 설정의 앱 묶음 — 설정 화면의 섹션 순서(이슈 → 채팅 → 캘린더 → 노트)와 같다. 앱 전체 스위치(notification_app_setting.app) 와
 * name() 으로 매핑된다.
 */
public enum NotificationApp {
  ISSUE,
  CHAT,
  CALENDAR,
  WIKI
}

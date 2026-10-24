package com.workplace.notify.dto;

/**
 * 알림 설정의 행위자 열 — 알림을 일으킨 사용자(actor_id)의 kind 로 고른다. HUMAN 은 「사람이」, AGENT 는 「AI가」. 행위자가 없는 알림(리마인더)은
 * HUMAN 열을 따른다. notification_setting.actor 와 name() 으로 매핑된다.
 */
public enum NotificationActor {
  HUMAN,
  AGENT
}

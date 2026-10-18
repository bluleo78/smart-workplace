package com.workplace.notify.push;

import com.workplace.notify.dto.NotificationType;

/** 푸시 알림 종류. 사용자 설정(notification_preference.category)의 단위이며 NotificationType 을 이 넷으로 묶는다. */
public enum PushCategory {
  DM,
  MENTION,
  ISSUE,
  CALENDAR;

  /**
   * 인박스 알림 유형 → 기본 카테고리. 이슈 계열은 ISSUE, 일정 계열은 CALENDAR, 이슈 챗 멘션은 MENTION. AI_QUESTION 은 기본 ISSUE 이고
   * 그 질문 글에서 멘션된 수신자만 NotificationService 가 MENTION 으로 따로 보낸다(WP-452).
   */
  public static PushCategory of(NotificationType type) {
    return switch (type) {
      case ASSIGNED, COMMENTED, STATUS_CHANGED, PRIORITY_CHANGED, AI_QUESTION -> ISSUE;
      case ISSUE_CHAT_MENTION -> MENTION;
      case REMINDER, CALENDAR_INVITED, CALENDAR_RSVP_CHANGED -> CALENDAR;
    };
  }
}

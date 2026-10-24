package com.workplace.notify.push;

import com.workplace.notify.dto.NotificationType;

/**
 * 푸시 페이로드 분류 — 서비스워커가 표시·억제(지금 보고 있는 대화면 숨김)·미리보기 가림을 정하는 단위이며 NotificationType 을 이 넷으로 묶는다. 알림을
 * 받을지는 이 분류가 아니라 알림 설정(NotificationSettingItem)이 정한다(WP-913). 옛 종류별 푸시 설정(notification_preference)은
 * 남아 있으나 판정에 쓰지 않는다.
 */
public enum PushCategory {
  DM,
  MENTION,
  ISSUE,
  CALENDAR;

  /**
   * 인박스 알림 유형 → 기본 카테고리. 이슈 계열은 ISSUE, 일정 계열은 CALENDAR, 이슈 챗·코멘트 멘션은 MENTION. AI_QUESTION 은 기본
   * ISSUE 이고 그 질문 글에서 멘션된 수신자만 NotificationService 가 MENTION 으로 따로 보낸다(WP-452).
   */
  public static PushCategory of(NotificationType type) {
    return switch (type) {
      case ASSIGNED,
          COMMENTED,
          STATUS_CHANGED,
          PRIORITY_CHANGED,
          AI_QUESTION,
          AI_REVIEW_REQUESTED,
          AI_WORK_FAILED ->
          ISSUE;
      // 노트 공유 알림(WP-579)은 「나를 향한」 알림이라 MENTION 으로 묶는다 — 카테고리 CHECK(V137)를 넓히지 않으려고.
      case ISSUE_CHAT_MENTION,
          ISSUE_COMMENT_MENTION,
          WIKI_SHARED,
          WIKI_SHARE_ACCESS_REQUESTED,
          WIKI_SHARE_ACCESS_APPROVED ->
          MENTION;
      case REMINDER,
          CALENDAR_INVITED,
          CALENDAR_RSVP_CHANGED,
          CALENDAR_EVENT_UPDATED,
          CALENDAR_EVENT_CANCELED ->
          CALENDAR;
    };
  }
}

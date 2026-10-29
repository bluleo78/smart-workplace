package com.workplace.notify.dto;

import static com.workplace.notify.dto.NotificationApp.CALENDAR;
import static com.workplace.notify.dto.NotificationApp.CHAT;
import static com.workplace.notify.dto.NotificationApp.ISSUE;
import static com.workplace.notify.dto.NotificationApp.WIKI;

/**
 * 알림 설정의 한 줄(알림 종류 하나) — 선언 순서가 설정 화면의 줄 순서다. 각 줄은 「사람이」·「AI가」 두 칸을 가지며, 칸의 기본값은 이 상수가 정한다(DB 에는
 * 사용자가 바꾼 값만 저장 — 기본값을 바꾸면 손대지 않은 사용자에게 바로 반영). 생성자의 기본값이 {@code null} 이면 그 칸은 없다(화면에 「–」, 예: AI 작업
 * 알림의 「사람이」, 리마인더의 「AI가」). 기본값은 스펙 §4 표 그대로다.
 */
public enum NotificationSettingItem {
  ISSUE_ASSIGNED(ISSUE, true, false),
  ISSUE_COMMENTED(ISSUE, true, false),
  ISSUE_STATUS_CHANGED(ISSUE, false, false),
  ISSUE_PRIORITY_CHANGED(ISSUE, false, false),
  ISSUE_MENTIONED(ISSUE, true, true),
  ISSUE_AI_NEEDS_INPUT(ISSUE, null, true), // 질문·권한 필요·막힘 — 「사람이 손대야 AI 가 계속한다」 하나로 묶음
  ISSUE_AI_REVIEW_REQUESTED(ISSUE, null, true),
  ISSUE_AI_FAILED(ISSUE, null, true), // 실패·거절
  CHAT_DM(CHAT, true, true),
  CHAT_CHANNEL_MENTION(CHAT, true, true),
  CALENDAR_INVITED(CALENDAR, true, true),
  CALENDAR_EVENT_UPDATED(CALENDAR, true, true),
  CALENDAR_EVENT_CANCELED(CALENDAR, true, true),
  CALENDAR_RSVP_CHANGED(CALENDAR, true, true),
  CALENDAR_REMINDER(CALENDAR, true, null), // 행위자 없음 → 「사람이」 한 칸
  WIKI_SHARED(WIKI, true, true),
  WIKI_ACCESS_REQUESTED(WIKI, true, true),
  WIKI_ACCESS_APPROVED(WIKI, true, true);

  private final NotificationApp app;
  private final Boolean humanDefault; // null = 「사람이」 칸 없음
  private final Boolean agentDefault; // null = 「AI가」 칸 없음

  NotificationSettingItem(NotificationApp app, Boolean humanDefault, Boolean agentDefault) {
    this.app = app;
    this.humanDefault = humanDefault;
    this.agentDefault = agentDefault;
  }

  /** 이 줄이 속한 앱(앱 전체 스위치 판정용). */
  public NotificationApp app() {
    return app;
  }

  /** 그 행위자 열에 칸이 있는지. */
  public boolean has(NotificationActor actor) {
    return defaultOrNull(actor) != null;
  }

  /** 그 칸의 기본값. 칸이 없으면 호출 오류라 {@link IllegalArgumentException}. */
  public boolean defaultFor(NotificationActor actor) {
    Boolean d = defaultOrNull(actor);
    if (d == null) throw new IllegalArgumentException(name() + " 에는 " + actor + " 칸이 없다");
    return d;
  }

  /**
   * 실제 행위자로 판정할 칸. 그 칸이 있으면 그대로, 없으면 하나뿐인 칸으로 보낸다 — 예: AI 전용 항목을 사람이 일으키면(사람 명의 AI 쓰기) 「AI가」 칸,
   * 리마인더에 행위자가 AGENT 로 잡혀도 「사람이」 칸. 칸 없는 쪽의 설정이 없어 알림이 판정 불가가 되는 일을 막는다.
   */
  public NotificationActor column(NotificationActor actual) {
    if (has(actual)) return actual;
    return actual == NotificationActor.HUMAN ? NotificationActor.AGENT : NotificationActor.HUMAN;
  }

  private Boolean defaultOrNull(NotificationActor actor) {
    return actor == NotificationActor.HUMAN ? humanDefault : agentDefault;
  }

  /**
   * 알림 종류 → 설정 줄. default 없는 switch 라 {@link NotificationType} 에 값을 더하면 여기서 컴파일 오류가 나 매핑 누락을 막는다.
   * 멘션 두 종류(코멘트·이슈 챗)는 「나를 멘션」 한 줄로 모은다.
   */
  public static NotificationSettingItem of(NotificationType type) {
    return switch (type) {
      // 보고자로 지정됨(WP-944)도 「나에게 맡겨진 이슈」라 같은 줄로 받는다.
      case ASSIGNED, REPORTER_ASSIGNED -> ISSUE_ASSIGNED;
      case COMMENTED -> ISSUE_COMMENTED;
      case STATUS_CHANGED -> ISSUE_STATUS_CHANGED;
      case PRIORITY_CHANGED -> ISSUE_PRIORITY_CHANGED;
      case ISSUE_COMMENT_MENTION, ISSUE_CHAT_MENTION -> ISSUE_MENTIONED;
      case AI_QUESTION -> ISSUE_AI_NEEDS_INPUT;
      case AI_REVIEW_REQUESTED -> ISSUE_AI_REVIEW_REQUESTED;
      case AI_WORK_FAILED -> ISSUE_AI_FAILED;
      case REMINDER -> CALENDAR_REMINDER;
      case CALENDAR_INVITED -> CALENDAR_INVITED;
      case CALENDAR_RSVP_CHANGED -> CALENDAR_RSVP_CHANGED;
      case CALENDAR_EVENT_UPDATED -> CALENDAR_EVENT_UPDATED;
      case CALENDAR_EVENT_CANCELED -> CALENDAR_EVENT_CANCELED;
      case WIKI_SHARED -> WIKI_SHARED;
      case WIKI_SHARE_ACCESS_REQUESTED -> WIKI_ACCESS_REQUESTED;
      case WIKI_SHARE_ACCESS_APPROVED -> WIKI_ACCESS_APPROVED;
      // 개인 비서 연결 회수(WP-1170)는 설정 줄이 없다 — 늘 보내므로 설정 판정을 거치지 않는다(NotificationService).
      case PERSONAL_ASSISTANT_REVOKED ->
          throw new IllegalArgumentException(type + " 는 알림 설정 없이 늘 보낸다");
    };
  }
}

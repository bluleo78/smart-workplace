package com.workplace.notify.dto;

import static com.workplace.notify.dto.NotificationActor.AGENT;
import static com.workplace.notify.dto.NotificationActor.HUMAN;
import static com.workplace.notify.dto.NotificationSettingItem.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 알림 설정 항목 상수 단위 테스트 — 기본값이 코드 상수라 스펙 §4 표가 유일한 근거다. 표 18줄 전체(칸 없음 포함)를 그대로 옮겨 단언해 기본값 오타가 통과하지 못하게
 * 한다.
 */
class NotificationSettingItemTest {

  /** 스펙 §4 표 한 줄 — 앱, 「사람이」 기본값, 「AI가」 기본값(null = 칸 없음). */
  private record Row(
      NotificationSettingItem item, NotificationApp app, Boolean human, Boolean agent) {}

  /** 스펙 §4 표(화면 순서 그대로). */
  private static final List<Row> SPEC =
      List.of(
          new Row(ISSUE_ASSIGNED, NotificationApp.ISSUE, true, false),
          new Row(ISSUE_COMMENTED, NotificationApp.ISSUE, true, false),
          new Row(ISSUE_STATUS_CHANGED, NotificationApp.ISSUE, false, false),
          new Row(ISSUE_PRIORITY_CHANGED, NotificationApp.ISSUE, false, false),
          new Row(ISSUE_MENTIONED, NotificationApp.ISSUE, true, true),
          new Row(ISSUE_AI_NEEDS_INPUT, NotificationApp.ISSUE, null, true),
          new Row(ISSUE_AI_REVIEW_REQUESTED, NotificationApp.ISSUE, null, true),
          new Row(ISSUE_AI_FAILED, NotificationApp.ISSUE, null, true),
          new Row(CHAT_DM, NotificationApp.CHAT, true, true),
          new Row(CHAT_CHANNEL_MENTION, NotificationApp.CHAT, true, true),
          new Row(CALENDAR_INVITED, NotificationApp.CALENDAR, true, true),
          new Row(CALENDAR_EVENT_UPDATED, NotificationApp.CALENDAR, true, true),
          new Row(CALENDAR_EVENT_CANCELED, NotificationApp.CALENDAR, true, true),
          new Row(CALENDAR_RSVP_CHANGED, NotificationApp.CALENDAR, true, true),
          new Row(CALENDAR_REMINDER, NotificationApp.CALENDAR, true, null),
          new Row(WIKI_SHARED, NotificationApp.WIKI, true, true),
          new Row(WIKI_ACCESS_REQUESTED, NotificationApp.WIKI, true, true),
          new Row(WIKI_ACCESS_APPROVED, NotificationApp.WIKI, true, true));

  @Test
  void everyNotificationType_mapsToAnItem() {
    for (NotificationType t : NotificationType.values()) {
      assertThat(NotificationSettingItem.of(t)).isNotNull();
    }
  }

  @Test
  void mentionTypes_shareOneItem() {
    assertThat(NotificationSettingItem.of(NotificationType.ISSUE_COMMENT_MENTION))
        .isEqualTo(ISSUE_MENTIONED);
    assertThat(NotificationSettingItem.of(NotificationType.ISSUE_CHAT_MENTION))
        .isEqualTo(ISSUE_MENTIONED);
    assertThat(NotificationSettingItem.of(NotificationType.REMINDER)).isEqualTo(CALENDAR_REMINDER);
  }

  @Test
  void defaults_matchSpecTable() {
    // 선언 순서 = 화면 순서 = 표 순서, 그리고 표에 없는 항목이 없다.
    assertThat(Arrays.asList(NotificationSettingItem.values()))
        .containsExactlyElementsOf(SPEC.stream().map(Row::item).toList());
    for (Row r : SPEC) {
      assertThat(r.item().app()).as("%s app", r.item()).isEqualTo(r.app());
      assertCell(r.item(), HUMAN, r.human());
      assertCell(r.item(), AGENT, r.agent());
    }
  }

  private static void assertCell(
      NotificationSettingItem item, NotificationActor actor, Boolean expected) {
    if (expected == null) {
      assertThat(item.has(actor)).as("%s/%s 칸 없음", item, actor).isFalse();
      assertThatThrownBy(() -> item.defaultFor(actor)).isInstanceOf(IllegalArgumentException.class);
    } else {
      assertThat(item.has(actor)).as("%s/%s 칸 있음", item, actor).isTrue();
      assertThat(item.defaultFor(actor)).as("%s/%s 기본값", item, actor).isEqualTo(expected);
    }
  }

  @Test
  void column_fallsBackToTheOnlyColumn() {
    assertThat(ISSUE_AI_REVIEW_REQUESTED.column(HUMAN)).isEqualTo(AGENT);
    assertThat(ISSUE_AI_NEEDS_INPUT.column(AGENT)).isEqualTo(AGENT);
    assertThat(CALENDAR_REMINDER.column(AGENT)).isEqualTo(HUMAN);
    assertThat(ISSUE_ASSIGNED.column(AGENT)).isEqualTo(AGENT);
    assertThat(ISSUE_ASSIGNED.column(HUMAN)).isEqualTo(HUMAN);
  }
}

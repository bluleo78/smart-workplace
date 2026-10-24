// 알림 설정 mock 팩토리(WP-913) — /api/v1/notification-settings 응답. 서버 NotificationSettingItem 기본값(스펙 §4)과 같은 18칸이며
// 칸이 없는 쪽은 null 이다. 앱·줄 순서도 서버 응답 순서(이슈 → 채팅 → 캘린더 → 노트)와 같다.
import type { NotificationItemSetting, NotificationSettings } from '../../src/types/notificationSettings'

const item = (i: NotificationItemSetting['item'], human: boolean | null, agent: boolean | null): NotificationItemSetting => ({
  item: i,
  human,
  agent,
})

export function defaultNotificationSettings(): NotificationSettings {
  return {
    apps: [
      {
        app: 'ISSUE',
        enabled: true,
        items: [
          item('ISSUE_ASSIGNED', true, false),
          item('ISSUE_COMMENTED', true, false),
          item('ISSUE_STATUS_CHANGED', false, false),
          item('ISSUE_PRIORITY_CHANGED', false, false),
          item('ISSUE_MENTIONED', true, true),
          item('ISSUE_AI_NEEDS_INPUT', null, true),
          item('ISSUE_AI_REVIEW_REQUESTED', null, true),
          item('ISSUE_AI_FAILED', null, true),
        ],
      },
      {
        app: 'CHAT',
        enabled: true,
        items: [item('CHAT_DM', true, true), item('CHAT_CHANNEL_MENTION', true, true)],
      },
      {
        app: 'CALENDAR',
        enabled: true,
        items: [
          item('CALENDAR_INVITED', true, true),
          item('CALENDAR_EVENT_UPDATED', true, true),
          item('CALENDAR_EVENT_CANCELED', true, true),
          item('CALENDAR_RSVP_CHANGED', true, true),
          item('CALENDAR_REMINDER', true, null),
        ],
      },
      {
        app: 'WIKI',
        enabled: true,
        items: [item('WIKI_SHARED', true, true), item('WIKI_ACCESS_REQUESTED', true, true), item('WIKI_ACCESS_APPROVED', true, true)],
      },
    ],
  }
}

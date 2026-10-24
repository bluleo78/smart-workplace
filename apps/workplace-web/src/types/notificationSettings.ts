// src/types/notificationSettings.ts
// 앱·항목·행위자별 알림 설정 타입(WP-913) — 백엔드 NotificationSettingsController 계약(GET/PUT /notification-settings)과 1:1.
// e2e 팩토리가 상대 경로로 가져다 쓰므로 `@/` 별칭 import 를 두지 않는다.

/** 알림 설정의 앱 묶음 — 응답 순서가 화면 카드 순서(이슈 → 채팅 → 캘린더 → 노트). */
export type NotificationApp = 'ISSUE' | 'CHAT' | 'CALENDAR' | 'WIKI'

/** 알림 설정의 한 줄(알림 종류 하나). 서버 enum NotificationSettingItem 과 같은 18개. */
export type NotificationSettingItem =
  | 'ISSUE_ASSIGNED'
  | 'ISSUE_COMMENTED'
  | 'ISSUE_STATUS_CHANGED'
  | 'ISSUE_PRIORITY_CHANGED'
  | 'ISSUE_MENTIONED'
  | 'ISSUE_AI_NEEDS_INPUT'
  | 'ISSUE_AI_REVIEW_REQUESTED'
  | 'ISSUE_AI_FAILED'
  | 'CHAT_DM'
  | 'CHAT_CHANNEL_MENTION'
  | 'CALENDAR_INVITED'
  | 'CALENDAR_EVENT_UPDATED'
  | 'CALENDAR_EVENT_CANCELED'
  | 'CALENDAR_RSVP_CHANGED'
  | 'CALENDAR_REMINDER'
  | 'WIKI_SHARED'
  | 'WIKI_ACCESS_REQUESTED'
  | 'WIKI_ACCESS_APPROVED'

/** 알림을 일으킨 쪽 — 줄마다 「사람이」·「AI가」 두 칸. */
export type NotificationActor = 'HUMAN' | 'AGENT'

/** 줄 하나. 칸이 없는 쪽은 null(예: AI 작업 알림의 사람이, 리마인더의 AI가). 값은 앱 스위치를 반영하지 않은 저장값·기본값. */
export interface NotificationItemSetting {
  item: NotificationSettingItem
  human: boolean | null
  agent: boolean | null
}

/** 앱 하나 — 앱 전체 스위치와 그 앱의 줄들. */
export interface NotificationAppSetting {
  app: NotificationApp
  enabled: boolean
  items: NotificationItemSetting[]
}

export interface NotificationSettings {
  apps: NotificationAppSetting[]
}

/** 부분 수정 — 바뀐 앱 스위치와 바뀐 칸만 보낸다(생략한 쪽은 그대로). */
export interface UpdateNotificationSettingsRequest {
  apps?: Partial<Record<NotificationApp, boolean>>
  cells?: { item: NotificationSettingItem; actor: NotificationActor; enabled: boolean }[]
}

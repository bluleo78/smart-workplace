// src/lib/notificationSettingsMeta.ts
// 알림 설정 화면의 문구와 칸 표시 규칙(WP-913). 문구는 합의 시안 v2 그대로 — 줄 순서·칸 유무는 서버 응답이 정한다.
import type { NotificationApp, NotificationAppSetting, NotificationSettingItem } from '@/types/notificationSettings'

export const APP_LABEL: Record<NotificationApp, string> = {
  ISSUE: '이슈',
  CHAT: '채팅',
  CALENDAR: '캘린더',
  WIKI: '노트',
}

/**
 * 앱 카드 안 첫 줄 안내 — 그 앱만 알림이 닿는 곳이 다를 때(WP-913). 채팅은 인박스 알림 종류가 없어 알림 = 푸시뿐이고, 꺼도 메시지·안 읽음
 * 표시는 채팅에 그대로 남는다 — 화면 위 「끄면 알림 목록·실시간 표시·푸시 모두 오지 않아요」와 다르다는 걸 그 카드에서 바로 알게 한다.
 */
export const APP_NOTE: Partial<Record<NotificationApp, string>> = {
  CHAT: '채팅은 알림 목록에 쌓이지 않고 푸시로만 알려요. 꺼도 메시지와 안 읽음 표시는 채팅에 그대로 있어요.',
}

/** 줄 이름·설명. ai: AI 가 맡은 작업에서만 생기는 알림 — 라벨 옆에 AI 배지를 붙인다. */
export const ITEM_META: Record<NotificationSettingItem, { label: string; description?: string; ai?: boolean }> = {
  ISSUE_ASSIGNED: { label: '나에게 할당', description: '누군가 나를 담당자로 지정' },
  ISSUE_COMMENTED: { label: '코멘트', description: '내가 담당·지켜보는 이슈' },
  ISSUE_STATUS_CHANGED: { label: '상태 변경', description: '완료 포함 · 내가 담당·지켜보는 이슈' },
  ISSUE_PRIORITY_CHANGED: { label: '우선순위 변경' },
  ISSUE_MENTIONED: { label: '나를 멘션' },
  ISSUE_AI_NEEDS_INPUT: { label: '답변 필요', description: '질문 · 권한 필요 · 막힘', ai: true },
  ISSUE_AI_REVIEW_REQUESTED: { label: '검토 요청', description: '내가 맡긴 작업이 검토 대기', ai: true },
  ISSUE_AI_FAILED: { label: '실패', description: '내가 맡긴 작업 실패·거절', ai: true },
  CHAT_DM: { label: 'DM' },
  CHAT_CHANNEL_MENTION: { label: '채널에서 나를 멘션' },
  CALENDAR_INVITED: { label: '초대' },
  CALENDAR_EVENT_UPDATED: { label: '일정 변경' },
  CALENDAR_EVENT_CANCELED: { label: '일정 취소' },
  CALENDAR_RSVP_CHANGED: { label: '참석 응답' },
  CALENDAR_REMINDER: { label: '리마인더', description: '시간이 되면 알림' },
  WIKI_SHARED: { label: '공유받음' },
  WIKI_ACCESS_REQUESTED: { label: '접근 요청' },
  WIKI_ACCESS_APPROVED: { label: '접근 승인' },
}

/**
 * 화면이 아는 앱·항목만 남긴다 — 서버가 새 앱·항목을 먼저 배포해도(웹이 아직 모르는 값) 이름 없는 카드·줄로 화면이 깨지지 않게 건너뛴다(#585 선례).
 * 타입상 응답은 늘 아는 값이지만 실제 응답은 서버 버전을 따르므로, 조회 맵을 부분 맵으로 보고 확인한다.
 */
export function knownApps(apps: NotificationAppSetting[]): NotificationAppSetting[] {
  const appLabels: Partial<Record<string, string>> = APP_LABEL
  const itemMeta: Partial<Record<string, unknown>> = ITEM_META
  return apps
    .filter((a) => appLabels[a.app] !== undefined)
    .map((a) => ({ ...a, items: a.items.filter((it) => itemMeta[it.item] !== undefined) }))
}

/**
 * 칸 하나를 어떻게 그릴지.
 * - value null: 그 행위자 칸이 없다 → 스위치를 그리지 않는다(빈 자리).
 * - 앱이 꺼져 있으면: 칸 값과 상관없이 꺼진 것처럼 보이고 잠근다. 서버는 칸 값을 그대로 보존하므로 앱을 다시 켜면 원래 값으로 돌아온다.
 */
export function cellView(appEnabled: boolean, value: boolean | null): { present: boolean; checked: boolean; locked: boolean } {
  if (value == null) return { present: false, checked: false, locked: false }
  return { present: true, checked: appEnabled && value, locked: !appEnabled }
}

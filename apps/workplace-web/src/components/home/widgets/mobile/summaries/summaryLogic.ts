// 모바일 요약 한 줄의 순수 선택 규칙(WP-142) — 접힘·타일에 무엇을 보일지 컴포넌트에서 떼어 vitest 로 결정적으로 검증한다.
// 규칙은 각 위젯 본문(PriorityQuadrantBody·UnreadMailBody·SynthesisLayer)과 같은 기준을 따른다 — 본문과 겹치는 판정
// (일정 시각·사분면·발신자)은 본문 쪽 bodyRules 를 그대로 가져다 쓴다(복제 금지).
import type { PriorityItem } from '@/api/priorityItems'
import { parseUtcDate } from '@/lib/formatters'
import { isNeedsReply } from '@/lib/mailNeedsReply'
import type { CalendarEvent } from '@/types/calendar'
import type { MailSummary, MailSummaryItem } from '@/types/dashboard'
import type { ChannelResponse } from '@/types/messaging'
import type { NotificationResponse } from '@/types/notification'

import { eventTime, type QuadrantKey, quadrantOf, sortKey } from '../../dashboard/bodyRules'

// 이름 나열 최대 개수 — 한 줄 말줄임에 어차피 가려질 뒷부분까지 만들지 않는다.
// 타일 요약 조회도 이만큼만 받는다(프로젝트 size·연락처 limit, WP-160) — 값을 바꾸면 조회 건수도 같이 바뀐다.
export const MAX_NAMES = 5

/**
 * 다음 일정 — 지금 이후 시작하는 시각 일정 중 가장 이른 것, 없으면 종일 일정, 그것도 없으면 null(남은 일정 없음).
 * 정렬 없이 한 번 훑는다. 시작시각 미정은 sortKey 가 Infinity 라 `t < nextT` 에서 걸러지고, 동시각은 먼저 온 것이 남는다.
 */
export function pickNextEvent(events: CalendarEvent[], now: Date): CalendarEvent | null {
  const nowT = now.getTime()
  let next: CalendarEvent | null = null
  let nextT = Number.POSITIVE_INFINITY
  for (const e of events) {
    if (e.allDay) continue
    const t = sortKey(e)
    if (t >= nowT && t < nextT) {
      next = e
      nextT = t
    }
  }
  return next ?? events.find((e) => e.allDay) ?? null
}

/** 일정 시각 라벨 — 오늘 일정 본문의 리딩 라벨과 같다(종일·HH:mm·미정). */
export function eventTimeLabel(ev: CalendarEvent): string {
  return eventTime(ev).label
}

// 모바일 요약 칩의 짧은 사분면 라벨 — 좁은 한 줄이라 본문 분면 제목('긴급 + 중요')보다 짧게 쓴다.
const QUADRANT_SHORT_LABEL = {
  'urgent-important': '긴급·중요',
  important: '중요',
  urgent: '긴급',
  low: '낮음',
} as const satisfies Record<QuadrantKey, string>

/** AI 우선순위 사분면 라벨 — 판정은 PriorityQuadrantBody 와 같은 bodyRules.quadrantOf(임계값 50). */
export function quadrantLabel(item: PriorityItem): (typeof QUADRANT_SHORT_LABEL)[QuadrantKey] {
  return QUADRANT_SHORT_LABEL[quadrantOf(item)]
}

/** 최상위 우선순위 항목 — 중요도+긴급도 합이 가장 큰 것(동점은 응답 순서 유지). */
export function topPriorityItem(items: PriorityItem[]): PriorityItem | null {
  let best: PriorityItem | null = null
  for (const i of items) {
    if (!best || i.importanceScore + i.urgencyScore > best.importanceScore + best.urgencyScore) best = i
  }
  return best
}

/**
 * 메일 건수 배지 — AI 분류가 켜졌으면 회신 필요, 아니면 안 읽음. 데스크톱 요약 KPI(SynthesisLayer)·모바일 접힘 한 줄
 * (useSynthesisCounts)·메일 요약이 모두 이 스왑 규칙 하나를 쓴다. 데이터가 아직 없으면(로딩) 0.
 */
export function mailBadgeCount(s: MailSummary | undefined): number {
  if (!s) return 0
  return s.classificationActive ? s.needsReplyCount : s.unreadCount
}

/** 요약에 보일 메일 1건 — 회신 필요 메일 우선, 없으면 최신(목록 첫 항목). */
export function pickLatestMail(recent: MailSummaryItem[]): MailSummaryItem | null {
  return recent.find((m) => isNeedsReply(m)) ?? recent[0] ?? null
}

/** 가장 최근의 안 읽은 알림(createdAt 가장 늦은 것, 동시각은 앞선 항목). 없으면 null. 정렬 없이 한 번 훑는다. */
export function latestUnreadNotification(items: NotificationResponse[]): NotificationResponse | null {
  let latest: NotificationResponse | null = null
  let latestT = Number.NEGATIVE_INFINITY
  for (const n of items) {
    if (n.read) continue
    const t = parseUtcDate(n.createdAt).getTime()
    if (!latest || t > latestT) {
      latest = n
      latestT = t
    }
  }
  return latest
}

/** 채널 안 읽음 합계 — 타일 건수 배지. */
export function totalUnread(channels: ChannelResponse[]): number {
  return channels.reduce((sum, c) => sum + c.unreadCount, 0)
}

/** 요약에 보일 채널 — 안 읽음이 가장 많은 채널(동률은 앞), 모두 0이면 목록 첫 채널. */
export function pickBusiestChannel(channels: ChannelResponse[]): ChannelResponse | null {
  let best: ChannelResponse | null = null
  for (const c of channels) if (!best || c.unreadCount > best.unreadCount) best = c
  return best
}

/** 이름 목록을 ' · ' 로 잇는다 — 빈 이름은 빼고 앞 MAX_NAMES 개만. */
export function joinNames(names: string[]): string {
  return names
    .filter((n) => n.trim() !== '')
    .slice(0, MAX_NAMES)
    .join(' · ')
}

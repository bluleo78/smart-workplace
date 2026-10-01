// 모바일 요약 한 줄의 순수 선택 규칙(WP-142) — 접힘·타일에 무엇을 보일지 컴포넌트에서 떼어 vitest 로 결정적으로 검증한다.
// 규칙은 각 위젯 본문(PriorityQuadrantBody·UnreadMailBody·SynthesisLayer)과 같은 기준을 따른다.
import type { PriorityItem } from '@/api/priorityItems'
import { formatLocalClockTime24, parseUtcDate } from '@/lib/formatters'
import { isNeedsReply } from '@/lib/mailNeedsReply'
import type { CalendarEvent } from '@/types/calendar'
import type { MailSummary, MailSummaryItem } from '@/types/dashboard'
import type { ChannelResponse } from '@/types/messaging'
import type { NotificationResponse } from '@/types/notification'

// 이름 나열 최대 개수 — 한 줄 말줄임에 어차피 가려질 뒷부분까지 만들지 않는다.
const MAX_NAMES = 5

/** 다음 일정 — 지금 이후 시작하는 시각 일정 중 가장 이른 것, 없으면 종일 일정, 그것도 없으면 null(남은 일정 없음). */
export function pickNextEvent(events: CalendarEvent[], now: Date): CalendarEvent | null {
  const upcoming = events
    .filter((e) => !e.allDay)
    .map((e) => ({ e, t: parseUtcDate(e.startsAt).getTime() }))
    .filter(({ t }) => !Number.isNaN(t) && t >= now.getTime())
    .sort((a, b) => a.t - b.t)
  if (upcoming.length > 0) return upcoming[0].e
  return events.find((e) => e.allDay) ?? null
}

/** 일정 시각 라벨 — 종일은 '종일', 그 외 대시보드 공용 24시간제(HH:mm). */
export function eventTimeLabel(ev: CalendarEvent): string {
  return ev.allDay ? '종일' : formatLocalClockTime24(ev.startsAt)
}

/** AI 우선순위 사분면 라벨 — PriorityQuadrantBody 와 같은 임계값(50). */
export function quadrantLabel(item: PriorityItem): '긴급·중요' | '중요' | '긴급' | '낮음' {
  const important = item.importanceScore >= 50
  const urgent = item.urgencyScore >= 50
  if (important && urgent) return '긴급·중요'
  if (important) return '중요'
  if (urgent) return '긴급'
  return '낮음'
}

/** 최상위 우선순위 항목 — 중요도+긴급도 합이 가장 큰 것(동점은 응답 순서 유지). */
export function topPriorityItem(items: PriorityItem[]): PriorityItem | null {
  let best: PriorityItem | null = null
  for (const i of items) {
    if (!best || i.importanceScore + i.urgencyScore > best.importanceScore + best.urgencyScore) best = i
  }
  return best
}

/** 메일 건수 배지 — AI 분류가 켜졌으면 회신 필요, 아니면 안 읽음(SynthesisLayer KPI 와 같은 스왑 규칙). */
export function mailBadgeCount(s: MailSummary): number {
  return s.classificationActive ? s.needsReplyCount : s.unreadCount
}

/** 요약에 보일 메일 1건 — 회신 필요 메일 우선, 없으면 최신(목록 첫 항목). */
export function pickLatestMail(recent: MailSummaryItem[]): MailSummaryItem | null {
  return recent.find((m) => isNeedsReply(m)) ?? recent[0] ?? null
}

/** 발신자 표시명 — UnreadMailBody 와 같은 규칙(이름 → 주소 → 알 수 없음). */
export function mailSender(m: Pick<MailSummaryItem, 'fromName' | 'fromAddress'>): string {
  return m.fromName?.trim() || m.fromAddress || '(알 수 없음)'
}

/** 가장 최근의 안 읽은 알림(createdAt 내림차순 첫 건). 없으면 null. */
export function latestUnreadNotification(items: NotificationResponse[]): NotificationResponse | null {
  return (
    items
      .filter((n) => !n.read)
      .sort((a, b) => parseUtcDate(b.createdAt).getTime() - parseUtcDate(a.createdAt).getTime())[0] ?? null
  )
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

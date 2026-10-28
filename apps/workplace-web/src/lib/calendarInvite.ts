// 메일 일정 초대 카드(WP-986)의 표시 문구를 만드는 순수 함수.
// 일시 표기는 일정 상세 보기(eventTimeLines, WP-708)와 같은 규칙 — 브라우저 로컬 타임존, ICU 로케일 비의존.
import { eventTimeLines, RSVP_LABEL } from '@/lib/calendarEventView'
import { formatLocalDateWithWeekday, localClockParts } from '@/lib/formatters'
import type { CalendarInvite, CalendarInviteResponse } from '@/types/mailMessage'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 초대 일시 한 줄 — 「11월 3일 (화) 오후 2:00 – 3:00」.
 * - 종일: 날짜만(「11월 3일 (화)」, 여러 날이면 「… – …」). 끝이 없으면 하루짜리로 본다.
 * - 시간 일정인데 끝이 없으면 시작 시각만(「11월 3일 (화) 오후 2:00」).
 */
export function inviteTimeText(invite: Pick<CalendarInvite, 'start' | 'end' | 'allDay'>, now: Date = new Date()): string {
  if (invite.allDay) {
    const endsAt = invite.end ?? new Date(new Date(invite.start).getTime() + DAY_MS).toISOString()
    return eventTimeLines({ startsAt: invite.start, endsAt, allDay: true }, now).date
  }
  if (!invite.end) {
    const start = new Date(invite.start)
    const { meridiem, clock } = localClockParts(start)
    return `${formatLocalDateWithWeekday(start, now)} ${meridiem} ${clock}`
  }
  const { date, time } = eventTimeLines({ startsAt: invite.start, endsAt: invite.end, allDay: false }, now)
  return time ? `${date} ${time}` : date
}

/** 주최자 표시 — 이름이 있으면 「이름 <메일>」, 없으면 메일만. 주최자를 모르면 null(행 생략). */
export function inviteOrganizerText(organizer: CalendarInvite['organizer']): string | null {
  if (!organizer) return null
  return organizer.name ? `${organizer.name} <${organizer.email}>` : organizer.email
}

/**
 * 응답 결과 문구 — 「수락했습니다 — 주최자에게 응답을 보냈습니다」. 응답 전(NEEDS_ACTION)이면 null.
 * 동사는 RSVP 버튼 문구(RSVP_LABEL)와 맞춘다.
 */
export function inviteResultText(response: CalendarInviteResponse): string | null {
  if (response === 'NEEDS_ACTION') return null
  const verb = response === 'TENTATIVE' ? `${RSVP_LABEL.TENTATIVE}으로 응답했습니다` : `${RSVP_LABEL[response]}했습니다`
  return `${verb} — 주최자에게 응답을 보냈습니다`
}

/**
 * 카드 아래쪽에 무엇을 보일지 — 버튼(respond) · 변경된 옛 초대 안내(outdated) · 아무것도(none).
 * 취소 메일은 언제나 버튼이 없다(서버도 canRespond=false 로 준다).
 */
export function inviteActionMode(invite: Pick<CalendarInvite, 'method' | 'canRespond' | 'outdated'>): 'respond' | 'outdated' | 'none' {
  if (invite.method === 'CANCEL') return 'none'
  if (invite.canRespond) return 'respond'
  return invite.outdated ? 'outdated' : 'none'
}

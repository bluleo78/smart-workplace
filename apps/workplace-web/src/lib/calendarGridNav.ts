// 캘린더 격자 키보드 이동 계산 — 순수 함수라 컴포넌트와 분리해 단위 테스트한다(WP-1906).
import { format, isSameDay } from 'date-fns'
import { ko } from 'date-fns/locale'

/** 월 보기 칸 수(6주 × 7일). */
const MONTH_CELLS = 42
/** 한 주의 칸 수. */
const WEEK = 7

/**
 * 월 보기 42칸에서 방향키·Home/End 를 눌렀을 때 다음 초점 index 를 구한다.
 * 격자 밖으로 나가는 이동은 현재 index 그대로(멈춤)이고, 이동 키가 아니면 null(호출자가 따로 처리).
 */
export function nextMonthCellIndex(index: number, key: string): number | null {
  const rowStart = index - (index % WEEK)
  let next: number
  switch (key) {
    case 'ArrowLeft':
      next = index - 1
      break
    case 'ArrowRight':
      next = index + 1
      break
    case 'ArrowUp':
      next = index - WEEK
      break
    case 'ArrowDown':
      next = index + WEEK
      break
    case 'Home':
      next = rowStart
      break
    case 'End':
      next = rowStart + WEEK - 1
      break
    default:
      return null
  }
  return next < 0 || next >= MONTH_CELLS ? index : next
}

/** 날짜 칸의 접근 이름 — 「2026년 11월 21일 토요일」, 오늘이면 끝에 「, 오늘」. */
export function calendarDayLabel(day: Date, today: boolean): string {
  return format(day, 'yyyy년 M월 d일 EEEE', { locale: ko }) + (today ? ', 오늘' : '')
}

/**
 * 월 보기의 기본 초점 칸 — 보이는 칸에 오늘이 있으면 오늘, 없으면 anchor 달 1일.
 * Tab 정지점이 항상 하나 있도록 달이 바뀔 때마다 이 값으로 다시 정한다.
 */
export function defaultMonthFocusIndex(cells: Date[], anchor: Date, now: Date): number {
  const todayIdx = cells.findIndex((c) => isSameDay(c, now))
  if (todayIdx >= 0) return todayIdx
  const firstIdx = cells.findIndex((c) => c.getFullYear() === anchor.getFullYear() && c.getMonth() === anchor.getMonth() && c.getDate() === 1)
  return firstIdx >= 0 ? firstIdx : 0
}

/** 시간 격자(주·작업주·일)의 칸 위치 — 날짜 열 index 와 시(0~23). */
export interface TimeSlotPos {
  dayIndex: number
  hour: number
}

/**
 * 시간 격자에서 방향키·Home/End 를 눌렀을 때 다음 칸을 구한다.
 * 위아래는 시(0~23), 좌우는 날짜 열(0~dayCount-1)에서 멈춘다. 이동 키가 아니면 null(호출자가 따로 처리).
 */
export function nextTimeSlot(pos: TimeSlotPos, key: string, dayCount: number): TimeSlotPos | null {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  switch (key) {
    case 'ArrowUp':
      return { ...pos, hour: clamp(pos.hour - 1, 23) }
    case 'ArrowDown':
      return { ...pos, hour: clamp(pos.hour + 1, 23) }
    case 'ArrowLeft':
      return { ...pos, dayIndex: clamp(pos.dayIndex - 1, dayCount - 1) }
    case 'ArrowRight':
      return { ...pos, dayIndex: clamp(pos.dayIndex + 1, dayCount - 1) }
    case 'Home':
      return { ...pos, hour: 0 }
    case 'End':
      return { ...pos, hour: 23 }
    default:
      return null
  }
}

/** 날짜 열의 접근 이름 — 「11월 21일 토요일」. */
export function dayColumnLabel(day: Date): string {
  return format(day, 'M월 d일 EEEE', { locale: ko })
}

/** 시간 칸의 접근 이름 — 「11월 21일 토요일 오전 9시 새 일정」. dayLabel 은 열마다 한 번 만든 dayColumnLabel 값. */
export function timeSlotLabel(dayLabel: string, hour: number): string {
  return `${dayLabel} ${HOUR_LABELS[hour]} 새 일정`
}

/**
 * 0~23시의 「오전 9시」 꼴 문구 — 날짜와 무관해 모듈을 읽을 때 한 번만 만든다.
 * 시간 격자는 끌어 만들기 중 pointermove 마다 다시 그려져, 칸 168개마다 format 을 부르면 프레임마다 수백 번이 된다.
 */
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => format(new Date(2000, 0, 1, h), 'a h시', { locale: ko }))

/**
 * 시간 격자의 기본 초점 칸 — 오늘 열이 있으면 그 열의 지금 시, 없으면 첫 열 오전 8시(스크롤 기본 위치와 맞춘다).
 * Tab 정지점이 항상 하나 있도록 보이는 날짜가 바뀔 때마다 이 값으로 다시 정한다.
 */
export function defaultTimeSlot(days: Date[], now: Date): TimeSlotPos {
  const idx = days.findIndex((d) => isSameDay(d, now))
  return idx >= 0 ? { dayIndex: idx, hour: now.getHours() } : { dayIndex: 0, hour: 8 }
}

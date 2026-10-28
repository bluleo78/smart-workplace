// 개인 작업 반복(WP-989) 순수 함수 — 폼 ↔ RRULE 왕복, 검사 문구, 요약·다음 실행·멈춤 문구.
import { describe, expect, test } from 'vitest'

import {
  buildTaskRRule,
  DEFAULT_TASK_RECURRENCE_FORM,
  monthDayMaySkip,
  nextRunText,
  parseTaskRRule,
  recurrenceLabel,
  recurrencePausedText,
  validateTaskRecurrence,
} from './issueRecurrence'

const form = (o: Partial<typeof DEFAULT_TASK_RECURRENCE_FORM>) => ({ ...DEFAULT_TASK_RECURRENCE_FORM, ...o })

describe('buildTaskRRule', () => {
  test('반복 안 함은 null, 매일은 FREQ=DAILY', () => {
    expect(buildTaskRRule(form({ freq: 'NONE' }))).toBeNull()
    expect(buildTaskRRule(form({ freq: 'DAILY' }))).toBe('FREQ=DAILY')
  })
  test('매주는 요일을 월~일 순으로 정렬해 BYDAY 로', () => {
    expect(buildTaskRRule(form({ freq: 'WEEKLY', byDay: ['WE', 'MO'] }))).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
  })
  test('매월은 BYMONTHDAY', () => {
    expect(buildTaskRRule(form({ freq: 'MONTHLY', monthDay: 15 }))).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
  })
})

describe('parseTaskRRule', () => {
  test('없으면 반복 안 함 기본값, 시각만 옮긴다', () => {
    expect(parseTaskRRule(null)).toEqual(DEFAULT_TASK_RECURRENCE_FORM)
    expect(parseTaskRRule(null, '07:15').time).toBe('07:15')
  })
  test('매주·매월 규칙을 폼으로 되읽는다(왕복)', () => {
    const w = parseTaskRRule('FREQ=WEEKLY;BYDAY=WE,MO', '08:30')
    expect(w).toEqual({ freq: 'WEEKLY', byDay: ['MO', 'WE'], monthDay: 1, time: '08:30' })
    expect(buildTaskRRule(w)).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
    const m = parseTaskRRule('FREQ=MONTHLY;BYMONTHDAY=31', '23:59')
    expect(m.freq).toBe('MONTHLY')
    expect(m.monthDay).toBe(31)
  })
  test('지원하지 않는 FREQ 는 반복 안 함', () => {
    expect(parseTaskRRule('FREQ=YEARLY').freq).toBe('NONE')
  })
})

describe('validateTaskRecurrence', () => {
  test('반복 안 함·정상 값은 통과', () => {
    expect(validateTaskRecurrence(form({ freq: 'NONE', byDay: [] }))).toBeNull()
    expect(validateTaskRecurrence(form({ freq: 'WEEKLY', byDay: ['FR'], time: '08:30' }))).toBeNull()
  })
  test('매주 요일 없음 · 매월 날짜 범위 밖 · 시각 형식', () => {
    expect(validateTaskRecurrence(form({ freq: 'WEEKLY', byDay: [] }))).toBe('요일을 하나 이상 고르세요')
    expect(validateTaskRecurrence(form({ freq: 'MONTHLY', monthDay: 32 }))).toBe('날짜는 1일부터 31일 사이로 고르세요')
    expect(validateTaskRecurrence(form({ freq: 'MONTHLY', monthDay: 0 }))).toBe('날짜는 1일부터 31일 사이로 고르세요')
    expect(validateTaskRecurrence(form({ freq: 'DAILY', time: '24:00' }))).toBe('시각을 HH:mm 으로 입력하세요')
    expect(validateTaskRecurrence(form({ freq: 'DAILY', time: '' }))).toBe('시각을 HH:mm 으로 입력하세요')
  })
})

describe('recurrenceLabel', () => {
  test('매일·매주·매월 요약', () => {
    expect(recurrenceLabel('FREQ=DAILY', '08:30')).toBe('매일 08:30')
    expect(recurrenceLabel('FREQ=WEEKLY;BYDAY=MO,WE', '08:30')).toBe('매주 월·수 08:30')
    expect(recurrenceLabel('FREQ=MONTHLY;BYMONTHDAY=15', '08:30')).toBe('매월 15일 08:30')
  })
  test('BYMONTHDAY 가 여러 날짜면 「매월 1·15일」, 범위 밖이 섞이면 원문', () => {
    expect(recurrenceLabel('FREQ=MONTHLY;BYMONTHDAY=15,1', '08:30')).toBe('매월 1·15일 08:30')
    expect(recurrenceLabel('FREQ=MONTHLY;BYMONTHDAY=1,40', '08:30')).toBe('FREQ=MONTHLY;BYMONTHDAY=1,40 08:30')
    expect(parseTaskRRule('FREQ=MONTHLY;BYMONTHDAY=15,1').monthDay).toBe(1)
  })
  test('읽을 수 없는 규칙은 원문 그대로', () => {
    expect(recurrenceLabel('FREQ=YEARLY', '08:30')).toBe('FREQ=YEARLY 08:30')
  })
})

describe('monthDayMaySkip', () => {
  test('29~31일만 「없는 달」이 있다', () => {
    expect([28, 29, 30, 31].map(monthDayMaySkip)).toEqual([false, true, true, true])
  })
})

describe('nextRunText', () => {
  test('한국 시간으로 「다음 실행 M/D(요일) HH:mm」', () => {
    expect(nextRunText('2026-10-28T23:30:00Z')).toBe('다음 실행 10/29(목) 08:30')
    expect(nextRunText('2026-10-29T08:30:00+09:00')).toBe('다음 실행 10/29(목) 08:30')
  })
  test('없거나 읽을 수 없으면 null', () => {
    expect(nextRunText(null)).toBeNull()
    expect(nextRunText('nope')).toBeNull()
  })
})

describe('recurrencePausedText', () => {
  test('켜짐 null · 3회 이상 실패 멈춤 · 그 밖 꺼짐', () => {
    expect(recurrencePausedText({ enabled: true, consecutiveFailures: 5 })).toBeNull()
    expect(recurrencePausedText({ enabled: false, consecutiveFailures: 3 })).toBe('멈춤 — 3회 연속 실패')
    expect(recurrencePausedText({ enabled: false, consecutiveFailures: 1 })).toBe('꺼짐')
    expect(recurrencePausedText({ enabled: false })).toBe('꺼짐')
  })
})

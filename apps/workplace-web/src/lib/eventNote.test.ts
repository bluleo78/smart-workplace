// 일정 회의록 노트 줄의 순수 함수(WP-1701).
import { describe, expect, test } from 'vitest'

import { canShowNoteRow, firstOccurrenceDate, noteMetaLine } from './eventNote'

const NOW = new Date('2026-06-10T03:00:00Z')

describe('noteMetaLine', () => {
  test('공간 · 고친 사람 · 고친 때 줄을 만든다', () => {
    expect(
      noteMetaLine({ spaceName: '기획팀 공간', updatedByName: '양동희', updatedAt: '2026-06-10T02:50:00Z' }, NOW),
    ).toBe('기획팀 공간 · 양동희 · 10분 전 수정')
  })

  test('고친 사람이 없으면(새 노트) 그 칸과 구분점을 함께 뺀다', () => {
    expect(noteMetaLine({ spaceName: '기획팀 공간', updatedAt: '2026-06-10T02:50:00Z' }, NOW)).toBe('기획팀 공간 · 10분 전 수정')
    expect(noteMetaLine({ spaceName: '기획팀 공간', updatedByName: null, updatedAt: '2026-06-10T02:50:00Z' }, NOW)).toBe(
      '기획팀 공간 · 10분 전 수정',
    )
  })
})

describe('canShowNoteRow', () => {
  test('회차 없는 반복 마스터만 줄을 숨기고, 단일·고친 회차·회차 있는 반복은 그린다', () => {
    expect(canShowNoteRow({ recurrenceRule: 'FREQ=WEEKLY', occurrenceDate: null })).toBe(false)
    expect(canShowNoteRow({ recurrenceRule: 'FREQ=WEEKLY', occurrenceDate: '2026-06-10T01:00:00Z' })).toBe(true)
    expect(canShowNoteRow({ recurrenceRule: null, occurrenceDate: null })).toBe(true)
    expect(canShowNoteRow(undefined)).toBe(false)
  })
})

describe('firstOccurrenceDate', () => {
  test('그 시리즈 회차 중 가장 이른 occurrenceDate, 다른 시리즈·없으면 null', () => {
    const items = [
      { masterEventId: 7, occurrenceDate: '2026-06-18T01:00:00Z' },
      { masterEventId: 8, occurrenceDate: '2026-06-11T01:00:00Z' },
      { masterEventId: 7, occurrenceDate: '2026-06-16T01:00:00Z' },
      { masterEventId: null, occurrenceDate: null },
    ]
    expect(firstOccurrenceDate(7, items)).toBe('2026-06-16T01:00:00Z')
    expect(firstOccurrenceDate(9, items)).toBeNull()
  })
})

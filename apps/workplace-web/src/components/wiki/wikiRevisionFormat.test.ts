import { describe, expect, it } from 'vitest'

import {
  groupRevisionsByDay,
  revisionBarLabel,
  revisionDayLabel,
  revisionEditorsLabel,
  revisionTime,
  revisionVersionLabel,
} from './wikiRevisionFormat'

// 로컬 시각으로 만든 ISO — 실행 머신 시간대와 무관하게 로컬 표시를 검증한다.
const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString()
const NOW = new Date(2026, 9, 7, 15, 0)

describe('wikiRevisionFormat', () => {
  it('시각은 24시간 HH:mm', () => {
    expect(revisionTime(local(2026, 10, 7, 9, 5))).toBe('09:05')
    expect(revisionTime(local(2026, 10, 7, 14, 32))).toBe('14:32')
  })

  it('날짜 묶음은 오늘·어제, 그 밖엔 M월 D일', () => {
    expect(revisionDayLabel(local(2026, 10, 7, 0, 1), NOW)).toBe('오늘')
    expect(revisionDayLabel(local(2026, 10, 6, 23, 59), NOW)).toBe('어제')
    expect(revisionDayLabel(local(2026, 10, 5, 12, 0), NOW)).toBe('10월 5일')
    // 달이 바뀌는 어제
    expect(revisionDayLabel(local(2026, 9, 30, 12, 0), new Date(2026, 9, 1, 8, 0))).toBe('어제')
  })

  it('판 이름은 오늘이면 시각만, 그 밖엔 어제·M월 D일을 앞에 붙인다', () => {
    expect(revisionVersionLabel(local(2026, 10, 7, 14, 5), NOW)).toBe('14:05 버전')
    expect(revisionVersionLabel(local(2026, 10, 6, 17, 48), NOW)).toBe('어제 17:48 버전')
    expect(revisionVersionLabel(local(2026, 10, 5, 9, 12), NOW)).toBe('10월 5일 09:12 버전')
  })

  it('미리보기 바 문구', () => {
    expect(revisionBarLabel(local(2026, 10, 7, 14, 32))).toBe('10월 7일 14:32 버전 미리보기 — 읽기 전용')
  })

  it('편집자는 2명까지 쉼표, 3명 이상은 외 n명', () => {
    expect(revisionEditorsLabel([])).toBe('')
    expect(revisionEditorsLabel([{ id: 1, name: '김철수' }])).toBe('김철수')
    expect(revisionEditorsLabel([{ id: 1, name: '김철수' }, { id: 2, name: '박민수' }])).toBe('김철수, 박민수')
    expect(
      revisionEditorsLabel([{ id: 1, name: '김철수' }, { id: 2, name: '박민수' }, { id: 3, name: '이영희' }]),
    ).toBe('김철수 외 2명')
  })

  it('최신순 항목을 연속된 같은 날끼리 묶는다', () => {
    const items = [local(2026, 10, 7, 14, 0), local(2026, 10, 7, 9, 0), local(2026, 10, 6, 17, 0), local(2026, 10, 4, 9, 0)]
    const groups = groupRevisionsByDay(items, (x) => x, NOW)
    expect(groups.map((g) => [g.label, g.entries.length])).toEqual([
      ['오늘', 2],
      ['어제', 1],
      ['10월 4일', 1],
    ])
  })
})

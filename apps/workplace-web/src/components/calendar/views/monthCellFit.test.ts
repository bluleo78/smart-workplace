// 월간 뷰 칸 채움 계산(fitMonthCell) 단위 테스트 — 일정 → 마감 이슈 순으로 칸 높이만큼 채운다.
import { describe, expect, it } from 'vitest'

import { fitMonthCell } from './monthCellFit'

describe('fitMonthCell', () => {
  it('측정 전(rowHeight<=0)에는 앞쪽 3개만 보인다', () => {
    expect(fitMonthCell({ rowHeight: 0, eventCount: 1, dueCount: 8 })).toEqual({
      visibleEvents: 1,
      visibleDues: 2,
      overflow: 6,
    })
    expect(fitMonthCell({ rowHeight: 0, eventCount: 5, dueCount: 0 })).toEqual({
      visibleEvents: 3,
      visibleDues: 0,
      overflow: 2,
    })
  })

  it('전부 들어가면 +N 없이 전부 보인다', () => {
    expect(fitMonthCell({ rowHeight: 200, eventCount: 2, dueCount: 2 })).toEqual({
      visibleEvents: 2,
      visibleDues: 2,
      overflow: 0,
    })
  })

  it('일정 먼저, 마감 이슈 다음 순으로 채우고 넘치면 +N 줄을 남긴다', () => {
    expect(fitMonthCell({ rowHeight: 117, eventCount: 1, dueCount: 8 })).toEqual({
      visibleEvents: 1,
      visibleDues: 1,
      overflow: 7,
    })
  })

  it('마감 이슈만 있어도 칸 높이 안에서만 보인다', () => {
    expect(fitMonthCell({ rowHeight: 117, eventCount: 0, dueCount: 9 })).toEqual({
      visibleEvents: 0,
      visibleDues: 2,
      overflow: 7,
    })
  })

  it('최소 행 높이(78)에서도 계산이 맞는다', () => {
    expect(fitMonthCell({ rowHeight: 78, eventCount: 3, dueCount: 3 })).toEqual({
      visibleEvents: 1,
      visibleDues: 0,
      overflow: 5,
    })
    expect(fitMonthCell({ rowHeight: 78, eventCount: 0, dueCount: 4 })).toEqual({
      visibleEvents: 0,
      visibleDues: 1,
      overflow: 3,
    })
  })

  it('공간이 모자라도 최소 1개는 보인다', () => {
    expect(fitMonthCell({ rowHeight: 40, eventCount: 2, dueCount: 0 })).toEqual({
      visibleEvents: 1,
      visibleDues: 0,
      overflow: 1,
    })
  })

  it('소수점 높이는 반올림하지 않고 내림 쪽으로 계산한다', () => {
    // 125.9 는 가용 89.9, 「+N」 줄 제외 71.9 → 24px 칩 2개. 126 으로 반올림하면 72 라 3개가 들어가 버리므로 이 값이 구분한다
    expect(fitMonthCell({ rowHeight: 125.9, eventCount: 0, dueCount: 9 })).toEqual({
      visibleEvents: 0,
      visibleDues: 2,
      overflow: 7,
    })
  })

  it('딱 맞게 들어가면 「+N」 없이 모두 보인다', () => {
    // 가용 44 = 22 + 22 — 넘침이 없으므로 「+N」 줄을 빼지 않는다
    expect(fitMonthCell({ rowHeight: 80, eventCount: 2, dueCount: 0 })).toEqual({
      visibleEvents: 2,
      visibleDues: 0,
      overflow: 0,
    })
  })

  it('측정 전(0)이라도 항목이 3개 이하면 모두 보인다', () => {
    expect(fitMonthCell({ rowHeight: 0, eventCount: 1, dueCount: 1 })).toEqual({
      visibleEvents: 1,
      visibleDues: 1,
      overflow: 0,
    })
  })

  it('항목이 없으면 모두 0', () => {
    expect(fitMonthCell({ rowHeight: 100, eventCount: 0, dueCount: 0 })).toEqual({
      visibleEvents: 0,
      visibleDues: 0,
      overflow: 0,
    })
  })
})

import { describe, expect, it } from 'vitest'

import { formatReactorSummary, othersOf } from './reactorSummary'

describe('formatReactorSummary', () => {
  it('나만 눌렀으면 "내가"', () => {
    expect(formatReactorSummary({ count: 1, reacted: true, names: [] })).toBe('내가 반응했습니다')
  })
  it('나 + 1명 — 마지막 이름 받침 없음 → 가', () => {
    expect(formatReactorSummary({ count: 2, reacted: true, names: ['이영희'] })).toBe('나, 이영희가 반응했습니다')
  })
  it('2명 — 마지막 이름 받침 있음 → 이', () => {
    expect(formatReactorSummary({ count: 2, reacted: false, names: ['이영희', '박지훈'] })).toBe(
      '이영희, 박지훈이 반응했습니다',
    )
  })
  it('3명까지는 모두 이름', () => {
    expect(formatReactorSummary({ count: 3, reacted: false, names: ['가', '나라', '다솜'] })).toBe(
      '가, 나라, 다솜이 반응했습니다',
    )
  })
  it('3명 초과 — 나 포함 3명 + 외 N명', () => {
    expect(
      formatReactorSummary({ count: 5, reacted: true, names: ['이영희', '박지훈', '최수진', '정하늘'] }),
    ).toBe('나, 이영희, 박지훈 외 2명이 반응했습니다')
  })
  it('영문 이름은 가', () => {
    expect(formatReactorSummary({ count: 1, reacted: false, names: ['Genia'] })).toBe('Genia가 반응했습니다')
  })
  it('받은 목록이 count 보다 적으면(경합·첫 페이지) count 기준으로 외 N명', () => {
    expect(formatReactorSummary({ count: 4, reacted: false, names: ['이영희'] })).toBe('이영희 외 3명이 반응했습니다')
  })
  it('받은 목록이 count 보다 많아도(방금 취소) 이름만, 외 생략', () => {
    expect(formatReactorSummary({ count: 1, reacted: false, names: ['이영희', '박지훈'] })).toBe(
      '이영희가 반응했습니다',
    )
  })
  it('아직 이름이 없으면 인원만', () => {
    expect(formatReactorSummary({ count: 3, reacted: false, names: [] })).toBe('3명이 반응했습니다')
  })
})

describe('othersOf', () => {
  it('내 userId 를 뺀다', () => {
    const items = [
      { userId: 1, name: '나', kind: 'HUMAN' as const },
      { userId: 2, name: '이영희', kind: 'HUMAN' as const },
    ]
    expect(othersOf(items, 1).map((r) => r.userId)).toEqual([2])
  })
})

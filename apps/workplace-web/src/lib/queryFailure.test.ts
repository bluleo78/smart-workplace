// 조회 실패 표시 판정(WP-881) — 다시 부르는 동안(pending)에도 실패 안내가 남는지.
import { describe, expect, it } from 'vitest'

import { failedWithoutData, showsLoadError } from './queryFailure'

describe('failedWithoutData / showsLoadError', () => {
  it('첫 조회 중(실패 전)은 실패가 아니다', () => {
    expect(failedWithoutData({ data: undefined, errorUpdateCount: 0 })).toBe(false)
    expect(showsLoadError({ data: undefined, errorUpdateCount: 0, isError: false })).toBe(false)
  })

  it('데이터 없이 실패했으면 다시 부르는 중(isError false)에도 실패로 본다', () => {
    expect(failedWithoutData({ data: undefined, errorUpdateCount: 1 })).toBe(true)
    expect(showsLoadError({ data: undefined, errorUpdateCount: 1, isError: false })).toBe(true)
  })

  it('다시 불러 데이터가 생기면 실패가 아니다', () => {
    expect(failedWithoutData({ data: [], errorUpdateCount: 1 })).toBe(false)
    expect(showsLoadError({ data: [], errorUpdateCount: 1, isError: false })).toBe(false)
  })

  it('placeholderData(이전 키 데이터)만 있으면 데이터가 없는 것으로 본다', () => {
    expect(failedWithoutData({ data: [1], isPlaceholderData: true, errorUpdateCount: 1 })).toBe(true)
  })

  it('데이터가 남은 재조회 실패는 showsLoadError 만 참(isError 그대로)', () => {
    expect(failedWithoutData({ data: [1], errorUpdateCount: 2 })).toBe(false)
    expect(showsLoadError({ data: [1], errorUpdateCount: 2, isError: true })).toBe(true)
  })
})

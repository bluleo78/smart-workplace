// 접기 판정(hysteresis) 순수 계산 테스트(WP-1415).
import { describe, expect, it } from 'vitest'

import { FOLD_HYSTERESIS, foldDecision,MIN_TITLE_SPACE } from './useFoldAuxiliaryActions'

describe('foldDecision', () => {
  it('제목 자리가 160px보다 좁으면 접는다(현재 상태와 무관)', () => {
    expect(foldDecision(100, false)).toBe(true)
    expect(foldDecision(159, false)).toBe(true)
    expect(foldDecision(159, true)).toBe(true)
  })

  it('제목 자리가 160px+120px보다 넓으면 펼친다(현재 상태와 무관)', () => {
    expect(foldDecision(MIN_TITLE_SPACE + FOLD_HYSTERESIS + 1, true)).toBe(false)
    expect(foldDecision(400, true)).toBe(false)
    expect(foldDecision(400, false)).toBe(false)
  })

  it('임계 사이(160~280px)면 현재 상태를 유지한다(hysteresis — 진동 방지)', () => {
    expect(foldDecision(200, true)).toBe(true)
    expect(foldDecision(200, false)).toBe(false)
    expect(foldDecision(280, true)).toBe(true)
    expect(foldDecision(280, false)).toBe(false)
  })

  it('임계 값(160px)은 접지 않는다(<160px 이므로)', () => {
    expect(foldDecision(160, false)).toBe(false)
    expect(foldDecision(160, true)).toBe(true)
  })
})

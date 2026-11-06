// 동그라미 판정(hysteresis) 순수 계산 테스트(WP-1415).
import { describe, expect, it } from 'vitest'

import { CIRCLE_HYSTERESIS, circleDecision,MIN_TITLE_SPACE } from './useAiChipCircle'

describe('circleDecision', () => {
  it('제목 자리가 160px보다 좁으면 동그라미(현재 상태와 무관)', () => {
    expect(circleDecision(100, false)).toBe(true)
    expect(circleDecision(159, false)).toBe(true)
    expect(circleDecision(159, true)).toBe(true)
  })

  it('제목 자리가 160px+108px보다 넓으면 풀린다(현재 상태와 무관)', () => {
    expect(circleDecision(MIN_TITLE_SPACE + CIRCLE_HYSTERESIS + 1, true)).toBe(false)
    expect(circleDecision(400, true)).toBe(false)
    expect(circleDecision(400, false)).toBe(false)
  })

  it('임계 사이(160~268px)면 현재 상태를 유지한다(hysteresis — 진동 방지)', () => {
    expect(circleDecision(200, true)).toBe(true)
    expect(circleDecision(200, false)).toBe(false)
    expect(circleDecision(268, true)).toBe(true)
    expect(circleDecision(268, false)).toBe(false)
  })

  it('임계 값(160px)은 동그라미가 아니다(<160px 이므로)', () => {
    expect(circleDecision(160, false)).toBe(false)
    expect(circleDecision(160, true)).toBe(true)
  })
})

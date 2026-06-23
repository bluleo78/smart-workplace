import { describe, expect,it } from 'vitest'

import { CATCHUP_AUTO_THRESHOLD,shouldAutoShowCatchup } from './catchupGate'

describe('shouldAutoShowCatchup', () => {
  it('임계 미만은 false', () => {
    expect(shouldAutoShowCatchup(4)).toBe(false)
    expect(shouldAutoShowCatchup(0)).toBe(false)
  })
  it('임계 이상은 true', () => {
    expect(shouldAutoShowCatchup(CATCHUP_AUTO_THRESHOLD)).toBe(true)
    expect(shouldAutoShowCatchup(12)).toBe(true)
  })
})

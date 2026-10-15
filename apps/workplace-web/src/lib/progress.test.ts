// completionPct 단위 테스트 — 사이클·프로젝트 진행률이 공유하는 완료율 계산.
import { describe, expect, it } from 'vitest'

import { completionPct } from './progress'

describe('completionPct', () => {
  it('반올림한 완료율', () => {
    expect(completionPct(11, 18)).toBe(61)
    expect(completionPct(1, 3)).toBe(33)
  })

  it('0건이면 0(0 나누기 방지)', () => {
    expect(completionPct(0, 0)).toBe(0)
  })
})

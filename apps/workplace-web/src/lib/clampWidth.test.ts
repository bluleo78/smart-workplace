// 패널 폭 범위 맞추기(WP-892).
import { describe, expect, it } from 'vitest'

import { clampWidth } from './clampWidth'

describe('clampWidth', () => {
  it('범위 밖은 최소·최대로, 소수는 정수 px 로', () => {
    expect(clampWidth(100, 320, 600)).toBe(320)
    expect(clampWidth(900, 320, 600)).toBe(600)
    expect(clampWidth(400.6, 320, 600)).toBe(401)
  })

  it('최대가 최소보다 작으면 최소 폭', () => {
    expect(clampWidth(400, 180, 100)).toBe(180)
  })
})

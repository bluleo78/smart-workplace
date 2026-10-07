import { describe, expect, it } from 'vitest'

import { fitImageWidth } from './imageFit'

describe('fitImageWidth', () => {
  it('넓은 이미지는 상자 폭에 맞춘다', () => {
    expect(fitImageWidth(2400, 1200, 1200, 800)).toBe(1200)
  })
  it('세로로 긴 이미지는 상자 높이에 맞춰 전체가 보이게 한다', () => {
    expect(fitImageWidth(1000, 2400, 1200, 800)).toBeCloseTo(333.33, 1)
  })
  it('상자보다 작은 이미지는 키우지 않는다', () => {
    expect(fitImageWidth(100, 50, 1200, 800)).toBe(100)
  })
  it('크기를 아직 모르면 null', () => {
    expect(fitImageWidth(0, 0, 1200, 800)).toBeNull()
    expect(fitImageWidth(100, 100, 0, 800)).toBeNull()
  })
})

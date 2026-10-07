import { describe, expect, it } from 'vitest'

import { fitImageWidth } from './imageFit'

describe('fitImageWidth', () => {
  it('넓은 이미지는 상자 폭에 맞춘다', () => {
    expect(fitImageWidth(2400, 1200, 1200, 800)).toBe(1200)
  })
  it('세로로 긴 이미지는 상자 높이에 맞춰 전체가 보이게 한다', () => {
    expect(fitImageWidth(1000, 2400, 1200, 800)).toBe(333)
  })
  it('정수 픽셀로 내림해 소수점 반올림으로 상자를 넘쳐 스크롤바가 생겼다 사라지는 일을 막는다', () => {
    const w = fitImageWidth(997, 1301, 1183.5, 777.25)!
    expect(Number.isInteger(w)).toBe(true)
    expect(w).toBeLessThanOrEqual(1183.5)
    expect((w * 1301) / 997).toBeLessThanOrEqual(777.25)
  })
  it('상자보다 작은 이미지는 키우지 않는다', () => {
    expect(fitImageWidth(100, 50, 1200, 800)).toBe(100)
  })
  it('크기를 아직 모르면 null', () => {
    expect(fitImageWidth(0, 0, 1200, 800)).toBeNull()
    expect(fitImageWidth(100, 100, 0, 800)).toBeNull()
  })
})

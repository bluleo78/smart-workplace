import { describe, expect, it } from 'vitest'

import { capRenderScale, MAX_CANVAS_PIXELS } from './pdfScale'

describe('capRenderScale', () => {
  it('한도 안이면 devicePixelRatio 를 그대로 쓴다', () => {
    expect(capRenderScale(800, 1000, 2)).toBe(2)
  })
  it('한도를 넘으면 픽셀 수가 한도 이하가 되게 줄인다', () => {
    const w = 3000
    const h = 3880
    const s = capRenderScale(w, h, 3)
    expect(s).toBeLessThan(3)
    expect(Math.floor(w * s) * Math.floor(h * s)).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
  })
  it('잘못된 입력은 1 배율로 본다', () => {
    expect(capRenderScale(800, 1000, 0)).toBe(1)
    expect(capRenderScale(0, 0, 2)).toBe(2)
  })
})

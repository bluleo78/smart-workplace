// 공용 CSS 색 파서(cssColor) — 메일 어둡게 보기와 노트 밖 붙여넣기 정리기(WP-1306)가 같은 규칙으로 색을 읽는지 고정한다.
import { describe, expect, it } from 'vitest'

import { parseCssColor, relativeLuminance } from './cssColor'

describe('parseCssColor', () => {
  it('reads hex, rgb/rgba (comma, space and slash syntax), hsl and names', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseCssColor('#16A34A')).toEqual({ r: 22, g: 163, b: 74, a: 1 })
    expect(parseCssColor('#00000000')?.a).toBe(0)
    expect(parseCssColor('rgb(22, 163, 74)')).toEqual({ r: 22, g: 163, b: 74, a: 1 })
    expect(parseCssColor('rgba(0, 0, 0, 0)')?.a).toBe(0)
    expect(parseCssColor('rgb(22 163 74 / 50%)')).toEqual({ r: 22, g: 163, b: 74, a: 0.5 })
    expect(parseCssColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseCssColor('black')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseCssColor('red')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseCssColor('var(--x)')).toBeNull()
  })

  it('reads hsl() saturation/lightness without % as percentages (CSS Color 4 space syntax)', () => {
    // % 없는 숫자를 그대로 쓰면 50 배가 돼 엉뚱한 색이 된다.
    expect(parseCssColor('hsl(0 100 50)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseCssColor('hsl(120 50 50)')).toEqual(parseCssColor('hsl(120, 50%, 50%)'))
    expect(parseCssColor('hsl(210 40 96 / 50%)')).toEqual({ ...parseCssColor('hsl(210, 40%, 96%)')!, a: 0.5 })
  })
})

describe('relativeLuminance', () => {
  it('is 0 for black, 1 for white and weights green above red above blue', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0)
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1)
    expect(relativeLuminance(0, 255, 0)).toBeGreaterThan(relativeLuminance(255, 0, 0))
    expect(relativeLuminance(255, 0, 0)).toBeGreaterThan(relativeLuminance(0, 0, 255))
  })
})

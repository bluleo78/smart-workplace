import { describe, expect, it } from 'vitest'

import { initialColor, nameColor, projectColor, projectInitial } from './project-color'
import { contrast } from './test/cssContrast'

// ── 테스트 전용 대비 계산(WP-1620) ──
// 구현의 변환(cssColor)을 재사용하지 않고, 반환된 hsl 문자열을 직접 파싱해 다른 공식으로
// 브라우저가 칠할 8비트 반올림 sRGB → WCAG 상대 휘도를 잰다. 대비 비율만 공용 테스트 도우미(contrast)를 쓴다.

/** `hsl(h s% l%)` 문자열 → [h, s(0..1), l(0..1)]. 형식이 다르면 실패시킨다. */
function parseHsl(css: string): [number, number, number] {
  const m = /^hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)$/.exec(css)
  if (!m) throw new Error(`hsl 형식 아님: ${css}`)
  return [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100]
}

/** CSS Color 4 의 hsl→rgb 공식(채널별 k 방식) 후 0..255 반올림 — 구현과 다른 공식으로 교차 검증. */
function hslTo8bit(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const ch = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [ch(0), ch(8), ch(4)]
}

/** WCAG 2.x 상대 휘도(8비트 채널 입력). */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** 배경 hsl 문자열 위 흰 글자의 WCAG 대비. */
function whiteContrast(bg: string): number {
  const [h, s, l] = parseHsl(bg)
  return contrast(1, luminance(hslTo8bit(h, s, l)))
}

/** 배경 hsl 문자열의 명도(%) — 반올림하지 않는다(정수 단계에 묶지 않게). */
function lightnessOf(bg: string): number {
  return parseHsl(bg)[2] * 100
}

describe('projectColor', () => {
  it('같은 key 는 항상 같은 색(결정적)', () => {
    expect(projectColor('WP')).toEqual(projectColor('WP'))
  })

  it('다른 key 는 다른 hue', () => {
    expect(projectColor('WP').bg).not.toEqual(projectColor('AI').bg)
  })
})

describe('initialColor — 흰 글자 대비 4.5:1 (WP-1620)', () => {
  it('모든 hue 0..359 에서 흰 글자 대비 ≥ 4.5', () => {
    for (let hue = 0; hue < 360; hue++) {
      const { bg, fg } = initialColor(hue)
      expect(fg).toBe('hsl(0 0% 100%)')
      expect(bg).toMatch(new RegExp(`^hsl\\(${hue} 60% [\\d.]+%\\)$`))
      expect(whiteContrast(bg), `hue ${hue}: ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('명도는 45% 를 넘지 않는다', () => {
    for (let hue = 0; hue < 360; hue++) {
      expect(lightnessOf(initialColor(hue).bg)).toBeLessThanOrEqual(45)
    }
  })

  it('이미 대비가 되는 hue(240°)는 45% 그대로', () => {
    expect(initialColor(240).bg).toBe('hsl(240 60% 45%)')
  })

  it.each([60, 120, 140, 180])('문제 hue %i° 는 45% 보다 어두워진다', (hue) => {
    expect(lightnessOf(initialColor(hue).bg)).toBeLessThan(45)
  })

  it('필요한 만큼만 낮춘다 — 1% 더 밝으면 4.5 미만', () => {
    for (let hue = 0; hue < 360; hue++) {
      const l = lightnessOf(initialColor(hue).bg)
      if (l < 45) expect(whiteContrast(`hsl(${hue} 60% ${l + 1}%)`), `hue ${hue}`).toBeLessThan(4.5)
    }
  })

  it('범위 밖 hue 는 같은 원 위의 정수 hue 로 맞춘다 — 칠하는 색과 잰 색이 같다', () => {
    expect(initialColor(-60)).toEqual(initialColor(300))
    expect(initialColor(420)).toEqual(initialColor(60))
    expect(initialColor(59.6)).toEqual(initialColor(60))
  })

  it('projectColor·nameColor 실제 출력도 ≥ 4.5', () => {
    const keys = ['WP', 'AI', 'OPS', 'DESIGN', 'X']
    const names = ['Wonjun', 'Woo', 'William', '홍길동', 'Alice', 'Bob']
    for (const k of keys) expect(whiteContrast(projectColor(k).bg), k).toBeGreaterThanOrEqual(4.5)
    for (const n of names) expect(whiteContrast(nameColor(n).bg), n).toBeGreaterThanOrEqual(4.5)
  })
})

describe('projectInitial', () => {
  it('앞 2자 대문자', () => {
    expect(projectInitial('wp')).toBe('WP')
    expect(projectInitial('Engineering')).toBe('EN')
  })

  it('1자 key 는 1자', () => {
    expect(projectInitial('x')).toBe('X')
  })
})

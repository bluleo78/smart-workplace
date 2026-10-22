import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PALETTE_KEYS, resolvePalette } from './calendarPalette'
import { contrast, luminance } from './test/cssContrast'

// 캘린더 일정 칩(흰 12px 글자)의 대비를 Tailwind 색 원본 값으로 고정한다(WP-736) — WCAG AA 4.5:1.
// -500 배경은 파랑 3.8·주황 2.2·초록 2.5:1 이라 칩 제목이 잘 읽히지 않았다. 브라우저 측정(e2e/pages/text-contrast.spec)은 파랑만 잰다.
const theme = readFileSync(
  fileURLToPath(new URL('../../node_modules/tailwindcss/theme.css', import.meta.url)),
  'utf8',
)

/** Tailwind 색 변수(--color-blue-600: oklch(54.6% 0.245 262.881))의 oklch — 밝기는 % 표기. */
function twOklch(name: string): [number, number, number] {
  const m = new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(theme)
  if (!m) throw new Error(`--color-${name} 없음`)
  return [Number(m[1]) / 100, Number(m[2]), Number(m[3])]
}

const WHITE = luminance([1, 0, 0])

describe('calendar event chip contrast', () => {
  it.each(PALETTE_KEYS)('%s 칩의 흰 글자가 4.5:1 이상', (key) => {
    const { chipClass } = resolvePalette(key)
    expect(chipClass).toContain('text-white')
    const bg = /\bbg-(\w+-\d+)\b/.exec(chipClass)?.[1]
    expect(bg).toBeDefined()
    expect(contrast(WHITE, luminance(twOklch(bg!)))).toBeGreaterThanOrEqual(4.5)
  })
})

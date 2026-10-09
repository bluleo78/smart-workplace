import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PRESENCE_COLOR_COUNT } from './presence'

// 사람 색 토큰(WP-173)의 대비를 index.css 원본 값으로 검증한다 — 이름표 글자(--presence-foreground) 4.5:1, 캐럿(배경 대비) 3:1.
// 브라우저 없이 계산하려고 oklch → 선형 sRGB(OKLab 표준 행렬, 색역 밖은 자름) → WCAG 상대 휘도를 직접 구한다.
const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8')

function block(re: RegExp): string {
  const m = re.exec(css)
  if (!m) throw new Error(`블록을 찾지 못함: ${re}`)
  return m[1]
}
const THEMES = {
  light: block(/^:root \{([\s\S]*?)^\}/m),
  dark: block(/^\.dark \{([\s\S]*?)^\}/m),
}

function oklchOf(body: string, name: string): [number, number, number] {
  // 줄 시작(공백 뒤)에서만 — --sidebar-background 같은 다른 토큰의 꼬리와 섞이지 않게.
  const m = new RegExp(`(?:^|\\s)--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`, 'm').exec(body)
  if (!m) throw new Error(`--${name} 없음`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** oklch → WCAG 상대 휘도(선형 sRGB 가중합). 색역 밖 성분은 0..1 로 자른다(브라우저와 같은 방향). */
function luminance([L, C, h]: [number, number, number]): number {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}
const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)

describe.each(Object.entries(THEMES))('presence tokens (%s)', (_theme, body) => {
  const fg = luminance(oklchOf(body, 'presence-foreground'))
  const bg = luminance(oklchOf(body, 'background'))
  const colors = Array.from({ length: PRESENCE_COLOR_COUNT }, (_, i) => `presence-${i + 1}`)

  it.each(colors)('%s keeps name-tag text at 4.5:1 and the caret at 3:1 against the page', (name) => {
    const c = luminance(oklchOf(body, name))
    expect(contrast(c, fg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c, bg)).toBeGreaterThanOrEqual(3)
  })
})

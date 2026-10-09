import { describe, expect, it } from 'vitest'

import { contrast, luminance, oklchOf, THEMES } from '../test/cssContrast'
import { PRESENCE_COLOR_COUNT } from './presence'

// 사람 색 토큰(WP-173)의 대비를 index.css 원본 값으로 검증한다 — 이름표 글자(--presence-foreground) 4.5:1, 캐럿(배경 대비) 3:1.
// 계산 도우미(oklch → WCAG 휘도)는 test/cssContrast 공용.

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

import { describe, expect, it } from 'vitest'

import { THEMES, tokenContrast } from './test/cssContrast'

// 노트 버전 비교(WP-282) 추가·삭제 문구 토큰의 대비를 index.css 원본 값으로 검증한다 — 연한 바탕 위 글자 4.5:1(WCAG AA).
describe.each(Object.entries(THEMES))('diff text tokens (%s)', (_theme, body) => {
  it.each([
    ['success-text', 'success-subtle'],
    ['destructive-text', 'destructive-subtle'],
  ])('%s on %s keeps 4.5:1', (text, bg) => {
    expect(tokenContrast(body, text, bg)).toBeGreaterThanOrEqual(4.5)
  })
})

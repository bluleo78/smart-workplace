import { describe, expect, test } from 'vitest'

import { hasVisibleText } from './visibleText'

describe('hasVisibleText', () => {
  test.each(['', '   ', '\u200B\u200B', '\u3164', '\u2800 \uFEFF', '\u115F\u1160', '\u0301'])(
    '보이지 않는 글자뿐이면 false — %j',
    (text) => {
      expect(hasVisibleText(text)).toBe(false)
    },
  )

  test.each(['a', '제목', '\u200B처음 제목\u200B', '🔗'])('보이는 글자가 있으면 true — %j', (text) => {
    expect(hasVisibleText(text)).toBe(true)
  })
})

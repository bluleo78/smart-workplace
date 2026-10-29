// 보이는 글자 판정·다듬기(WP-1107·WP-1106) — 서버(PersonNames·SingleLineTitles)와 같은 기준인지.
import { describe, expect, it, test } from 'vitest'

import { hasVisibleText, trimInvisible } from './visibleText'

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

describe('trimInvisible', () => {
  it('보이지 않는 글자만이면 빈 문자열', () => {
    expect(trimInvisible('\u200B\u200B')).toBe('')
    expect(trimInvisible('\u2800')).toBe('')
    expect(trimInvisible(' \u3164\uFEFF ')).toBe('')
    expect(trimInvisible('\u3164\u115F\uFFA0')).toBe('')
    // 홀로 그려지지 않는 결합 문자(변형 선택자)만 있어도 빈 값.
    expect(trimInvisible('\uFE0F')).toBe('')
  })

  it('앞뒤의 보이지 않는 글자만 지우고 가운데는 둔다', () => {
    expect(trimInvisible('\u200B점검\u2800')).toBe('점검')
    expect(trimInvisible('  확인 한다 ')).toBe('확인 한다')
  })

  it('NFD 로 붙여 넣은 한글은 NFC 로 맞춘다(서버와 같은 글자 수)', () => {
    expect(trimInvisible('가')).toBe('가')
  })
})

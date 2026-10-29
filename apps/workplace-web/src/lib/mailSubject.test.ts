import { describe, expect, it } from 'vitest'

import { hasMailSubject, mailSubjectText } from './mailSubject'

describe('mailSubjectText (WP-1110)', () => {
  it.each([
    ['null', null],
    ['빈 문자열', ''],
    ['공백', '   '],
    ['제로폭 공백', '\u200B\u200B'],
    ['제로폭 연결자·BOM·단어 연결자·소프트 하이픈', '\u200C\u200D\uFEFF\u2060\u00AD'],
    ['전각 공백·줄바꿈', '\u3000\n\t'],
  ])('%s 은 「(제목 없음)」', (_, s) => {
    expect(mailSubjectText(s)).toBe('(제목 없음)')
    expect(hasMailSubject(s)).toBe(false)
  })

  it('보이는 글자가 있으면 원문 그대로(앞뒤 보이지 않는 글자 포함)', () => {
    expect(mailSubjectText('\u200B회의 안내 ')).toBe('\u200B회의 안내 ')
    expect(hasMailSubject('a')).toBe(true)
  })
})

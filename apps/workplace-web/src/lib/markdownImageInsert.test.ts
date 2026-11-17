import { describe, expect, it } from 'vitest'

import { hasPendingToken, imageMarkdown } from './markdownImageInsert'

describe('markdownImageInsert', () => {
  it('alt 의 대괄호·줄바꿈을 제거해 마크다운이 깨지지 않게 한다', () => {
    expect(imageMarkdown('스크린샷 [1]\n.png', '/u')).toBe('![스크린샷 1 .png](/u)')
  })

  it('남은 업로드 토큰을 감지한다', () => {
    expect(hasPendingToken('a ![업로드 중… #7]()')).toBe(true)
    expect(hasPendingToken('![a](/x)')).toBe(false)
  })
})

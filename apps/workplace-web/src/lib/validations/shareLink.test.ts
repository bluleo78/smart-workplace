// 공유 링크 비밀번호 판정 단위 테스트(WP-1385) — 서버 DriveShareLinkService(PersonNames.hasVisibleChar)와 같은 기준인지 본다.
import { describe, expect, it } from 'vitest'

import { isBlankOnlyPassword, PASSWORD_BLANK_ONLY_MESSAGE, sharePasswordError } from './shareLink'
import { PASSWORD_BYTES_MESSAGE } from './user'

describe('isBlankOnlyPassword (WP-1385)', () => {
  it('공백만(스페이스·탭·줄바꿈)이면 true', () => {
    expect(isBlankOnlyPassword(' ')).toBe(true)
    expect(isBlankOnlyPassword('   ')).toBe(true)
    expect(isBlankOnlyPassword('\t \n')).toBe(true)
  })
  it('NBSP·폭 없는 공백·한글 채움·점자 빈칸처럼 안 보이는 문자만이어도 true', () => {
    expect(isBlankOnlyPassword('\u00A0\u00A0')).toBe(true)
    expect(isBlankOnlyPassword('\u200B')).toBe(true)
    expect(isBlankOnlyPassword('\u3164')).toBe(true)
    expect(isBlankOnlyPassword('\uFEFF\u2060')).toBe(true)
    expect(isBlankOnlyPassword('\u115F\u1160\uFFA0')).toBe(true)
    expect(isBlankOnlyPassword('\u2800')).toBe(true)
  })
  it('빈 칸은 「비밀번호 없음」이라 false', () => {
    expect(isBlankOnlyPassword('')).toBe(false)
  })
  it('보이는 글자가 하나라도 있으면(사이·앞뒤 공백 포함) false', () => {
    expect(isBlankOnlyPassword('pw')).toBe(false)
    expect(isBlankOnlyPassword('a b')).toBe(false)
    expect(isBlankOnlyPassword(' pw ')).toBe(false)
    expect(isBlankOnlyPassword('\u200Ba')).toBe(false)
  })
})

describe('sharePasswordError (WP-1385)', () => {
  it('빈 칸·정상 값은 오류 없음', () => {
    expect(sharePasswordError('')).toBeNull()
    expect(sharePasswordError('a b')).toBeNull()
  })
  it('공백만이면 공백 안내, 72바이트 초과면 바이트 안내가 먼저', () => {
    expect(sharePasswordError('\u3164')).toBe(PASSWORD_BLANK_ONLY_MESSAGE)
    expect(sharePasswordError('a'.repeat(73))).toBe(PASSWORD_BYTES_MESSAGE)
    expect(sharePasswordError(' '.repeat(73))).toBe(PASSWORD_BYTES_MESSAGE)
  })
})

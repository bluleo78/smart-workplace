import { describe, expect, it } from 'vitest'

import { avatarInitials } from './avatarColor'

describe('avatarInitials', () => {
  it('한글 이름은 첫 글자', () => {
    expect(avatarInitials('홍길동')).toBe('홍')
  })
  it('영문 이름은 첫 글자 대문자', () => {
    expect(avatarInitials('bluleo78')).toBe('B')
  })
  it('빈 이름은 ? 폴백', () => {
    expect(avatarInitials('')).toBe('?')
    expect(avatarInitials('   ')).toBe('?')
  })
})

import { describe, expect, it } from 'vitest'

import { avatarColorClass,avatarInitials } from './avatarColor'

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

describe('avatarColorClass', () => {
  it('같은 userId 는 항상 같은 색(결정적)', () => {
    expect(avatarColorClass(42)).toBe(avatarColorClass(42))
  })
  it('팔레트 내 Tailwind 클래스 문자열 반환', () => {
    expect(avatarColorClass(42)).toMatch(/^bg-\w+-500 text-white$/)
  })
})

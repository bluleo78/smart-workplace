// 사람 활성 상태 표기(WP-1080) — active 가 명시적으로 false 일 때만 비활성, 없으면 활성.
import { describe, expect, it } from 'vitest'

import { displayNameWithStatus, isInactiveUser, withInactiveSuffix } from './userStatus'

describe('userStatus', () => {
  it('active 가 false 일 때만 비활성 — 없거나 true 면 활성', () => {
    expect(isInactiveUser({ active: false })).toBe(true)
    expect(isInactiveUser({ active: true })).toBe(false)
    expect(isInactiveUser({})).toBe(false)
  })

  it('비활성이면 이름 뒤에 「(비활성)」', () => {
    expect(withInactiveSuffix('김', true)).toBe('김 (비활성)')
    expect(withInactiveSuffix('김', false)).toBe('김')
    expect(displayNameWithStatus({ name: '박', active: false })).toBe('박 (비활성)')
    expect(displayNameWithStatus({ name: '박' })).toBe('박')
  })
})

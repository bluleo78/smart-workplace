// 사람 활성 상태 표기(WP-1080) — active 가 명시적으로 false 일 때만 비활성, 없으면 활성.
import { describe, expect, it } from 'vitest'

import { displayNameWithStatus, isInactiveUser, othersInactiveSuffix, withInactiveSuffix } from './userStatus'

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

  // WP-1100: 「+N」·「외 N」에 묶인 사람은 이름 꼬리가 보이지 않아, 그중 정지된 사람 수를 붙인다. 첫 사람은 이름 꼬리가 맡아 세지 않는다.
  it('첫 사람 뒤에 묶인 정지된 사람 수만 「 (비활성 n)」', () => {
    expect(othersInactiveSuffix([{ active: true }, { active: false }, { active: false }, {}])).toBe(' (비활성 2)')
    expect(othersInactiveSuffix([{ active: false }, { active: true }])).toBe('')
    expect(othersInactiveSuffix([{ active: false }])).toBe('')
    expect(othersInactiveSuffix([])).toBe('')
  })
})

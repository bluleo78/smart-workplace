// 사람 활성 상태 표기(WP-1080) — active 가 명시적으로 false 일 때만 비활성, 없으면 활성.
import { describe, expect, it } from 'vitest'

import { displayNameWithStatus, isInactiveUser, peopleSummary, withInactiveSuffix } from './userStatus'

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
  // WP-1160: 화면마다 따로 조립하던 요약을 조각(첫 이름·나머지 수·묶인 정지 표기)으로 한 곳에서 — 앞 공백 없이 준다.
  it('요약 조각 — 첫 이름(정지면 꼬리), 나머지 수, 묶인 정지된 사람만 「(비활성 n)」', () => {
    const p = (name: string, active?: boolean) => ({ name, active })
    expect(peopleSummary([p('가', true), p('나', false), p('다', false), p('라')])).toEqual({
      first: '가',
      others: 3,
      othersInactive: '(비활성 2)',
    })
    expect(peopleSummary([p('가', false), p('나', true)])).toEqual({ first: '가 (비활성)', others: 1, othersInactive: null })
    expect(peopleSummary([p('가', false)])).toEqual({ first: '가 (비활성)', others: 0, othersInactive: null })
    expect(peopleSummary([])).toEqual({ first: null, others: 0, othersInactive: null })
  })
})

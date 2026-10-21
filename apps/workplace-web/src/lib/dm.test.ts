import { describe, expect, it } from 'vitest'

import type { DmResponse } from '@/types/messaging'

import { dmDisplayName, isDmRecipientInactive, isSelfDm } from './dm'

function dm(participants: { userId: number; name: string; active?: boolean }[]): DmResponse {
  return {
    id: 1,
    participants: participants.map((p) => ({ ...p, kind: 'HUMAN' as const })),
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: '2026-06-06T00:00:00',
  }
}

describe('dmDisplayName', () => {
  it('self-DM(본인만) → "{내 이름} (나)"', () => {
    expect(dmDisplayName(dm([{ userId: 1, name: '홍길동' }]), 1)).toBe('홍길동 (나)')
  })
  it('1:1 → 상대 이름', () => {
    expect(dmDisplayName(dm([{ userId: 1, name: '나' }, { userId: 2, name: '밥' }]), 1)).toBe('밥')
  })
  it('그룹 → 상대들 이름', () => {
    expect(
      dmDisplayName(dm([{ userId: 1, name: '나' }, { userId: 2, name: '밥' }, { userId: 3, name: '캐럴' }]), 1),
    ).toBe('밥, 캐럴')
  })
})

describe('isSelfDm', () => {
  it('본인만 참여 → true', () => {
    expect(isSelfDm(dm([{ userId: 1, name: '홍길동' }]), 1)).toBe(true)
  })
  it('본인 + 상대 → false', () => {
    expect(isSelfDm(dm([{ userId: 1, name: '홍길동' }, { userId: 2, name: '김철수' }]), 1)).toBe(false)
  })
  it('참여자 없음 → false', () => {
    expect(isSelfDm(dm([]), 1)).toBe(false)
  })
})

describe('isDmRecipientInactive (WP-723)', () => {
  it('1:1 상대가 정지 → true', () => {
    expect(isDmRecipientInactive(dm([{ userId: 1, name: '나' }, { userId: 2, name: '퇴사자', active: false }]), 1)).toBe(true)
  })
  it('1:1 상대가 활성(필드 없음 포함) → false', () => {
    expect(isDmRecipientInactive(dm([{ userId: 1, name: '나' }, { userId: 2, name: '밥', active: true }]), 1)).toBe(false)
    expect(isDmRecipientInactive(dm([{ userId: 1, name: '나' }, { userId: 2, name: '밥' }]), 1)).toBe(false)
  })
  it('그룹 DM 에 활성 상대가 남아 있으면 false, 모두 정지면 true', () => {
    expect(
      isDmRecipientInactive(
        dm([{ userId: 1, name: '나' }, { userId: 2, name: '퇴사자', active: false }, { userId: 3, name: '밥', active: true }]),
        1,
      ),
    ).toBe(false)
    expect(
      isDmRecipientInactive(
        dm([{ userId: 1, name: '나' }, { userId: 2, name: 'A', active: false }, { userId: 3, name: 'B', active: false }]),
        1,
      ),
    ).toBe(true)
  })
  it('셀프 DM(나만) → false', () => {
    expect(isDmRecipientInactive(dm([{ userId: 1, name: '나' }]), 1)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import type { DmResponse } from '@/types/messaging'

import { dmDisplayName, isSelfDm } from './dm'

function dm(participants: { userId: number; name: string }[]): DmResponse {
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

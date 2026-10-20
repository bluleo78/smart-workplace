import { describe, expect, it } from 'vitest'

import type { DriveSpace } from '../types/drive'
import {
  canManageDriveSpace,
  driveSpaceTypeLabel,
  hasDriveSpaceMembers,
  isDriveSpaceReadOnly,
  isDriveSpaceViewer,
  partitionSpaces,
} from './driveSpaces'

function space(id: number, type: DriveSpace['type'], name: string): DriveSpace {
  return { id, type, name, ownerId: 1, role: 'EDITOR', archived: false, createdAt: '2026-06-01T00:00:00Z' }
}

describe('partitionSpaces', () => {
  it('CHANNEL 은 channel, 나머지는 primary 로 분리하고 순서를 보존한다', () => {
    const spaces = [
      space(1, 'PERSONAL', '내 드라이브'),
      space(2, 'CHANNEL', '마케팅'),
      space(3, 'TEAM', '디자인팀'),
      space(4, 'CHANNEL', '개발'),
    ]
    const { primary, channel } = partitionSpaces(spaces)
    expect(primary.map((s) => s.id)).toEqual([1, 3])
    expect(channel.map((s) => s.id)).toEqual([2, 4])
  })

  it('빈 입력은 빈 배열 둘을 반환한다', () => {
    expect(partitionSpaces([])).toEqual({ primary: [], channel: [] })
  })
})

describe('canManageDriveSpace — 사이드바 ⋯(이름 변경/삭제) 노출', () => {
  it('TEAM 공간 OWNER 에게만 true', () => {
    expect(canManageDriveSpace({ type: 'TEAM', role: 'OWNER' })).toBe(true)
  })

  it('TEAM 이라도 OWNER 가 아니면 false', () => {
    expect(canManageDriveSpace({ type: 'TEAM', role: 'EDITOR' })).toBe(false)
    expect(canManageDriveSpace({ type: 'TEAM', role: 'VIEWER' })).toBe(false)
  })

  it('개인·채널 공간은 OWNER 여도 false', () => {
    expect(canManageDriveSpace({ type: 'PERSONAL', role: 'OWNER' })).toBe(false)
    expect(canManageDriveSpace({ type: 'CHANNEL', role: 'OWNER' })).toBe(false)
  })
})

describe('driveSpaceTypeLabel (WP-522)', () => {
  it('space 유형을 한국어로 표기한다', () => {
    expect(driveSpaceTypeLabel('PERSONAL')).toBe('개인')
    expect(driveSpaceTypeLabel('TEAM')).toBe('팀')
    expect(driveSpaceTypeLabel('CHANNEL')).toBe('채널')
  })
})

describe('hasDriveSpaceMembers — 사이드바 ⋯ 「멤버」 노출(WP-582)', () => {
  it('팀 공간이면 보인다 — 역할은 보지 않는다(명단은 모든 멤버가 본다)', () => {
    expect(hasDriveSpaceMembers({ type: 'TEAM' })).toBe(true)
  })

  it('개인·채널 공간에는 없다', () => {
    expect(hasDriveSpaceMembers({ type: 'PERSONAL' })).toBe(false)
    expect(hasDriveSpaceMembers({ type: 'CHANNEL' })).toBe(false)
  })
})

describe('isDriveSpaceReadOnly·isDriveSpaceViewer(WP-582)', () => {
  it('보기 전용 역할이면 읽기 전용이고 viewer', () => {
    expect(isDriveSpaceReadOnly({ archived: false, role: 'VIEWER' })).toBe(true)
    expect(isDriveSpaceViewer({ role: 'VIEWER' })).toBe(true)
  })

  it('보관된 공간은 편집자여도 읽기 전용이지만 viewer 는 아니다(공유 링크 끊기는 허용)', () => {
    expect(isDriveSpaceReadOnly({ archived: true, role: 'EDITOR' })).toBe(true)
    expect(isDriveSpaceViewer({ role: 'EDITOR' })).toBe(false)
  })

  it('보관되지 않은 공간의 소유자·편집자는 쓸 수 있다', () => {
    expect(isDriveSpaceReadOnly({ archived: false, role: 'OWNER' })).toBe(false)
    expect(isDriveSpaceReadOnly({ archived: false, role: 'EDITOR' })).toBe(false)
  })

  it('공간 정보가 오기 전(null)엔 막지 않는다 — 기존 보관 판정과 같은 폴백', () => {
    expect(isDriveSpaceReadOnly(null)).toBe(false)
    expect(isDriveSpaceViewer(null)).toBe(false)
  })
})

// 노트·드라이브 공간 역할 공통 규칙(WP-582) — 표기·편집 가능 판정·마지막 소유자 잠금.
import { describe, expect, it } from 'vitest'

import { canEditSpaceRole, departmentRoleNote, isLockedMemberRow, isSoleOwner, spaceRoleLabel } from './spaceRoles'

describe('spaceRoleLabel', () => {
  it('영문 코드 대신 한국어로 보인다', () => {
    expect(spaceRoleLabel('OWNER')).toBe('소유자')
    expect(spaceRoleLabel('EDITOR')).toBe('편집자')
    expect(spaceRoleLabel('VIEWER')).toBe('보기 전용')
  })
})

describe('canEditSpaceRole', () => {
  it('소유자·편집자만 내용을 바꿀 수 있다', () => {
    expect(canEditSpaceRole('OWNER')).toBe(true)
    expect(canEditSpaceRole('EDITOR')).toBe(true)
    expect(canEditSpaceRole('VIEWER')).toBe(false)
  })

  it('역할을 모르면(조회 전·알 수 없는 값) 읽기 전용으로 본다', () => {
    expect(canEditSpaceRole(undefined)).toBe(false)
    expect(canEditSpaceRole(null)).toBe(false)
    expect(canEditSpaceRole('ADMIN')).toBe(false)
  })
})

describe('isSoleOwner', () => {
  const owner = { role: 'OWNER' as const }
  const editor = { role: 'EDITOR' as const }

  it('소유자가 한 명뿐이면 그 소유자를 잠근다', () => {
    expect(isSoleOwner(owner, [owner, editor])).toBe(true)
  })

  it('소유자가 둘 이상이면 어느 소유자도 잠그지 않는다 — 만든 사람이라도 바꿀 수 있다', () => {
    const other = { role: 'OWNER' as const }
    expect(isSoleOwner(owner, [owner, other, editor])).toBe(false)
    expect(isSoleOwner(other, [owner, other, editor])).toBe(false)
  })

  it('소유자가 아닌 멤버는 잠그지 않는다', () => {
    expect(isSoleOwner(editor, [owner, editor])).toBe(false)
  })
})

describe('isLockedMemberRow (WP-656)', () => {
  // OWNER 가 둘(1·9) 이라 isSoleOwner 는 아무도 잠그지 않는 공간. 9 는 생성자, 1 은 나.
  const members = [
    { userId: 9, role: 'OWNER' as const },
    { userId: 1, role: 'OWNER' as const },
    { userId: 3, role: 'VIEWER' as const },
  ]

  it('내 행은 OWNER 가 여럿이어도 잠긴다 — 스스로 강등·제거 방지', () => {
    expect(isLockedMemberRow(members[1], members, 1, 9)).toBe(true)
  })

  it('생성자 행은 내가 아니어도 잠긴다', () => {
    expect(isLockedMemberRow(members[0], members, 1, 9)).toBe(true)
  })

  it('생성자도 나도 아닌 멤버 행은 잠기지 않는다', () => {
    expect(isLockedMemberRow(members[2], members, 1, 9)).toBe(false)
  })

  it('마지막 소유자면 생성자·나 여부와 상관없이 잠긴다', () => {
    const solo = [{ userId: 4, role: 'OWNER' as const }]
    expect(isLockedMemberRow(solo[0], solo, 1, 9)).toBe(true)
  })
})

describe('departmentRoleNote', () => {
  it('부서 역할이 직접 역할보다 높을 때만 「조직으로 …」', () => {
    expect(departmentRoleNote({ role: 'VIEWER', departmentRole: 'EDITOR' })).toBe('조직으로 편집자')
    expect(departmentRoleNote({ role: 'EDITOR', departmentRole: 'EDITOR' })).toBeNull()
    expect(departmentRoleNote({ role: 'OWNER', departmentRole: 'EDITOR' })).toBeNull()
    expect(departmentRoleNote({ role: 'EDITOR', departmentRole: 'VIEWER' })).toBeNull()
    expect(departmentRoleNote({ role: 'VIEWER', departmentRole: null })).toBeNull()
    expect(departmentRoleNote({ role: 'VIEWER' })).toBeNull()
  })
})

// 노트·드라이브 공간 역할 공통 규칙(WP-582) — 표기·편집 가능 판정·마지막 소유자 잠금.
import { describe, expect, it } from 'vitest'

import { canEditSpaceRole, isSoleOwner, spaceRoleLabel } from './spaceRoles'

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

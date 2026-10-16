// 이슈 생성 권한 — 보드·목록의 「+ 새 태스크」 노출 게이트(WP-413: OPEN 보드 E2E 의 분기 검증을 대체).
import { describe, expect, it } from 'vitest'

import { canCreateIssueIn, isProjectOwner } from './projectPermissions'

describe('canCreateIssueIn', () => {
  it('OPEN 프로젝트는 비멤버도 이슈를 만들 수 있다', () => {
    expect(canCreateIssueIn({ type: 'OPEN', viewerIsMember: false })).toBe(true)
    expect(canCreateIssueIn({ type: 'OPEN', viewerIsMember: true })).toBe(true)
  })

  it('TEAM 프로젝트는 멤버만 만들 수 있다', () => {
    expect(canCreateIssueIn({ type: 'TEAM', viewerIsMember: true })).toBe(true)
    expect(canCreateIssueIn({ type: 'TEAM', viewerIsMember: false })).toBe(false)
  })

  it('프로젝트를 아직 못 불러왔으면 false', () => {
    expect(canCreateIssueIn(undefined)).toBe(false)
  })
})

describe('isProjectOwner', () => {
  const members = [
    { userId: 1, role: 'OWNER' as const },
    { userId: 2, role: 'MEMBER' as const },
  ]

  it('해당 사용자가 OWNER 멤버일 때만 true', () => {
    expect(isProjectOwner(members, 1)).toBe(true)
    expect(isProjectOwner(members, 2)).toBe(false)
    expect(isProjectOwner(members, 3)).toBe(false)
  })

  it('멤버 미로드·비로그인이면 false', () => {
    expect(isProjectOwner(undefined, 1)).toBe(false)
    expect(isProjectOwner(members, undefined)).toBe(false)
  })
})

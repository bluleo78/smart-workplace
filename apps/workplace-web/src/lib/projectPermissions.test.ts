// 이슈 생성 권한 — 보드·목록의 「+ 새 태스크」 노출 게이트(WP-413: OPEN 보드 E2E 의 분기 검증을 대체).
import { describe, expect, it } from 'vitest'

import {
  canCreateIssueIn,
  canDeleteSavedView,
  canManageProject,
  isIntakeOnly,
  isProjectOwner,
  workflowLockedNotice,
} from './projectPermissions'

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

describe('isIntakeOnly', () => {
  it('OPEN 프로젝트의 비멤버만 접수 전용이다', () => {
    expect(isIntakeOnly({ type: 'OPEN', viewerIsMember: false })).toBe(true)
    expect(isIntakeOnly({ type: 'OPEN', viewerIsMember: true })).toBe(false)
    expect(isIntakeOnly({ type: 'TEAM', viewerIsMember: false })).toBe(false)
    expect(isIntakeOnly(undefined)).toBe(false)
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

describe('canManageProject (WP-479)', () => {
  it('OWNER 는 관리할 수 있고 MEMBER 는 못 한다', () => {
    expect(canManageProject(true, false, false)).toBe(true)
    expect(canManageProject(false, false, false)).toBe(false)
  })

  it('ADMIN 은 개인 프로젝트가 아니면 관리할 수 있다', () => {
    expect(canManageProject(false, true, false)).toBe(true)
    expect(canManageProject(false, true, true)).toBe(false)
  })
})

describe('canDeleteSavedView (WP-655)', () => {
  it('내 뷰는 공유 여부·관리 권한과 상관없이 지울 수 있다', () => {
    expect(canDeleteSavedView({ mine: true, visibility: 'PRIVATE' }, false)).toBe(true)
    expect(canDeleteSavedView({ mine: true, visibility: 'SHARED' }, false)).toBe(true)
  })

  it('남의 공유 뷰는 프로젝트를 관리하는 사람(OWNER·ADMIN)만 지운다 — 서버 모더레이션 삭제', () => {
    expect(canDeleteSavedView({ mine: false, visibility: 'SHARED' }, true)).toBe(true)
    expect(canDeleteSavedView({ mine: false, visibility: 'SHARED' }, false)).toBe(false)
  })

  it('남의 비공개 뷰는 관리자라도 지우지 못한다(서버는 존재를 숨긴다)', () => {
    expect(canDeleteSavedView({ mine: false, visibility: 'PRIVATE' }, true)).toBe(false)
  })
})

describe('workflowLockedNotice (WP-503)', () => {
  it('워크플로를 바꿀 수 있으면(멤버·ADMIN) 안내하지 않는다', () => {
    expect(workflowLockedNotice(true, true)).toBeNull()
    expect(workflowLockedNotice(true, false)).toBeNull()
  })

  it('막혔고 코멘트를 쓸 수 있으면(OPEN reporter) 코멘트로 알려 달라는 안내까지 준다', () => {
    expect(workflowLockedNotice(false, true)).toBe(
      '이슈 속성(유형·상태·일정 등)은 프로젝트 멤버만 바꿀 수 있어요. 바꿔야 하면 코멘트로 알려 주세요.',
    )
  })

  it('막혔고 코멘트도 못 쓰면(OPEN 열람자) 이유만 안내한다', () => {
    expect(workflowLockedNotice(false, false)).toBe('이슈 속성(유형·상태·일정 등)은 프로젝트 멤버만 바꿀 수 있어요.')
  })
})

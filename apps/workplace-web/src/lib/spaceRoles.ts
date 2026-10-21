// 노트·드라이브 공간 멤버 역할의 공통 규칙(WP-582) — 두 앱 백엔드가 같은 규칙(역할 3단계, 소유자 여럿, 마지막 소유자 보호)을 쓰므로
// 화면 표기·판정도 한 곳에서 정한다. 멤버 다이얼로그(SpaceMemberDialog)·읽기 전용 판정이 함께 쓴다.

import type { DriveRole } from '@/types/drive'
import type { WikiRole } from '@/types/wiki'

/** 공간 역할 — 드라이브 DriveRole·노트 WikiRole 을 묶는다. 어느 앱에 역할이 늘면 아래 ROLE_LABEL 이 컴파일 오류로 표기를 요구한다. */
export type SpaceRole = DriveRole | WikiRole

/** 공간 멤버 한 사람 — 드라이브 DriveMember·노트 WikiMember 와 같은 모양. */
export interface SpaceMember {
  userId: number
  name: string
  role: SpaceRole
}

/** 역할 선택 상자 순서 — 권한이 넓은 순. */
export const SPACE_ROLES: readonly SpaceRole[] = ['OWNER', 'EDITOR', 'VIEWER']

/** 역할의 화면 표기 — 영문 enum 코드를 그대로 보이지 않게 한다(WP-522 와 같은 원칙). */
const ROLE_LABEL: Record<SpaceRole, string> = { OWNER: '소유자', EDITOR: '편집자', VIEWER: '보기 전용' }

export function spaceRoleLabel(role: SpaceRole): string {
  // 서버가 화면이 모르는 역할을 보내도 빈칸 대신 코드를 보인다.
  return ROLE_LABEL[role] ?? role
}

/** 내용을 바꿀 수 있는 역할인지 — 편집자 이상. 모르는 값은 읽기 전용으로 본다(fail-closed). */
export function canEditSpaceRole(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'EDITOR'
}

/**
 * 역할 변경·제거를 막을 멤버인지 — 소유자가 이 사람 한 명뿐일 때. 빠지면 멤버를 관리할 사람이 없는 공간이 남아
 * 서버가 거부한다(WP-496·557). 만든 사람이라는 이유만으로는 막지 않는다 — 다른 소유자가 있으면 바꿀 수 있다.
 */
export function isSoleOwner(member: Pick<SpaceMember, 'role'>, members: readonly Pick<SpaceMember, 'role'>[]): boolean {
  return member.role === 'OWNER' && members.filter((m) => m.role === 'OWNER').length <= 1
}

/**
 * 멤버 창에서 그 행의 역할 변경·제거를 막을지(WP-656) — 마지막 소유자이거나, 내 행이거나, 공간을 만든 사람의 행일 때.
 * 내 행을 늘 잠그는 이유: OWNER 가 여럿인 공간에서 나중에 OWNER 가 된 사람이 스스로 강등·제거하면 그 자리에서 관리 권한을 잃는다.
 * 생성자 행을 늘 잠그는 이유: 공간을 처음 만든 사람 행은 다른 OWNER 가 강등·제거할 수 없다.
 */
export function isLockedMemberRow(
  member: Pick<SpaceMember, 'userId' | 'role'>,
  members: readonly Pick<SpaceMember, 'role'>[],
  myUserId: number | undefined,
  ownerId: number,
): boolean {
  return isSoleOwner(member, members) || member.userId === myUserId || member.userId === ownerId
}

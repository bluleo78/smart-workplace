export type UserGroupVisibility = 'SHARED' | 'PERSONAL'
export type GroupMemberType = 'MEMBER' | 'EXTERNAL'

/** 그룹 트리 노드(children 중첩). */
export interface UserGroupNode {
  id: number
  code: string | null
  name: string
  parentId: number | null
  ownerId: number | null
  visibility: UserGroupVisibility
  sortOrder: number
  children: UserGroupNode[]
}

/** GET /user-groups 응답. */
export interface UserGroupTree {
  shared: UserGroupNode[]
  personal: UserGroupNode[]
}

/** 그룹 직속 멤버. */
export interface UserGroupMemberSummary {
  targetType: GroupMemberType
  targetId: number
  name: string
  email: string | null
  title: string | null
  organization: string | null
}

/** 그룹 상세 + 직속 멤버. */
export interface UserGroupDetail {
  id: number
  code: string | null
  name: string
  parentId: number | null
  ownerId: number | null
  visibility: UserGroupVisibility
  sortOrder: number
  members: UserGroupMemberSummary[]
}

export interface CreateUserGroupRequest {
  name: string
  parentId: number | null
  visibility: UserGroupVisibility
  code: string | null
  sortOrder: number
}
/**
 * 그룹 부분 수정 요청(#839) — 생략 필드는 서버가 현재 값을 유지한다.
 * 최상위 이동은 parentId 대신 moveToRoot, 코드 비우기는 code 대신 clearCode 플래그로 표현한다(값과 함께 보내면 400).
 */
export interface UpdateUserGroupRequest {
  name?: string
  parentId?: number
  moveToRoot?: boolean
  code?: string
  clearCode?: boolean
  sortOrder?: number
}
export interface AddMemberRequest {
  targetType: GroupMemberType
  targetId: number
}

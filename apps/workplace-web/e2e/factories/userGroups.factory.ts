// 사용자 그룹 E2E 팩토리 — 트리·상세 응답 모킹용.
import type { UserGroupDetail, UserGroupNode, UserGroupTree } from '../../src/types/userGroup'

export function sharedNode(over: Partial<UserGroupNode> = {}): UserGroupNode {
  return {
    id: 10, code: null, name: '개발본부', parentId: null, ownerId: null,
    visibility: 'SHARED', sortOrder: 0, children: [], ...over,
  }
}
export function personalNode(over: Partial<UserGroupNode> = {}): UserGroupNode {
  return {
    id: 20, code: null, name: '내 분류', parentId: null, ownerId: 1,
    visibility: 'PERSONAL', sortOrder: 0, children: [], ...over,
  }
}
export function tree(over: Partial<UserGroupTree> = {}): UserGroupTree {
  return { shared: [sharedNode()], personal: [personalNode()], ...over }
}
export function personalDetail(over: Partial<UserGroupDetail> = {}): UserGroupDetail {
  return {
    id: 20, code: null, name: '내 분류', parentId: null, ownerId: 1,
    visibility: 'PERSONAL', sortOrder: 0,
    members: [
      { targetType: 'MEMBER', targetId: 1, name: '김멤버', email: 'kim@example.com', title: '팀장', organization: null },
    ],
    ...over,
  }
}
export function sharedDetail(over: Partial<UserGroupDetail> = {}): UserGroupDetail {
  return {
    id: 10, code: null, name: '개발본부', parentId: null, ownerId: null,
    visibility: 'SHARED', sortOrder: 0,
    members: [
      { targetType: 'MEMBER', targetId: 2, name: '이개발', email: 'lee@example.com', title: null, organization: null },
    ],
    ...over,
  }
}

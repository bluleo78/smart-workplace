// 사용자 그룹 TanStack Query 키 팩토리.
export const userGroupKeys = {
  all: ['user-groups'] as const,
  tree: ['user-groups', 'tree'] as const,
  detail: (id: number) => ['user-groups', 'detail', id] as const,
}

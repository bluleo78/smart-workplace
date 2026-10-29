// 사용자 그룹 TanStack Query 키 팩토리.
export const userGroupKeys = {
  all: ['user-groups'] as const,
  tree: ['user-groups', 'tree'] as const,
  detail: (id: number) => ['user-groups', 'detail', id] as const,
  // 하위 조직 포함 구성원 검색(WP-1000) — 멤버 편입·제외로 'user-groups' 를 무효화하면 함께 다시 받는다.
  memberSearch: (id: number, q: string) => ['user-groups', 'memberSearch', id, q] as const,
  // 그룹마다 하위 조직 포함 구성원 수(WP-1135) — ids 는 정렬해 넘긴다(같은 그룹 묶음이 같은 캐시를 쓰게).
  memberCounts: (ids: number[]) => ['user-groups', 'memberCounts', ids] as const,
}

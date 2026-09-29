// 드라이브 TanStack Query 키 팩토리 (WP-36/WP-63) — 훅·DrivePage·DriveSidebar·resource.changed 무효화 규칙이 같은 키를 쓰도록 한 곳에 모은다.
// api 모듈을 import 하지 않는 순수 파일이라 lib/resourceInvalidation 에서도 끌어다 쓸 수 있다.
// *All(spaceId) 는 공간 단위 prefix(무효화용), 인자가 모두 있는 키는 개별 쿼리용이다 — prefix 에 인자를 덧붙이면 하위 폴더·검색어 쿼리가 무효화에서 빠진다.
export const driveKeys = {
  all: ['drive'] as const,
  spaces: () => ['drive', 'spaces'] as const,
  space: (spaceId: number | undefined) => ['drive', 'space', spaceId] as const,
  /** 공간의 모든 폴더 목록 prefix. */
  itemsAll: (spaceId: number | undefined) => ['drive', 'items', spaceId] as const,
  /** 특정 폴더 목록 — 루트는 null. */
  items: (spaceId: number | undefined, folderId?: number | null) => ['drive', 'items', spaceId, folderId ?? null] as const,
  trash: (spaceId: number | undefined) => ['drive', 'trash', spaceId] as const,
  /** 공간의 모든 파일명 검색 결과 prefix. */
  searchAll: (spaceId: number | undefined) => ['drive', 'search', spaceId] as const,
  search: (spaceId: number | undefined, q: string) => ['drive', 'search', spaceId, q] as const,
  quota: ['drive', 'quota'] as const,
}

import type { WikiSpace } from '../../types/wiki'

/**
 * 주소의 노트 공간을 볼 수 없는지(WP-559) — 내 공간 목록이 확정됐는데 그 안에 없으면 남의 공간이거나 없는 공간이다.
 * 목록을 불러오는 중이거나 다시 불러오는 중(새 공간 생성 직후 목록 무효화 등)이면 판정을 미뤄 잘못 막지 않는다.
 */
export function isWikiSpaceUnavailable(
  spaces: { data?: WikiSpace[]; isSuccess: boolean; isFetching: boolean },
  spaceId: number | null,
): boolean {
  if (spaceId == null || !spaces.isSuccess || spaces.isFetching || !spaces.data) return false
  return !spaces.data.some((s) => s.id === spaceId)
}

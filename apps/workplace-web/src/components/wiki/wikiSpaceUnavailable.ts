import { isEditRole } from '../../lib/collab/collabStatus'
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

/**
 * 이 노트 공간에 페이지를 만들고·지우고·옮길 수 있는지(WP-602) — 내 역할이 편집 역할(EDITOR·OWNER)일 때만 참.
 * 목록을 아직 못 받았거나 목록에 없는 공간이면 거짓(fail-closed) — VIEWER 에게 쓰기 버튼을 보여 주면 눌러도 403 이라 헛걸음이다.
 */
export function canEditWikiSpace(spaces: WikiSpace[] | undefined, spaceId: number | null): boolean {
  const role = spaces?.find((s) => s.id === spaceId)?.role
  return role != null && isEditRole(role)
}

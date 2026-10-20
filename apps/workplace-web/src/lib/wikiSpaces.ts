import type { WikiSpace } from '@/types/wiki'

/**
 * 노트 스페이스를 지울 수 있는지(WP-580) — TEAM 스페이스의 OWNER 만. 개인 스페이스(내 노트)는 다음 접속 때 자동으로
 * 다시 생기므로 삭제 대상이 아니다. 서버도 같은 규칙으로 거부한다(WikiSpaceService.deleteTeamSpace).
 */
export function canDeleteWikiSpace(space: Pick<WikiSpace, 'type' | 'role'> | null | undefined): boolean {
  return space?.type === 'TEAM' && space.role === 'OWNER'
}

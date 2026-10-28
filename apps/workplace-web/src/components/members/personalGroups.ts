// 내 그룹을 사람으로 펼치기(WP-1023 노트 공유 → WP-1056 드라이브 팀 스페이스 멤버) — 내 그룹은 그룹 자체를 대상·멤버로 남기지 않고, 고르는 시점의
// 사람 구성원으로 풀어 더한다. 노트 공유 창과 공간 멤버 창이 같은 규칙(구성원 받기·중복 빼기·안내 문구)을 쓰도록 여기 모은다.
import { userGroupsApi } from '../../api/userGroups'
import type { GroupOption } from './groupOptions'

/**
 * 내 그룹(하위 그룹 포함)의 지금 사람 구성원 id — 그룹마다 상세에서 받는다(서버가 이 워크스페이스의 활성 사람만 준다 — 외부 연락처는 사람이 아니라 뺀다).
 * 같은 사람이 여러 하위 그룹에 있으면 중복된 채로 돌려준다(빼기는 addGroupMembers 가 한다).
 */
export async function fetchPersonalGroupMemberIds(group: GroupOption): Promise<number[]> {
  const details = await Promise.all(group.subtreeIds.map((id) => userGroupsApi.detail(id).then((r) => r.data)))
  return details.flatMap((d) => d.members.filter((m) => m.targetType === 'MEMBER').map((m) => m.targetId))
}

/**
 * 내 그룹을 지정한 사람으로 펼친다(WP-1023) — 그룹(하위 그룹 포함)의 사람 구성원 중 아직 지정한 사람(멤버) 목록에 없는 사람만 뒤에 더한다(목록 안에서만
 * 중복을 뺀다 — 지정한 부서의 구성원인지는 보지 않는다). exclude(노트 공유: 공유하는 나 자신·공유를 만든 사람 — 이미 열 수 있다)는 더하지도 세지도 않는다.
 * added 는 새로 더한 사람 수, skipped 는 이미 목록에 있어 뺀 사람 수.
 */
export function addGroupMembers(
  currentUserIds: number[],
  memberIds: number[],
  exclude: Iterable<number> = [],
): { userIds: number[]; added: number; skipped: number } {
  const have = new Set(currentUserIds)
  const excluded = new Set(exclude)
  const candidates = [...new Set(memberIds)].filter((id) => !excluded.has(id))
  const fresh = candidates.filter((id) => !have.has(id))
  return { userIds: [...currentUserIds, ...fresh], added: fresh.length, skipped: candidates.length - fresh.length }
}

/** 내 그룹을 펼친 뒤의 안내(WP-1023) — 「개발 스터디에서 3명 추가 (이미 있는 1명 제외)」. 더할 사람이 없으면 그 사실만. */
export function groupExpansionMessage(groupName: string, added: number, skipped: number): string {
  if (added === 0) return skipped > 0 ? `${groupName}의 ${skipped}명은 이미 모두 있습니다` : `${groupName}에 추가할 사람이 없습니다`
  return `${groupName}에서 ${added}명 추가${skipped > 0 ? ` (이미 있는 ${skipped}명 제외)` : ''}`
}

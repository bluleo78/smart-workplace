// 내 그룹을 사람으로 펼치기(WP-1023 노트 공유 → WP-1056 드라이브 팀 스페이스 멤버) — 내 그룹은 그룹 자체를 대상·멤버로 남기지 않고, 고르는 시점의
// 사람 구성원으로 풀어 더한다. 노트 공유 창과 공간 멤버 창이 같은 규칙(구성원 받기·중복 빼기·안내 문구)을 쓰도록 여기 모은다.
import { toast } from 'sonner'

import { userGroupsApi } from '../../api/userGroups'
import { handleApiError } from '../../lib/api-error'
import type { UserGroupMemberHit } from '../../types/userGroup'
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

/**
 * 내 그룹을 펼친 뒤의 안내(WP-1023) — 「개발 스터디에서 3명 추가 (이미 있는 1명 제외)」. 더할 사람이 없으면 그 사실만.
 * pinned(WP-1186) 는 added 중 부서(조직)로 이미 들어와 있다 직접 멤버로 고정된 사람 수 — 새로 들어온 사람과 나눠 「2명 추가 · 부서로 있던 1명은 직접 멤버로 고정」.
 */
export function groupExpansionMessage(groupName: string, added: number, skipped: number, pinned = 0): string {
  if (added === 0) return skipped > 0 ? `${groupName}의 ${skipped}명은 이미 모두 있습니다` : `${groupName}에 추가할 사람이 없습니다`
  const skippedNote = skipped > 0 ? ` (이미 있는 ${skipped}명 제외)` : ''
  const pinnedCount = Math.min(pinned, added)
  if (pinnedCount === 0) return `${groupName}에서 ${added}명 추가${skippedNote}`
  const pinnedNote = `부서로 있던 ${pinnedCount}명은 직접 멤버로 고정`
  const fresh = added - pinnedCount
  return fresh > 0 ? `${groupName}에서 ${fresh}명 추가 · ${pinnedNote}${skippedNote}` : `${groupName}에서 ${pinnedNote}${skippedNote}`
}

/** 내 그룹을 사람으로 풀어 더한 결과 — 새로 더한·이미 있어 뺀·추가하지 못한 사람 수. pinned 는 added 중 부서로 있다 직접 멤버로 고정된 수(WP-1186). */
export interface GroupMembersAddResult {
  added: number
  skipped: number
  failed: number
  pinned: number
}

/** 내 그룹 구성원을 더할 곳(드라이브 팀 공간 WP-1056·채널 WP-1058)마다 다른 부분 — 지금 멤버 읽기, 한 명 더하기, 끝난 뒤 무효화. */
export interface GroupMemberAdder {
  /**
   * 이미 있어 뺄 사람 id — 화면 캐시가 아니라 방금 받은 목록(업서트가 그사이 바뀐 역할을 덮지 않게).
   * 다른 경로(채널의 부서)로 이미 들어와 있어 더하면 직접 멤버로 고정되는 사람이 있으면 { ids, pinnable } 로 함께 준다(WP-1186) — 결과의 pinned 로 센다.
   */
  readCurrentIds: () => Promise<number[] | { ids: number[]; pinnable: number[] }>
  /** 한 명 더하기 — 실패해도 나머지는 계속 더한다. */
  addOne: (userId: number) => Promise<unknown>
  /** 한 명이라도 더하려 했으면 끝에 한 번 부른다. */
  invalidate: () => void
}

/**
 * 내 그룹 구성원을 한 명씩 더한다(WP-1056 → WP-1058 공용) — 그룹 구성원 받기와 지금 멤버 읽기를 함께 기다리고(Promise.all), 이미 있는 사람·중복을 뺀 뒤
 * 모두 더해 본다(사람마다 실패 토스트가 뜨지 않게 결과만 모은다). 무효화는 한 번만 하고 더한·뺀·실패한 수를 돌려준다(안내는 addPersonalGroupWithNotice).
 */
export async function addMembersFromGroup(
  memberIds: number[] | Promise<number[]>,
  adder: GroupMemberAdder,
): Promise<GroupMembersAddResult> {
  const [ids, read] = await Promise.all([memberIds, adder.readCurrentIds()])
  const current = Array.isArray(read) ? read : read.ids
  const pinnable = new Set(Array.isArray(read) ? [] : read.pinnable)
  const { userIds, skipped } = addGroupMembers(current, ids)
  const fresh = userIds.slice(current.length)
  const results = await Promise.allSettled(fresh.map((userId) => adder.addOne(userId)))
  const failed = results.filter((r) => r.status === 'rejected').length
  const pinned = fresh.filter((userId, i) => results[i].status === 'fulfilled' && pinnable.has(userId)).length
  if (fresh.length > 0) adder.invalidate()
  return { added: fresh.length - failed, skipped, failed, pinned }
}

/**
 * 내 그룹을 고른 뒤의 공통 흐름(WP-1056 공간 멤버 창 → WP-1058 채널 멤버 패널) — 지금 사람 구성원(하위 그룹 포함)을 받아 add 에 넘기고,
 * 몇 명을 더했는지(실패가 있으면 함께) 알린다. 구성원 받기는 기다리지 않고 넘겨 add 가 지금 멤버 읽기와 함께 기다리게 한다.
 */
export async function addPersonalGroupWithNotice(
  group: GroupOption,
  add: (memberIds: Promise<number[]>) => Promise<GroupMembersAddResult>,
): Promise<void> {
  try {
    const { added, skipped, failed, pinned } = await add(fetchPersonalGroupMemberIds(group))
    const text = groupExpansionMessage(group.name, added, skipped, pinned)
    if (failed > 0) toast.error(`${text} — ${failed}명은 추가하지 못했습니다`)
    else if (added === 0) toast.info(text)
    else toast.success(text)
  } catch (e) {
    handleApiError(e, '그룹 구성원을 추가하지 못했습니다')
  }
}

/** 조직·내 그룹을 사람으로 풀어 넣을 계획(WP-1059) — 넣기 전에 몇 명이 들어가는지 확인받는 곳(일정 참석자)이 쓴다. */
export interface GroupExpansionPlan {
  /** 새로 넣을 사람(서버 구성원 찾기 순서 — 이름순). */
  toAdd: { id: number; name: string }[]
  /** 이미 목록에 있어 뺀 사람 수. */
  skipped: number
  /** 그룹에 나도 있어 뺐는지(나는 이미 들어 있다 — 일정 주최자 등). */
  meIncluded: boolean
  /** 이번에 더 넣을 수 있는 수 — toAdd 가 이보다 많으면 넣지 않는다. */
  capacity: number
}

/**
 * 그룹 구성원 찾기 결과(하위 포함 — 서버가 활성 사람만 준다)에서 넣을 사람을 고른다. 외부 연락처 행은 사람이 아니라 빼고, 이미 있는 사람·나는 빼고,
 * 두 하위 조직에 있는 같은 사람은 한 번만 넣는다.
 */
export function planGroupExpansion(
  hits: UserGroupMemberHit[],
  existingIds: number[],
  meId: number | undefined,
  capacity: number,
): GroupExpansionPlan {
  const existing = new Set(existingIds)
  const added = new Set<number>()
  const skipped = new Set<number>()
  const toAdd: GroupExpansionPlan['toAdd'] = []
  let meIncluded = false
  for (const h of hits) {
    if (h.targetType !== 'MEMBER') continue
    if (h.targetId === meId) meIncluded = true
    else if (existing.has(h.targetId)) skipped.add(h.targetId)
    else if (!added.has(h.targetId)) {
      added.add(h.targetId)
      toAdd.push({ id: h.targetId, name: h.name })
    }
  }
  return { toAdd, skipped: skipped.size, meIncluded, capacity }
}

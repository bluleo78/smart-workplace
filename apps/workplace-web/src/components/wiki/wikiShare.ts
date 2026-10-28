// WP-579 노트 페이지 공유 — 화면이 쓰는 판정·문구(링크 주소, 넓히는 변경인지, 범위 요약)와 링크 복사.
// WP-1023 — 내 그룹을 사람으로 펼치기(그룹 목록 평면화·거르기는 공통 선택 창 쪽 components/members/groupOptions 로 옮겼다, WP-1052).

import { toast } from 'sonner'

import { copyText } from '@/lib/copyText'

import { isEditRole } from '../../lib/collab/collabStatus'
import type {
  WikiPageShareRequest,
  WikiPageSummary,
  WikiRole,
  WikiShareAudience,
  WikiShareListItem,
  WikiSharePermission,
} from '../../types/wiki'

/**
 * 공유 창(버튼·모바일 메뉴 항목·공유 상태 조회)을 둘 수 있는지 — 스페이스 EDITOR 이상만.
 * 서버가 공유 설정과 기록을 EDITOR 미만에게 403 으로 막는다(VIEWER 가 편집 링크 토큰을 읽어 스스로 권한을 얻지 못하게)
 * 그래서 VIEWER 에겐 버튼을 두지 않고 조회도 하지 않는다. 공유 링크로 들어온 화면(viaShareLink)은 멤버가 아니므로 항상 막는다.
 */
export function canManageShare(spaceRole: WikiRole | undefined, viaShareLink: boolean): boolean {
  return !viaShareLink && spaceRole != null && isEditRole(spaceRole)
}

/** 공유 링크 주소 — 받는 사람은 이 주소로만 들어온다(재발급하면 토큰이 바뀌어 이전 주소는 막힌다). */
export function wikiShareUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/wiki/share/${token}`
}

/** 하위 포함 공유 안의 한 페이지를 바로 여는 주소(WP-987) — 공유 화면 라우트 `/wiki/share/:token/pages/:pageId`. */
export function wikiSharePageUrl(token: string, pageId: number, origin: string = window.location.origin): string {
  return `${wikiShareUrl(token, origin)}/pages/${pageId}`
}

/** 공유 링크 주소를 클립보드에 넣고 결과를 토스트로 알린다 — 공유 창·공유 중인 페이지 목록·공유 표가 같은 문구를 쓴다. */
export async function copyShareLink(token: string, pageId?: number): Promise<void> {
  if (await copyText(pageId == null ? wikiShareUrl(token) : wikiSharePageUrl(token, pageId))) toast.success('링크를 복사했습니다')
  else toast.error('복사하지 못했습니다')
}

/** 처음 공유할 때의 기본값 — 워크스페이스 멤버 누구나·보기만·하위 페이지 포함(WP-987, Drive·Notion 과 같게)·무기한. */
export const DEFAULT_SHARE: WikiPageShareRequest = {
  audience: 'WORKSPACE',
  permission: 'VIEW',
  includeChildren: true,
  userIds: [],
  expiresAt: null,
}

/** 외부 링크로 바꿀 때 처음 만료 — 30일(외부는 무기한을 직접 골라야 한다). */
export const PUBLIC_DEFAULT_EXPIRY_DAYS = 30

/** 오늘부터 days 일 뒤 같은 시각(ISO). */
export function expiryAfterDays(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

/** 넓히는 변경의 종류 — 확인 창 문구를 고른다. */
export type ShareWidening = 'public' | 'audience' | 'permission'

/**
 * 바꾸면 더 많은 사람이 보거나 고칠 수 있게 되는지 — 그런 변경은 확인을 한 번 받는다(이슈: 접근 범위 변경 시 확인 절차).
 * 외부(PUBLIC)로, 지정한 사람 → 워크스페이스 전체로, 보기 → 편집이 넓히는 변경이다. 사람 추가는 그 사람을 직접 고른 것이라 묻지 않는다.
 */
export function shareWidening(
  prev: Pick<WikiPageShareRequest, 'audience' | 'permission'>,
  next: Pick<WikiPageShareRequest, 'audience' | 'permission'>,
): ShareWidening | null {
  if (prev.audience !== 'PUBLIC' && next.audience === 'PUBLIC') return 'public'
  if (prev.audience === 'PEOPLE' && next.audience === 'WORKSPACE') return 'audience'
  if (prev.permission === 'VIEW' && next.permission === 'EDIT') return 'permission'
  return null
}

/**
 * 범위 한 줄 요약 — 공유 중인 페이지 목록. 예: "워크스페이스 전체 · 보기", "3명 · 편집", "외부 공개 · 보기".
 * 지정한 조직도 부서가 있으면 함께 센다(WP-1023) — "3명, 부서 1개 · 편집", 부서만이면 "부서 2개 · 보기".
 */
export function shareScopeLabel(
  audience: WikiShareAudience,
  permission: WikiSharePermission,
  peopleCount: number,
  groupCount = 0,
): string {
  const people =
    groupCount === 0 ? `${peopleCount}명` : peopleCount === 0 ? `부서 ${groupCount}개` : `${peopleCount}명, 부서 ${groupCount}개`
  const who = audience === 'WORKSPACE' ? '워크스페이스 전체' : audience === 'PUBLIC' ? '외부 공개' : people
  return `${who} · ${permission === 'EDIT' ? '편집' : '보기'}`
}

/**
 * 내 그룹을 지정한 사람으로 펼친다(WP-1023) — 그룹(하위 그룹 포함)의 사람 구성원 중 아직 지정한 사람 목록에 없는 사람만 뒤에 더한다(목록 안에서만
 * 중복을 뺀다 — 지정한 부서의 구성원인지는 보지 않는다). exclude(공유하는 나 자신·공유를 만든 사람 — 이미 열 수 있다)는 더하지도 세지도 않는다.
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

/** 관리자 공유 목록이 한 번에 받는 최대 건수 — 백엔드 기본·상한과 같다(넘으면 최신 순으로 잘린다). */
export const ADMIN_SHARE_LIST_CAP = 500

/** 만료 시각이 지났는지 — 만료가 없으면(null) 지나지 않은 것. 지난 링크는 이미 막혀 있다. */
export function isShareExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  return expiresAt != null && new Date(expiresAt) < now
}

/** 외부 공유를 끄면 지금 막히는 링크 수 — 외부 공개(PUBLIC) 중 아직 만료되지 않은 것(만료된 것은 이미 막혀 있다). */
export function countLivePublicShares(items: Pick<WikiShareListItem, 'audience' | 'expiresAt'>[], now: Date = new Date()): number {
  return items.filter((i) => i.audience === 'PUBLIC' && !isShareExpired(i.expiresAt, now)).length
}

type TreeNode = Pick<WikiPageSummary, 'id' | 'parentId' | 'title' | 'share' | 'shareExcluded'>

/** 하위 포함 공유의 루트 — 이동 경고 문구용. */
export interface CoveringShare {
  pageId: number
  title: string
  audience: WikiShareAudience
  /** blocked 로 알릴 때만 — 상위 공유 제외가 아니라 옮길 페이지의 자기 공유가 살아 있어서 열리지 않는 경우(WP-1043). 안내 문구를 가른다. */
  byOwnShare?: boolean
}

/**
 * 이 페이지가 위의 하위 포함 공유 상속을 멈추는지(WP-1043) — 상위 공유 제외 표시(WP-987)가 있거나, 따로 켠 자기 공유가 만료 전이다. 서버 접근 판정
 * (WikiShareRepository.stopsInheritance)과 같은 규칙이라 이동 경고·트리 아이콘이 실제 접근과 어긋나지 않는다. 만료된 자기 공유는 멈추지 않는다.
 */
export function stopsInheritance(p: Pick<TreeNode, 'share' | 'shareExcluded'>): boolean {
  return p.shareExcluded === true || (p.share != null && p.share.expired !== true)
}

/**
 * parentId 부터 위로 올라가며 하위 포함 공유를 모은다(가까운 것부터). 사이클이 있어도 한 번씩만.
 * 상속이 멈추는 페이지({@link stopsInheritance})에서 멈춘다(WP-1031·WP-1043) — 그 페이지 자신의 하위 포함 공유는 모으되, 그 위의 공유는 그 페이지
 * 아래를 덮지 않는다. 서버 접근 판정(stopsInheritance)과 같은 규칙이다.
 * 만료된 하위 포함 공유는 모으지 않는다(WP-1044) — 서버 접근 판정은 만료된 공유로 어떤 페이지도 열지 않는다. 만료된 자기 공유는 상속도 멈추지 않으므로
 * 그 위로 계속 올라가 살아 있는 공유를 찾는다.
 */
function coveringFrom(byId: Map<number, TreeNode>, parentId: number | null): CoveringShare[] {
  const out: CoveringShare[] = []
  const seen = new Set<number>()
  for (let id = parentId; id != null && !seen.has(id); id = byId.get(id)?.parentId ?? null) {
    seen.add(id)
    const p = byId.get(id)
    if (p?.share?.includeChildren && p.share.expired !== true) out.push({ pageId: p.id, title: p.title, audience: p.share.audience })
    if (p && stopsInheritance(p)) break
  }
  return out
}

/**
 * 이동 영향 — leaving: 옮기면 빠지는 하위 포함 공유, entering: 새로 덮는 공유, blocked: 새 위치를 덮지만 옮길 페이지가 상위 공유에서
 * 제외돼 있거나 자기 공유가 살아 있어(WP-1031·WP-1043) 그 링크로는 열리지 않는 공유. 그런 페이지는 옮기기 전에도 덮이지 않았으므로 leaving·entering 은 비어 있다(다른 스페이스로 옮기며 자기 공유가 해제되는 경우만 예외).
 */
export interface ShareMoveImpact {
  leaving: CoveringShare[]
  entering: CoveringShare[]
  blocked: CoveringShare[]
}

/** 옮길 페이지가 상속을 멈추는 이유 — 제외 표시가 우선(문구가 더 직접적), 아니면 자기 공유. 멈추지 않으면 null. */
type StopReason = 'excluded' | 'ownShare' | null
const stopReason = (p: TreeNode | undefined): StopReason =>
  p == null || !stopsInheritance(p) ? null : p.shareExcluded === true ? 'excluded' : 'ownShare'

/**
 * 옮기기 전(before)·뒤(after)의 멈춤 이유로 영향을 가른다(WP-1043). 옮기기 전에 멈췄으면 옛 공유는 원래 덮지 않았으므로 leaving 이 없고, 옮긴 뒤에 멈추면
 * 새 공유로 열리지 않으므로 entering 대신 blocked 로만 알린다. 같은 스페이스 안 이동은 둘이 같다 — 다른 스페이스로 옮길 때만 옮기며 자기 공유가
 * 해제되어(공유한 사람이 대상 스페이스 편집자가 아님) before 는 멈추고 after 는 멈추지 않을 수 있다.
 */
function impactOf(before: StopReason, after: StopReason, leaving: CoveringShare[], entering: CoveringShare[]): ShareMoveImpact {
  const blocked = after == null ? [] : after === 'ownShare' ? entering.map((s) => ({ ...s, byOwnShare: true })) : entering
  return {
    leaving: before == null ? leaving : [],
    entering: after == null ? entering : [],
    blocked,
  }
}

/** 이동 경고를 보여야 하는지 — 빠지거나 들어가는 공유, 또는 제외·자기 공유 때문에 열리지 않는 새 위치 공유가 하나라도 있으면. */
export function hasShareMoveImpact(impact: ShareMoveImpact): boolean {
  return impact.leaving.length > 0 || impact.entering.length > 0 || impact.blocked.length > 0
}

/** 트리 행 공유 표시 — 자기 공유(own), 상위 페이지 공유(하위 포함)에 포함(inherited). 없으면 맵에 없다. */
export type TreeShareMark = 'own' | 'inherited'

/**
 * 한 행의 공유 표시(WP-1043) — 살아 있는 자기 공유는 'own'. 그렇지 않고 상속이 멈추지 않으면(stopsInheritance: 제외 표시도 만료 전 자기 공유도 없음)
 * 위의 하위 포함 공유가 덮을 때 'inherited'. 만료된 자기 공유는 상속을 멈추지 않으므로 덮는 공유가 있으면 'inherited' 이고, 없을 때만 'own' 으로 남는다.
 */
function treeShareMark(byId: Map<number, TreeNode>, p: TreeNode): TreeShareMark | null {
  if (p.share && p.share.expired !== true) return 'own'
  if (!stopsInheritance(p) && coveringFrom(byId, p.parentId).length > 0) return 'inherited'
  return p.share ? 'own' : null
}

/**
 * 트리 전체의 공유 표시를 한 번에 — 행마다 조상을 다시 훑지 않게 맵으로 돌려준다. 상속이 멈추는 페이지(제외 표시·살아 있는 자기 공유, WP-1031·WP-1043)와
 * 그 하위는 위의 공유로 열리지 않으므로 inherited 로 표시하지 않는다(coveringFrom 이 stopsInheritance 에서 멈춘다).
 */
export function treeShareMarks(pages: TreeNode[]): Map<number, TreeShareMark> {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const marks = new Map<number, TreeShareMark>()
  for (const p of pages) {
    const mark = treeShareMark(byId, p)
    if (mark) marks.set(p.id, mark)
  }
  return marks
}

/**
 * 페이지를 newParentId 아래로 옮기면 어떤 하위 포함 공유에서 빠지고(leaving) 새로 들어가는지(entering) — 하나라도 있으면 옮기기 전에 확인한다.
 * 공유 범위는 지금 위치로 정해지므로 옮기는 순간 링크로 보이던 페이지가 사라지거나 새로 보이게 된다. 옮길 페이지가 상위 공유에서 제외돼 있거나 자기 공유가
 * 살아 있으면 새 위치의 공유로도 열리지 않으므로 blocked 로 알린다(WP-1031·WP-1043).
 */
export function shareMoveImpact(pages: TreeNode[], pageId: number, newParentId: number | null): ShareMoveImpact {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const before = coveringFrom(byId, byId.get(pageId)?.parentId ?? null)
  const after = coveringFrom(byId, newParentId)
  const ids = (xs: CoveringShare[]) => new Set(xs.map((x) => x.pageId))
  const beforeIds = ids(before)
  const afterIds = ids(after)
  const reason = stopReason(byId.get(pageId))
  return impactOf(
    reason,
    reason,
    before.filter((x) => !afterIds.has(x.pageId)),
    after.filter((x) => !beforeIds.has(x.pageId)),
  )
}

/**
 * 다른 스페이스로 옮길 때의 공유 범위 변화(WP-988) — 원본 트리에서 지금 위치를 덮던 하위 포함 공유는 모두 빠지고(leaving), 대상 트리에서 새 부모를
 * 덮는 하위 포함 공유에는 새로 들어간다(entering). 두 스페이스의 공유는 겹치지 않는다. 제외 표시는 페이지를 따라 옮겨 가므로 제외된 페이지는
 * blocked 로 알린다(WP-1031). 자기 공유가 있는 페이지도 blocked 지만, 공유한 사람이 대상 스페이스 편집자가 아니라 옮기며 해제되면(revokedPageIds —
 * 이동 미리보기의 revokedShares) 옮긴 뒤에는 멈추지 않으므로 새 위치의 공유가 entering 이다(WP-1043).
 */
export function shareMoveAcrossImpact(
  sourcePages: TreeNode[],
  pageId: number,
  targetPages: TreeNode[],
  newParentId: number | null,
  revokedPageIds: readonly number[] = [],
): ShareMoveImpact {
  const source = new Map(sourcePages.map((p) => [p.id, p]))
  const moving = source.get(pageId)
  const before = stopReason(moving)
  // 옮기며 해제되는 자기 공유(미리보기 revokedShares)는 옮긴 뒤에는 없다 — 제외 표시가 없으면 새 위치의 공유가 덮는다.
  const after = moving != null && revokedPageIds.includes(pageId) ? stopReason({ ...moving, share: null }) : before
  return impactOf(
    before,
    after,
    coveringFrom(source, moving?.parentId ?? null),
    coveringFrom(new Map(targetPages.map((p) => [p.id, p])), newParentId),
  )
}

/** 이동 경고의 공유 한 줄 이름 — 외부 공개면 그렇다고 분명히 적는다. */
export const coveringShareName = (s: CoveringShare) =>
  `「${s.title || '제목 없음'}」 ${s.audience === 'PUBLIC' ? '외부 공개 링크' : '공유 링크'}`

/** 제외되거나 자기 공유가 있는 페이지를 옮길 때 새 위치 공유 한 줄(WP-1031·WP-1043) — 「새로 보이게 됩니다」 대신 열리지 않는다고 알린다. */
export const blockedShareNotice = (s: CoveringShare) =>
  s.byOwnShare
    ? `이 페이지에 따로 켠 공유가 있어 새 위치의 ${coveringShareName(s)}로는 열리지 않습니다(따로 켠 공유가 우선).`
    : `상위 공유에서 제외돼 있어 새 위치의 ${coveringShareName(s)}로는 열리지 않습니다.`

/** 트리에서 pageId 아래 페이지 수(손자까지). 사이클이 있어도 한 번씩만 센다. */
export function countDescendants(pages: Pick<WikiPageSummary, 'id' | 'parentId'>[], pageId: number): number {
  const byParent = new Map<number, number[]>()
  for (const p of pages) {
    if (p.parentId == null) continue
    const arr = byParent.get(p.parentId) ?? []
    arr.push(p.id)
    byParent.set(p.parentId, arr)
  }
  const seen = new Set<number>([pageId])
  const stack = [...(byParent.get(pageId) ?? [])]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(byParent.get(id) ?? []))
  }
  return seen.size - 1
}

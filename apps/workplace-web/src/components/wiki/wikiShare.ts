// WP-579 노트 페이지 공유 — 화면이 쓰는 판정·문구(링크 주소, 넓히는 변경인지, 범위 요약)와 링크 복사.

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

/** 범위 한 줄 요약 — 공유 중인 페이지 목록. 예: "워크스페이스 전체 · 보기", "3명 · 편집", "외부 공개 · 보기". */
export function shareScopeLabel(audience: WikiShareAudience, permission: WikiSharePermission, peopleCount: number): string {
  const who = audience === 'WORKSPACE' ? '워크스페이스 전체' : audience === 'PUBLIC' ? '외부 공개' : `${peopleCount}명`
  return `${who} · ${permission === 'EDIT' ? '편집' : '보기'}`
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

type TreeNode = Pick<WikiPageSummary, 'id' | 'parentId' | 'title' | 'share'>

/** 하위 포함 공유의 루트 — 이동 경고 문구용. */
export interface CoveringShare {
  pageId: number
  title: string
  audience: WikiShareAudience
}

/** parentId 부터 위로 올라가며 하위 포함 공유를 모은다(가까운 것부터). 사이클이 있어도 한 번씩만. */
function coveringFrom(byId: Map<number, TreeNode>, parentId: number | null): CoveringShare[] {
  const out: CoveringShare[] = []
  const seen = new Set<number>()
  for (let id = parentId; id != null && !seen.has(id); id = byId.get(id)?.parentId ?? null) {
    seen.add(id)
    const p = byId.get(id)
    if (p?.share?.includeChildren) out.push({ pageId: p.id, title: p.title, audience: p.share.audience })
  }
  return out
}

/** 트리 행 공유 표시 — 자기 공유(own), 상위 페이지 공유(하위 포함)에 포함(inherited). 없으면 맵에 없다. */
export type TreeShareMark = 'own' | 'inherited'

/** 트리 전체의 공유 표시를 한 번에 — 행마다 조상을 다시 훑지 않게 맵으로 돌려준다. */
export function treeShareMarks(pages: TreeNode[]): Map<number, TreeShareMark> {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const marks = new Map<number, TreeShareMark>()
  for (const p of pages) {
    if (p.share) marks.set(p.id, 'own')
    else if (coveringFrom(byId, p.parentId).length > 0) marks.set(p.id, 'inherited')
  }
  return marks
}

/**
 * 페이지를 newParentId 아래로 옮기면 어떤 하위 포함 공유에서 빠지고(leaving) 새로 들어가는지(entering) — 하나라도 있으면 옮기기 전에 확인한다.
 * 공유 범위는 지금 위치로 정해지므로 옮기는 순간 링크로 보이던 페이지가 사라지거나 새로 보이게 된다.
 */
export function shareMoveImpact(
  pages: TreeNode[],
  pageId: number,
  newParentId: number | null,
): { leaving: CoveringShare[]; entering: CoveringShare[] } {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const before = coveringFrom(byId, byId.get(pageId)?.parentId ?? null)
  const after = coveringFrom(byId, newParentId)
  const ids = (xs: CoveringShare[]) => new Set(xs.map((x) => x.pageId))
  const beforeIds = ids(before)
  const afterIds = ids(after)
  return {
    leaving: before.filter((x) => !afterIds.has(x.pageId)),
    entering: after.filter((x) => !beforeIds.has(x.pageId)),
  }
}

/**
 * 다른 스페이스로 옮길 때의 공유 범위 변화(WP-988) — 원본 트리에서 지금 위치를 덮던 하위 포함 공유는 모두 빠지고(leaving), 대상 트리에서 새 부모를
 * 덮는 하위 포함 공유에는 새로 들어간다(entering). 두 스페이스의 공유는 겹치지 않는다.
 */
export function shareMoveAcrossImpact(
  sourcePages: TreeNode[],
  pageId: number,
  targetPages: TreeNode[],
  newParentId: number | null,
): { leaving: CoveringShare[]; entering: CoveringShare[] } {
  const source = new Map(sourcePages.map((p) => [p.id, p]))
  return {
    leaving: coveringFrom(source, source.get(pageId)?.parentId ?? null),
    entering: coveringFrom(new Map(targetPages.map((p) => [p.id, p])), newParentId),
  }
}

/** 이동 경고의 공유 한 줄 이름 — 외부 공개면 그렇다고 분명히 적는다. */
export const coveringShareName = (s: CoveringShare) =>
  `「${s.title || '제목 없음'}」 ${s.audience === 'PUBLIC' ? '외부 공개 링크' : '공유 링크'}`

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

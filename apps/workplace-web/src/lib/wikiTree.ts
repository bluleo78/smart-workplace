// 노트 페이지 트리의 순수 helper — 사이드바(WikiSidebar.flattenTree)와 프로젝트 노트 탭(첫 페이지 이동)이 같은 루트·정렬 규칙을 쓰게 한다.
import type { WikiPageSummary } from '@/types/wiki'

/**
 * 부모별 자식 목록(형제는 position 순). 키 null 이 최상위다.
 * parentId 가 목록에 없는(고아) 페이지는 최상위로 취급한다 — 사이드바가 보여 주는 루트와 같다.
 */
export function childrenByParent(pages: WikiPageSummary[]): Map<number | null, WikiPageSummary[]> {
  const ids = new Set(pages.map((p) => p.id))
  const byParent = new Map<number | null, WikiPageSummary[]>()
  for (const p of pages) {
    const key = p.parentId != null && ids.has(p.parentId) ? p.parentId : null
    const arr = byParent.get(key) ?? []
    arr.push(p)
    byParent.set(key, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position)
  return byParent
}

/** 최상위 페이지들 — position 순(사이드바 첫 줄이 곧 첫 원소). */
export function topLevelPages(pages: WikiPageSummary[]): WikiPageSummary[] {
  return childrenByParent(pages).get(null) ?? []
}

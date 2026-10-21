// WP-579 공유 링크 화면의 트리 — 공유 화면(로그인)과 외부 보기가 함께 쓴다.

import type { WikiPageSummary } from '../../types/wiki'

type ShareTreeNode = Pick<WikiPageSummary, 'id' | 'parentId' | 'position'>

/** 공유 묶음을 깊이 우선으로 편다 — 묶음 밖 부모를 가리키는 페이지(공유한 페이지)가 맨 위 단계. */
export function flattenShareTree<T extends ShareTreeNode>(pages: T[]): { page: T; depth: number }[] {
  const ids = new Set(pages.map((p) => p.id))
  const byParent = new Map<number | null, T[]>()
  for (const p of pages) {
    const key = p.parentId != null && ids.has(p.parentId) ? p.parentId : null
    byParent.set(key, [...(byParent.get(key) ?? []), p])
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position)
  const out: { page: T; depth: number }[] = []
  const walk = (parent: number | null, depth: number) => {
    for (const p of byParent.get(parent) ?? []) {
      out.push({ page: p, depth })
      walk(p.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}


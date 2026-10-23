// 「이동…」 위치 고르기(WP-839) — 끌기 없이 페이지를 다른 페이지 하위로 옮길 때 고를 수 있는 자리와 보낼 순서를 계산한다.

import type { WikiPageSummary } from '../../types/wiki'
import { flattenShareTree } from './wikiShareTree'

type TreePage = Pick<WikiPageSummary, 'id' | 'parentId' | 'title' | 'position'>

/** pageId 와 그 하위 페이지 id — 자기 아래로는 옮길 수 없어(서버 400) 고를 자리에서 뺀다. */
export function subtreeIds(pages: TreePage[], pageId: number): Set<number> {
  const out = new Set<number>([pageId])
  // 부모 → 자식을 한 단계씩 넓힌다. 이미 넣은 id 는 다시 보지 않아 순환 데이터에도 끝난다.
  let frontier = [pageId]
  while (frontier.length > 0) {
    const next = pages.filter((p) => p.parentId != null && frontier.includes(p.parentId) && !out.has(p.id))
    next.forEach((p) => out.add(p.id))
    frontier = next.map((p) => p.id)
  }
  return out
}

/** 고를 수 있는 자리 — 공간 트리를 깊이 우선으로 펴되 옮길 페이지와 그 하위는 뺀다. 「최상위」는 부르는 쪽이 맨 위에 둔다. */
export function moveTargets<T extends TreePage>(pages: T[], pageId: number): { page: T; depth: number }[] {
  const blocked = subtreeIds(pages, pageId)
  // 막힌 페이지의 하위도 함께 빠지므로 깊이가 어긋나지 않는다(자기 하위만 빠지고 그 위 단계는 그대로).
  return flattenShareTree(pages).filter((r) => !blocked.has(r.page.id))
}

/** 새 부모의 맨 아래 자리(0부터) — 옮길 페이지는 빼고 센다. 서버도 범위를 넘으면 맨 끝으로 맞춘다. */
export function lastChildPosition(pages: TreePage[], pageId: number, parentId: number | null): number {
  return pages.filter((p) => p.id !== pageId && (p.parentId ?? null) === parentId).length
}

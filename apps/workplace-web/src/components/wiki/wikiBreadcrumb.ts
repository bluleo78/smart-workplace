import type { WikiPageSummary } from '../../types/wiki'

/**
 * 트리 요약 + 현재 pageId → 루트부터 현재까지의 조상 경로(자기 자신 포함).
 * 부모가 목록에 없으면(고아) 거기서 멈추고, 방문 집합으로 순환을 차단한다.
 */
export function buildBreadcrumb(
  pages: WikiPageSummary[],
  pageId: number | null,
): { id: number; title: string }[] {
  if (pageId == null) return []
  const byId = new Map(pages.map((p) => [p.id, p]))
  const path: { id: number; title: string }[] = []
  const seen = new Set<number>()
  let cur = byId.get(pageId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.unshift({ id: cur.id, title: cur.title || '제목 없음' })
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
  }
  return path
}

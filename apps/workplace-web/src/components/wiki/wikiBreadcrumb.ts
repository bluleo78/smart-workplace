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

/**
 * 트리를 불러왔는데 경로가 비면(현재 노트가 트리에 없음 — 삭제 SSE 뒤 트리 재조회 등) 현재 노트 하나로 채운다(WP-296).
 * 데스크톱 브레드크럼이 비거나 모바일 헤더가 일반 "노트"로 바뀌어 무엇을 보고 있는지 잃지 않게 한다.
 * 트리를 불러오는 중에는 채우지 않는다 — 처음 열 때 한 칸짜리 경로가 잠깐 그려졌다 바뀌는 깜빡임을 막는다.
 */
export function breadcrumbOrSelf(
  crumbs: { id: number; title: string }[],
  self: { id: number; title: string },
  treeLoaded: boolean,
): { id: number; title: string }[] {
  if (crumbs.length > 0 || !treeLoaded) return crumbs
  return [{ id: self.id, title: self.title || '제목 없음' }]
}

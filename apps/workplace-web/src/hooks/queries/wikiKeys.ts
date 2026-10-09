import type { QueryClient } from '@tanstack/react-query'

export const wikiKeys = {
  all: ['wiki'] as const,
  spaces: () => ['wiki', 'spaces'] as const,
  tree: (spaceId: number) => ['wiki', 'tree', spaceId] as const,
  page: (pageId: number) => ['wiki', 'page', pageId] as const,
  members: (spaceId: number) => ['wiki', 'members', spaceId] as const,
  mentions: (pageId: number) => ['wiki', 'mentions', pageId] as const,
  backlinks: (pageId: number) => ['wiki', 'backlinks', pageId] as const,
  // 버전 기록(WP-282). 한 판 키는 목록 키의 접두가 아니다 — 복원 뒤 목록만 무효화할 때 바뀌지 않는 판 본문 캐시까지 다시 받지 않게.
  revisions: (pageId: number) => ['wiki', 'revisions', pageId] as const,
  revision: (pageId: number, version: number) => ['wiki', 'revision', pageId, version] as const,
}

/**
 * 지운 노트를 지금 보는 화면이 없으면 그 상세 캐시를 버린다(WP-296) — 나중에 돌아왔을 때 낡은 캐시를 잠깐이라도 그리지 않게.
 * 열린 화면(observer 있음)의 캐시는 남는다 — 재조회가 404 면 오류 화면이다(wikiPageViewMode).
 */
export function dropInactiveWikiPage(qc: QueryClient, pageId: number): void {
  qc.removeQueries({ queryKey: wikiKeys.page(pageId), exact: true, type: 'inactive' })
}

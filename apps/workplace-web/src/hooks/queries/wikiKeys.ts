import type { QueryClient } from '@tanstack/react-query'

export const wikiKeys = {
  all: ['wiki'] as const,
  spaces: () => ['wiki', 'spaces'] as const,
  tree: (spaceId: number) => ['wiki', 'tree', spaceId] as const,
  page: (pageId: number) => ['wiki', 'page', pageId] as const,
  // 공유 링크로 받은 페이지 상세(WP-579) — 토큰을 넣어 멤버 캐시·다른 링크 캐시와 나눈다(멘션·이미지 blob 과 같은 방식). page(id) 가 접두라
  // page(id) 로 무효화하면 함께 무효화된다.
  sharedPage: (pageId: number, token: string) => ['wiki', 'page', pageId, token] as const,
  members: (spaceId: number) => ['wiki', 'members', spaceId] as const,
  mentions: (pageId: number) => ['wiki', 'mentions', pageId] as const,
  backlinks: (pageId: number) => ['wiki', 'backlinks', pageId] as const,
  // 버전 기록(WP-282). 한 판 키는 목록 키의 접두가 아니다 — 복원 뒤 목록만 무효화할 때 바뀌지 않는 판 본문 캐시까지 다시 받지 않게.
  revisions: (pageId: number) => ['wiki', 'revisions', pageId] as const,
  revision: (pageId: number, version: number) => ['wiki', 'revision', pageId, version] as const,
  // 페이지 공유(WP-579) — 설정·기록·스페이스의 공유 중 목록·링크로 연 묶음.
  share: (pageId: number) => ['wiki', 'share', pageId] as const,
  shareEvents: (pageId: number) => ['wiki', 'shareEvents', pageId] as const,
  sharedPages: (spaceId: number) => ['wiki', 'sharedPages', spaceId] as const,
  shareLink: (token: string) => ['wiki', 'shareLink', token] as const,
  // 알림에서 연 노트의 입구 판정(멤버·공유 대상) — /wiki/open/:pageId.
  entry: (pageId: number) => ['wiki', 'entry', pageId] as const,
  myShares: () => ['wiki', 'myShares'] as const,
  allShares: () => ['wiki', 'allShares'] as const,
  sharePolicy: () => ['wiki', 'sharePolicy'] as const,
  // 외부(비로그인) 보기(WP-579) — 'wiki' 아래에 두지 않는다: 로그인 화면의 wikiKeys.all 무효화가 공개 화면까지 다시 받게 하지 않으려고.
  // publicShareLink 는 그 링크의 모든 페이지 응답 접두(닫힌 링크 캐시를 한 번에 버릴 때).
  publicShareLink: (token: string) => ['wikiPublicShare', token] as const,
  publicShare: (token: string, pageId: number | null) => ['wikiPublicShare', token, pageId] as const,
}

/**
 * 지운 노트를 지금 보는 화면이 없으면 그 상세 캐시를 버린다(WP-296) — 나중에 돌아왔을 때 낡은 캐시를 잠깐이라도 그리지 않게.
 * 열린 화면(observer 있음)의 캐시는 남는다 — 재조회가 404 면 오류 화면이다(wikiPageViewMode).
 */
export function dropInactiveWikiPage(qc: QueryClient, pageId: number): void {
  qc.removeQueries({ queryKey: wikiKeys.page(pageId), exact: true, type: 'inactive' })
}

/** 페이지 상세 캐시 키 — 공유 토큰으로 받았으면 그 토큰의 키, 아니면 멤버 키. */
export function wikiPageKey(pageId: number, shareToken?: string) {
  return shareToken ? wikiKeys.sharedPage(pageId, shareToken) : wikiKeys.page(pageId)
}

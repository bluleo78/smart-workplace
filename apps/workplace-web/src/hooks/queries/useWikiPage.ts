import { useQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiPageDetail } from '../../types/wiki'
import { wikiPageKey } from './wikiKeys'

export function useWikiPage(pageId: number | null, shareToken?: string) {
  // #788: useQuery 결과를 그대로 반환 — isError/error 를 호출부(WikiPageView)가
  // 명시적으로 구조분해할 수 있어야 로딩중/로드실패를 구분하고, 404 등 에러 시에도
  // skeleton 이 영구 고착되지 않는다.
  return useQuery<WikiPageDetail>({
    // 공유 토큰으로 받은 상세는 토큰별로 따로 둔다(WP-579) — 같은 페이지의 멤버 캐시·다른 링크 캐시를 섞어 그리지 않고, 링크가 닫히면 그 토큰 것만 버린다.
    queryKey: wikiPageKey(pageId ?? 0, shareToken),
    queryFn: () => wikiApi.getPage(pageId as number, shareToken).then((r) => r.data),
    enabled: pageId != null,
    staleTime: 0,
  })
}

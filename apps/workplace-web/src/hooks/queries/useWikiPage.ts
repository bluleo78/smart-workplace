import { useQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiPageDetail } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

export function useWikiPage(pageId: number | null) {
  // #788: useQuery 결과를 그대로 반환 — isError/error 를 호출부(WikiPageView)가
  // 명시적으로 구조분해할 수 있어야 로딩중/로드실패를 구분하고, 404 등 에러 시에도
  // skeleton 이 영구 고착되지 않는다.
  return useQuery<WikiPageDetail>({
    queryKey: wikiKeys.page(pageId ?? 0),
    queryFn: () => wikiApi.getPage(pageId as number).then((r) => r.data),
    enabled: pageId != null,
    staleTime: 0,
  })
}

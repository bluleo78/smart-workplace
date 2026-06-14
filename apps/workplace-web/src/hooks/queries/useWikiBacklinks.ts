import { useQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiBacklinksResponse } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

// 이 페이지를 참조하는 다른 페이지(백링크) 목록. pageId 없으면 비활성.
export function useWikiBacklinks(pageId: number | null) {
  return useQuery<WikiBacklinksResponse>({
    queryKey: wikiKeys.backlinks(pageId ?? 0),
    queryFn: () => wikiApi.getBacklinks(pageId as number).then((r) => r.data),
    enabled: pageId != null,
  })
}

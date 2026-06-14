import { useQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiPageDetail } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

export function useWikiPage(pageId: number | null) {
  return useQuery<WikiPageDetail>({
    queryKey: wikiKeys.page(pageId ?? 0),
    queryFn: () => wikiApi.getPage(pageId as number).then((r) => r.data),
    enabled: pageId != null,
    staleTime: 0,
  })
}

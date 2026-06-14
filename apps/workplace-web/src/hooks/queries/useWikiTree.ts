import { useQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiPageSummary } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

export function useWikiTree(spaceId: number | null) {
  return useQuery<WikiPageSummary[]>({
    queryKey: wikiKeys.tree(spaceId ?? 0),
    queryFn: () => wikiApi.listPages(spaceId as number).then((r) => r.data),
    enabled: spaceId != null,
    staleTime: 10_000,
  })
}

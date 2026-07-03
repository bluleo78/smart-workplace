import { useQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiSpace } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

export function useWikiSpaces(options?: { enabled?: boolean }) {
  return useQuery<WikiSpace[]>({
    queryKey: wikiKeys.spaces(),
    queryFn: () => wikiApi.listSpaces().then((r) => r.data),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  })
}

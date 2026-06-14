import { useMutation, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { SavePageRequest, WikiPageDetail } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

export function useCreatePage(spaceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ parentId, title }: { parentId: number | null; title: string }) =>
      wikiApi.createPage(spaceId, parentId, title).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) }),
  })
}

export function useSavePage(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<WikiPageDetail, unknown, { pageId: number; req: SavePageRequest }>({
    mutationFn: ({ pageId, req }) => wikiApi.savePage(pageId, req).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(wikiKeys.page(data.id), data)
      qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) })
    },
  })
}

export function useDeletePage(spaceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pageId: number) => wikiApi.deletePage(pageId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) }),
  })
}

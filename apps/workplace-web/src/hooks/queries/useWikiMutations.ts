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

// 페이지 이동(재정렬/재부모) — 드래그앤드롭으로 트리 위치 변경.
// 백엔드가 형제 position 을 재시퀀스하므로 클라이언트는 목표 index(position)만 전달한다.
export function useMovePage(spaceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      pageId,
      parentId,
      position,
    }: {
      pageId: number
      parentId: number | null
      position: number
    }) => wikiApi.movePage(pageId, parentId, position).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) }),
  })
}

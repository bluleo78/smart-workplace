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
      // 본문 저장으로 멘션/참조가 바뀔 수 있어 하이드레이션·백링크 캐시를 무효화한다.
      // (staleTime 30s 와 결합 시 방금 삽입한 칩의 내비게이션 메타가 즉시 갱신되도록.)
      qc.invalidateQueries({ queryKey: wikiKeys.mentions(data.id) })
      qc.invalidateQueries({ queryKey: wikiKeys.backlinks(data.id) })
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

// 팀 노트 스페이스 생성 — 성공 시 스페이스 목록을 무효화해 드롭다운에 즉시 반영한다.
// (이동/다이얼로그 닫기는 호출처의 onSuccess 에서 처리)
export function useCreateSpace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => wikiApi.createSpace(name).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.spaces() }),
  })
}

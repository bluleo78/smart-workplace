import { useMutation, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import { handleApiError } from '../../lib/api-error'
import type { SavePageRequest, WikiPageDetail } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

export function useCreatePage(spaceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ parentId, title }: { parentId: number | null; title: string }) =>
      wikiApi.createPage(spaceId, parentId, title).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) }),
    // #758: 생성도 parentId 를 검증하게 되면서 400 이 처음으로 가능해졌다 — onError 가 없으면 조용히 실패한다.
    onError: (e) => handleApiError(e, '페이지를 만들 수 없습니다'),
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
    // #758: 서버가 자기 자신/후손을 부모로 지정하는 이동을 400 으로 거부한다. 사이드바 DnD 는
    // 드래그 중인 노드의 후손을 드롭 대상에서 빼지 않으므로 사용자가 실제로 그 드롭을 할 수 있다 —
    // onError 가 없으면 트리가 조용히 제자리로 돌아가 "드래그가 먹히지 않는다" 로만 보인다.
    onError: (e) => handleApiError(e, '페이지를 이동할 수 없습니다'),
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

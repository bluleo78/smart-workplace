import { useMutation, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import { handleApiError } from '../../lib/api-error'
import type { WikiPageDetail } from '../../types/wiki'
import { dropInactiveWikiPage, wikiKeys } from './wikiKeys'

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

/**
 * 노트 제목 저장(WP-287) — 본문은 동기화 서버가 실시간으로 저장하므로 제목만 짧은 REST 로 보낸다(body:null = 본문 유지).
 * 제목은 버전 검사 없이 나중 값 우선이라 409 가 없다. 성공하면 열린 페이지 캐시의 제목만 바꾸고(본문은 Yjs 가 원본이라
 * 캐시 본문을 덮지 않는다) 사이드바 트리를 갱신한다.
 */
export function useSaveTitle(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<WikiPageDetail, unknown, { pageId: number; title: string }>({
    mutationFn: ({ pageId, title }) => wikiApi.savePageTitle(pageId, title).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData<WikiPageDetail>(wikiKeys.page(data.id), (cur) => (cur ? { ...cur, title: data.title } : cur))
      qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) })
    },
    // 실패 알림은 호출부(WikiEditor 의 제목 저장 스케줄러)가 연속 실패에 한 번만 한다 — 여기서 띄우면 재시도마다 쌓인다.
  })
}

export function useDeletePage(spaceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pageId: number) => wikiApi.deletePage(pageId).then((r) => r.data),
    onSuccess: (_, pageId) => {
      // 사이드바에서 다른 노트를 지운 경우처럼 보는 화면이 없는 노트의 캐시는 버린다.
      dropInactiveWikiPage(qc, pageId)
      return qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) })
    },
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

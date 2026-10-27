import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import { subtreeIds } from '../../components/wiki/wikiMoveTargets'
import { handleApiError } from '../../lib/api-error'
import type { WikiMovePreview, WikiPageDetail, WikiPageSummary, WikiShareResolved, WikiSpace } from '../../types/wiki'
import { dropInactiveWikiPage, wikiKeys, wikiPageKey } from './wikiKeys'

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
 * shareToken: 공유 화면(편집 링크, WP-579)이면 공유 토큰 헤더를 실어 보내고, 공유된 페이지 트리(링크 열기 캐시)의 제목도 바꾼다 —
 * 공유 화면의 트리는 스페이스 트리가 아니라 그 캐시에서 그린다.
 */
export function useSaveTitle(spaceId: number, shareToken?: string) {
  const qc = useQueryClient()
  return useMutation<WikiPageDetail, unknown, { pageId: number; title: string }>({
    mutationFn: ({ pageId, title }) => wikiApi.savePageTitle(pageId, title, shareToken).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData<WikiPageDetail>(wikiPageKey(data.id, shareToken), (cur) => (cur ? { ...cur, title: data.title } : cur))
      qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) })
      if (shareToken) {
        qc.setQueryData<WikiShareResolved>(wikiKeys.shareLink(shareToken), (cur) =>
          cur ? { ...cur, pages: cur.pages.map((p) => (p.id === data.id ? { ...p, title: data.title } : p)) } : cur,
        )
      }
    },
    // 실패 알림은 호출부(WikiEditor 의 제목 저장 스케줄러)가 연속 실패에 한 번만 한다 — 여기서 띄우면 재시도마다 쌓인다.
  })
}

/**
 * 노트 「전체 폭」 저장(WP-793). 누르는 즉시 열린 페이지 캐시를 바꿔 본문 폭이 바로 바뀌고(낙관적), 실패하면 되돌린 뒤 알린다.
 * 응답이 오면 서버 값으로 맞춘다 — 같은 페이지를 다른 사람이 동시에 바꿨다면 나중 값이 남는다.
 */
export function useSavePageFullWidth(shareToken?: string) {
  const qc = useQueryClient()
  const setFullWidth = (pageId: number, fullWidth?: boolean) =>
    qc.setQueryData<WikiPageDetail>(wikiPageKey(pageId, shareToken), (cur) => (cur ? { ...cur, fullWidth } : cur))
  return useMutation<WikiPageDetail, unknown, { pageId: number; fullWidth: boolean }, { prev?: boolean }>({
    mutationFn: ({ pageId, fullWidth }) => wikiApi.savePageFullWidth(pageId, fullWidth, shareToken).then((r) => r.data),
    onMutate: async ({ pageId, fullWidth }) => {
      const key = wikiPageKey(pageId, shareToken)
      // 진행 중인 상세 재조회가 낙관적 값을 옛 값으로 덮지 않게 먼저 멈춘다.
      await qc.cancelQueries({ queryKey: key, exact: true })
      const prev = qc.getQueryData<WikiPageDetail>(key)?.fullWidth
      setFullWidth(pageId, fullWidth)
      return { prev }
    },
    onSuccess: (data) => setFullWidth(data.id, data.fullWidth),
    onError: (e, { pageId }, ctx) => {
      setFullWidth(pageId, ctx?.prev)
      handleApiError(e, '페이지 폭을 바꿀 수 없습니다')
    },
    // 저장 중 공동 편집자의 본문 저장 알림으로 시작된 재조회가 옛 값으로 낙관적 값을 덮을 수 있다 — 끝나면 서버 값으로 다시 맞춘다.
    onSettled: (_d, _e, { pageId }) => qc.invalidateQueries({ queryKey: wikiPageKey(pageId, shareToken), exact: true }),
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
      targetSpaceId,
    }: {
      pageId: number
      parentId: number | null
      position: number
      /** 다른 스페이스로 옮길 때만(WP-988). */
      targetSpaceId?: number
    }) => wikiApi.movePage(pageId, parentId, position, targetSpaceId).then((r) => r.data),
    onSuccess: (_, { pageId, targetSpaceId }) => {
      if (targetSpaceId == null) {
        qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) })
        return
      }
      // 옮긴 서브트리 id 는 원본 트리를 다시 받기 전에(무효화 전에) 구한다.
      const moved = subtreeIds(qc.getQueryData<WikiPageSummary[]>(wikiKeys.tree(spaceId)) ?? [], pageId)
      qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) })
      // 스페이스를 넘은 이동(WP-988) — 캐시된 서브트리 상세의 spaceId 를 먼저 새 스페이스로 바꾼다. 낡은 상세가 남으면 새 주소로 간 화면이
      // 「옛 주소 → 새 주소」 연결(WikiPageView)을 거꾸로 타 옛 스페이스로 튀었다가 재조회 뒤 돌아온다(하위 페이지를 열 때도 같다).
      qc.setQueriesData<WikiPageDetail>({ queryKey: ['wiki', 'page'] }, (old) =>
        old && moved.has(old.id) ? { ...old, spaceId: targetSpaceId } : old,
      )
      // 두 스페이스의 트리·공유 중 목록, 옮긴 페이지들, 스페이스 목록(쪽수)을 다시 받는다.
      qc.invalidateQueries({ queryKey: wikiKeys.tree(targetSpaceId) })
      qc.invalidateQueries({ queryKey: wikiKeys.sharedPages(spaceId) })
      qc.invalidateQueries({ queryKey: wikiKeys.sharedPages(targetSpaceId) })
      qc.invalidateQueries({ queryKey: ['wiki', 'page'], predicate: (q) => moved.has(q.queryKey[2] as number) })
      qc.invalidateQueries({ queryKey: wikiKeys.spaces() })
    },
    // #758: 서버가 자기 자신/후손을 부모로 지정하는 이동을 400 으로 거부한다. 사이드바 DnD 는
    // 드래그 중인 노드의 후손을 드롭 대상에서 빼지 않으므로 사용자가 실제로 그 드롭을 할 수 있다 —
    // onError 가 없으면 트리가 조용히 제자리로 돌아가 "드래그가 먹히지 않는다" 로만 보인다.
    onError: (e) => handleApiError(e, '페이지를 이동할 수 없습니다'),
  })
}

/**
 * 다른 스페이스로 옮기기 미리보기(WP-988) — 대화상자에서 대상 스페이스를 골랐을 때만 부른다(targetSpaceId 가 null 이면 끔).
 * 옮기기 직전의 사실이라 캐시하지 않는다(gcTime 0).
 */
export function useWikiMovePreview(pageId: number | null, targetSpaceId: number | null) {
  return useQuery<WikiMovePreview>({
    queryKey: wikiKeys.movePreview(pageId ?? 0, targetSpaceId ?? 0),
    queryFn: () => wikiApi.getMovePreview(pageId as number, targetSpaceId as number).then((r) => r.data),
    enabled: pageId != null && targetSpaceId != null,
    gcTime: 0,
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

// 팀 노트 스페이스 삭제(WP-580). onDeleted(화면 이동)를 캐시 정리보다 먼저 부른다 — 지운 스페이스 화면에 머문 채 캐시를 지우면
// 사이드바가 "볼 수 없는 공간"으로 깜박이고 트리를 다시 받다 404 가 난다. 목록에서는 바로 빼 /wiki 리다이렉트가 지운 스페이스로
// 돌아가지 않게 한다(다시 받기는 실시간 wiki-space/deleted 알림이 한다 — resourceInvalidation).
export function useDeleteSpace({ onDeleted }: { onDeleted?: (spaceId: number) => void } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: wikiApi.deleteSpace,
    onSuccess: (_, spaceId) => {
      onDeleted?.(spaceId)
      qc.setQueryData<WikiSpace[]>(wikiKeys.spaces(), (prev) => prev?.filter((s) => s.id !== spaceId))
      qc.removeQueries({ queryKey: wikiKeys.tree(spaceId) })
    },
    onError: (e) => handleApiError(e, '스페이스를 삭제할 수 없습니다'),
  })
}

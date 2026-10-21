// WP-579 노트 페이지 공유 — 공유 설정·기록 조회와 만들기/바꾸기·재발급·해제.
// 바꾸고 나면 공유 표시가 보이는 곳(페이지 상세의 shared, 트리의 shared, 공유 중인 페이지 목록)을 함께 다시 받는다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiPageShare, WikiPageShareRequest, WikiPageShareState } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

/** 공유 창 상태(설정·외부 허용·상위 공유·접근 요청) — 공유 창이 열려 있을 때만 받는다(enabled). */
export function useWikiPageShare(pageId: number, enabled: boolean) {
  return useQuery<WikiPageShareState>({
    queryKey: wikiKeys.share(pageId),
    queryFn: () => wikiApi.getShare(pageId).then((r) => r.data),
    enabled,
  })
}

/** 공유 기록(최신순) — 공유 창의 「공유 기록」을 펼쳤을 때만 받는다. */
export function useWikiShareEvents(pageId: number, enabled: boolean) {
  return useQuery({
    queryKey: wikiKeys.shareEvents(pageId),
    queryFn: () => wikiApi.listShareEvents(pageId).then((r) => r.data),
    enabled,
  })
}

/** 스페이스에서 공유 중인 페이지 목록 — 목록 창이 열려 있을 때만 받는다. */
export function useWikiSharedPages(spaceId: number, enabled: boolean) {
  return useQuery({
    queryKey: wikiKeys.sharedPages(spaceId),
    queryFn: () => wikiApi.listSharedPages(spaceId).then((r) => r.data),
    enabled,
  })
}

/**
 * 공유 쓰기 묶음 — save(만들기·바꾸기)·regenerate(새 링크, 이전 링크는 바로 막힘)·revoke(해제).
 * 응답으로 설정 캐시를 바로 바꾸고, 공유 표시가 보이는 쿼리와 기록을 무효화한다.
 */
export function useWikiShareMutations(pageId: number, spaceId: number) {
  const qc = useQueryClient()
  const settle = (next: WikiPageShare | null) => {
    qc.setQueryData<WikiPageShareState>(wikiKeys.share(pageId), (prev) => (prev ? { ...prev, share: next } : prev))
    void qc.invalidateQueries({ queryKey: wikiKeys.shareEvents(pageId) })
    void qc.invalidateQueries({ queryKey: wikiKeys.page(pageId) })
    void qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) })
    void qc.invalidateQueries({ queryKey: wikiKeys.sharedPages(spaceId) })
  }
  // 저장이 거절되면(예: 창을 연 사이 관리자가 외부 공유를 끔 → 409) 창 상태를 다시 받아 선택지(외부 허용 여부 등)를 최신으로 맞춘다.
  const refetchState = () => void qc.invalidateQueries({ queryKey: wikiKeys.share(pageId) })
  const save = useMutation({
    mutationFn: (req: WikiPageShareRequest) => wikiApi.saveShare(pageId, req).then((r) => r.data),
    onSuccess: settle,
    onError: refetchState,
  })
  const regenerate = useMutation({
    mutationFn: () => wikiApi.regenerateShare(pageId).then((r) => r.data),
    onSuccess: settle,
  })
  const revoke = useMutation({
    mutationFn: () => wikiApi.deleteShare(pageId).then(() => null),
    onSuccess: settle,
  })
  // 접근 요청 승인·거절 — 승인하면 지정한 사람에 들어가므로 설정을 다시 받는다.
  const decide = useMutation({
    mutationFn: ({ requestId, approve }: { requestId: number; approve: boolean }) =>
      wikiApi.decideShareAccess(pageId, requestId, approve),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wikiKeys.share(pageId) })
      void qc.invalidateQueries({ queryKey: wikiKeys.shareEvents(pageId) })
      // 승인하면 지정한 사람이 늘어 공유 중인 페이지 목록의 인원 수가 바뀐다.
      void qc.invalidateQueries({ queryKey: wikiKeys.sharedPages(spaceId) })
    },
    // 이미 처리됐거나 권한이 바뀐 요청이면 실패한다 — 목록을 다시 받아 사라진 요청을 치운다.
    onError: refetchState,
  })
  return { save, regenerate, revoke, decide }
}

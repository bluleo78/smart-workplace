import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import { handleApiError } from '../../lib/api-error'
import type { WikiPageDetail, WikiRevisionDetail, WikiRevisionList } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

/**
 * 노트 버전 기록 목록(WP-282) — 패널을 열 때만 받는다(enabled). 열 때마다 새로 받는다(staleTime 0) —
 * 그사이 다른 사람 편집으로 새 판이 생겼을 수 있다.
 */
export function useWikiRevisions(pageId: number, { enabled }: { enabled: boolean }) {
  return useQuery<WikiRevisionList>({
    queryKey: wikiKeys.revisions(pageId),
    queryFn: () => wikiApi.listRevisions(pageId).then((r) => r.data),
    enabled,
    staleTime: 0,
  })
}

/** 한 판 본문(WP-282) — 스냅샷은 바뀌지 않으므로 한 번 받으면 다시 받지 않는다. version 이 null 이면 조회하지 않는다. */
export function useWikiRevision(pageId: number, version: number | null) {
  return useQuery<WikiRevisionDetail>({
    queryKey: wikiKeys.revision(pageId, version ?? 0),
    queryFn: () => wikiApi.getRevision(pageId, version as number).then((r) => r.data),
    enabled: version != null,
    staleTime: Infinity,
  })
}

/**
 * 판 복원(WP-282) — 서버가 지금 본문을 먼저 스냅샷으로 남기고 그 판 본문으로 바꾼다(본문만, 제목은 그대로).
 * 성공하면 목록만 무효화한다(새 스냅샷이 생겼다). 본문은 동기화 서버가 열린 에디터에 실시간으로 반영하므로 page 캐시는 건드리지 않는다.
 */
export function useRestoreWikiRevision(pageId: number) {
  const qc = useQueryClient()
  return useMutation<WikiPageDetail, unknown, number>({
    mutationFn: (version) => wikiApi.restoreRevision(pageId, version).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.revisions(pageId) }),
    onError: (e) => handleApiError(e, '복원하지 못했어요'),
  })
}

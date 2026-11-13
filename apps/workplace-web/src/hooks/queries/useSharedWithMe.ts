import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { hideSharedWithMe, listSharedWithMe } from '../../api/drive'
import type { SharedWithMeItem } from '../../types/drive'
import { driveKeys } from './driveKeys'

/**
 * 「공유받은 항목」 목록(WP-1539) — 사이드바 개수와 목록 화면이 같은 키를 공유한다.
 * 개수만 따로 세는 API 를 두지 않고 목록 길이를 쓴다(내가 연 링크 수라 작고, 화면을 열면 어차피 목록이 필요하다).
 */
export function useSharedWithMe() {
  return useQuery<SharedWithMeItem[]>({
    queryKey: driveKeys.sharedWithMe(),
    queryFn: listSharedWithMe,
    retry: false,
    // 드라이브 화면을 오갈 때마다(사이드바 다시 마운트) 다시 받지 않게 1분은 새것으로 본다.
    // 새 링크를 열거나 목록에서 빼면 무효화로 바로 다시 받는다.
    staleTime: 60_000,
  })
}

/** 「목록에서 빼기」 — 성공하면 목록(=사이드바 개수)을 다시 받는다. 링크 권한은 그대로다. */
export function useHideSharedWithMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (shareLinkId: number) => hideSharedWithMe(shareLinkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.sharedWithMe() }),
  })
}

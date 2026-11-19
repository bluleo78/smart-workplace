// 노트 「즐겨찾기」(WP-1765) 쿼리·뮤테이션 — 머리줄·트리 메뉴·최근 행의 별 단추와 「즐겨찾기」 목록이 같은 캐시를 본다.

import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { wikiApi } from '../../api/wiki'
import type { WikiStarredPage } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

/** id 목록 쿼리 옵션 — 받기 전·실패 시엔 빈 목록(별은 비어 보인다). 행마다 요청하지 않고 한 번 받은 목록을 공유한다. */
function starredIdsOptions() {
  return {
    queryKey: wikiKeys.starredIds(),
    queryFn: () => wikiApi.starredIds(),
    retry: false,
    refetchOnWindowFocus: false,
  }
}

/**
 * 이 페이지가 내 즐겨찾기인지 — select 로 불리언만 구독해, 별 상태가 바뀐 행만 다시 그려진다(행마다 Set 을 만들지 않는다).
 */
export function useIsWikiPageStarred(pageId: number): boolean {
  const { data } = useQuery({ ...starredIdsOptions(), select: (ids: number[]) => ids.includes(pageId) })
  return data ?? false
}

/**
 * 즐겨찾기한 페이지 id 집합(화면당 하나) — 「즐겨찾기」 목록이 별 뺀 행을 바로 숨기는 데 쓴다.
 * 아직 못 받았거나 실패했으면 null — 그때 목록을 다 걸러 버려 「즐겨찾기 없음」이 깜박이지 않게, 호출 쪽은 거르지 않는다.
 */
export function useWikiStarredIdSet(): Set<number> | null {
  const { data } = useQuery(starredIdsOptions())
  return useMemo(() => (data ? new Set(data) : null), [data])
}

/** 「즐겨찾기」 목록(즐겨찾기한 순, 50개씩 cursor) — useWikiRecent 와 같은 모양. */
export function useWikiStarred() {
  return useInfiniteQuery<WikiStarredPage>({
    queryKey: wikiKeys.starred(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => wikiApi.starred(pageParam as string | undefined),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}

/** 즐겨찾기 바꾸기 뮤테이션 키 — 진행 중인 바꾸기를 세어 마지막 하나가 끝날 때만 다시 받는다. */
const wikiStarMutationKey = ['wiki', 'star-toggle'] as const

/** id 목록 캐시에서 이 페이지만 넣거나(on) 뺀다 — 낙관 갱신과 실패 되돌림이 같이 쓴다. 다른 페이지의 낙관값은 건드리지 않는다. */
function setStarredId(queryClient: QueryClient, pageId: number, on: boolean) {
  queryClient.setQueryData<number[]>(wikiKeys.starredIds(), (old) => {
    const rest = (old ?? []).filter((id) => id !== pageId)
    return on ? [...rest, pageId] : rest
  })
}

/**
 * 즐겨찾기 넣기·빼기 — id 목록 캐시를 낙관적으로 먼저 바꿔 별이 바로 바뀌게 한다(「즐겨찾기」 목록은 이 id 로 행을 거른다).
 * 실패하면 이 페이지의 값만 되돌리고(겹친 다른 바꾸기의 낙관값을 지우지 않는다) 토스트로 알린다.
 * 끝나면(성공·실패) 진행 중인 즐겨찾기 바꾸기가 이것 하나일 때만 다시 받아, 대기 중인 바꾸기의 낙관값을 낡은 응답이 덮지 않게 한다.
 * toggle(pageId, starred) 의 starred 는 「바꾼 뒤 상태」(true = 넣기).
 */
export function useToggleWikiStar() {
  const queryClient = useQueryClient()
  const mutation = useMutation<void, Error, { pageId: number; starred: boolean }, { wasStarred: boolean }>({
    mutationKey: wikiStarMutationKey,
    // 같은 scope 의 변이는 TanStack 이 한 줄로 차례대로 실행한다 — 한 페이지를 빠르게 넣고 빼도 서버 요청이 눌린 순서대로 가
    // 마지막 상태가 이긴다. scope 는 훅 옵션이라 호출마다 바꿀 수 없어, 페이지별이 아닌 즐겨찾기 전체를 한 줄로 직렬화한다(요청이 가벼워 영향 없음).
    scope: { id: 'wiki-star' },
    mutationFn: ({ pageId, starred }) => (starred ? wikiApi.star(pageId) : wikiApi.unstar(pageId)),
    onMutate: async ({ pageId, starred }) => {
      // 진행 중 id 재조회가 낙관값을 덮지 않게 먼저 멈춘다(starredIds 는 starred 의 형제 키라 따로 멈춘다).
      await queryClient.cancelQueries({ queryKey: wikiKeys.starredIds() })
      const wasStarred = (queryClient.getQueryData<number[]>(wikiKeys.starredIds()) ?? []).includes(pageId)
      setStarredId(queryClient, pageId, starred)
      return { wasStarred }
    },
    onError: (_e, { pageId }, rollback) => {
      // 이 페이지 하나만 원래대로 — 집합 전체 사본으로 되돌리면 그 뒤의 다른 토글이 지워진다.
      if (rollback) setStarredId(queryClient, pageId, rollback.wasStarred)
      toast.error('즐겨찾기를 바꾸지 못했어요')
    },
    onSettled: (_data, error) => {
      // onSettled 동안 이 뮤테이션은 아직 진행 중으로 세어진다 — 1 이면 남은 것이 없다. 남았으면 마지막 것이 끝날 때 맞춘다.
      if (queryClient.isMutating({ mutationKey: wikiStarMutationKey }) !== 1) return
      // 목록은 항상 다시 받는다. id 목록은 실패했을 때만 — 성공이면 낙관값이 이미 맞다.
      void queryClient.invalidateQueries({ queryKey: wikiKeys.starred() })
      if (error) void queryClient.invalidateQueries({ queryKey: wikiKeys.starredIds() })
    },
  })
  // 소비자가 참조 안정성에 기대지 않는다(확인함) — 그대로 넘기는 래퍼만 둔다.
  return { toggle: (pageId: number, starred: boolean) => mutation.mutate({ pageId, starred }) }
}

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
 * 못 받았거나(받는 중) 실패했으면 null — 그때는 호출 쪽이 거르지 않는다.
 * 캐시는 서버 값만 담는다(받은 적 없을 때는 낙관 갱신을 하지 않으므로 방금 누른 페이지뿐인 캐시가 생기지 않는다).
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
 * 「서버에서 id 를 받은 적 없을 때 눌렀다 → 끝나면 id 를 다시 받아야 함」 표지 — QueryClient 단위.
 * 토글은 scope 하나로 직렬화돼 마지막에 끝나는 뮤테이션이 다른 훅 인스턴스일 수 있어 useRef 로는 공유되지 않는다.
 * 드라이브 useDriveStars.ts 의 pendingStarSync 와 같은 「QueryClient 단위 표지」 모양이다(들어 있으면 켜짐).
 */
const needsIdsRefetch = new WeakSet<QueryClient>()

/** onMutate 가 돌려주는 되돌림 정보 — 낙관값을 쓴 경우에만 만든다(안 썼으면 context 는 undefined). */
type ToggleContext = { wasStarred: boolean }

/**
 * 즐겨찾기 넣기·빼기 — id 목록이 서버 값일 때는 캐시를 낙관적으로 먼저 바꿔 별이 바로 바뀌게 한다(「즐겨찾기」 목록은 이 id 로 행을 거른다).
 * 서버에서 받은 적 없을 때(받는 중·실패)는 취소도 낙관 쓰기도 하지 않는다 — 빈 캐시에 [그 페이지] 만 남으면 다른 별이 비어 보이고
 * 목록이 다른 행을 걸러내며, cancelQueries 가 진행 중인 첫 받기를 되돌리기 때문이다. 대신 끝난 뒤 id 를 받아 서버 값으로 맞춘다.
 * 실패하면 낙관값을 쓴 경우에만 이 페이지의 값을 되돌리고(겹친 다른 바꾸기의 낙관값을 지우지 않는다) 토스트로 알린다.
 * 끝나면(성공·실패 모두) 진행 중인 즐겨찾기 바꾸기가 이것 하나일 때만 목록을 다시 받고, id 목록은 실패했거나 위 표지가 켜졌을 때만 다시 받는다.
 * toggle(pageId, starred) 의 starred 는 「바꾼 뒤 상태」(true = 넣기).
 */
export function useToggleWikiStar() {
  const queryClient = useQueryClient()
  const mutation = useMutation<void, Error, { pageId: number; starred: boolean }, ToggleContext | undefined>({
    mutationKey: wikiStarMutationKey,
    // 같은 scope 의 변이는 TanStack 이 한 줄로 차례대로 실행한다 — 한 페이지를 빠르게 넣고 빼도 서버 요청이 눌린 순서대로 가
    // 마지막 상태가 이긴다. scope 는 훅 옵션이라 호출마다 바꿀 수 없어, 페이지별이 아닌 즐겨찾기 전체를 한 줄로 직렬화한다(요청이 가벼워 영향 없음).
    scope: { id: 'wiki-star' },
    mutationFn: ({ pageId, starred }) => (starred ? wikiApi.star(pageId) : wikiApi.unstar(pageId)),
    onMutate: async ({ pageId, starred }) => {
      if (queryClient.getQueryState(wikiKeys.starredIds())?.status !== 'success') {
        // 서버 값이 없다 — 쓰지 않고, 끝난 뒤 다시 받도록 표지만 켠다.
        needsIdsRefetch.add(queryClient)
        return undefined
      }
      // 진행 중 id 재조회가 낙관값을 덮지 않게 먼저 멈춘다(starredIds 는 starred 의 형제 키라 따로 멈춘다).
      await queryClient.cancelQueries({ queryKey: wikiKeys.starredIds() })
      const wasStarred = (queryClient.getQueryData<number[]>(wikiKeys.starredIds()) ?? []).includes(pageId)
      setStarredId(queryClient, pageId, starred)
      return { wasStarred }
    },
    onError: (_e, { pageId }, rollback) => {
      // 이 페이지 하나만 원래대로 — 집합 전체 사본으로 되돌리면 그 뒤의 다른 토글이 지워진다. 쓰지 않았으면 되돌릴 것이 없다.
      if (rollback) setStarredId(queryClient, pageId, rollback.wasStarred)
      toast.error('즐겨찾기를 바꾸지 못했어요')
    },
    onSettled: (_data, error) => {
      // onSettled 동안 이 뮤테이션은 아직 진행 중으로 세어진다 — 1 이면 남은 것이 없다. 남았으면 마지막 것이 끝날 때 맞춘다.
      if (queryClient.isMutating({ mutationKey: wikiStarMutationKey }) !== 1) return
      void queryClient.invalidateQueries({ queryKey: wikiKeys.starred() })
      // id 목록은 캐시가 서버 값이고 성공했으면 다시 받지 않는다 — 실패했거나 받은 적 없이 눌렀을 때만.
      if (error || needsIdsRefetch.has(queryClient)) {
        needsIdsRefetch.delete(queryClient)
        // 받는 중이던 첫 받기는 바꾸기 전 서버 값일 수 있어 먼저 멈춘다 — 데이터가 없으면 invalidate 의 cancelRefetch 가 적용되지 않아
        // 진행 중 요청에 합쳐져 옛 서버 값이 그대로 쓰인다. 이 시점엔 지킬 낙관값이 없어 취소해도 안전하다.
        void queryClient
          .cancelQueries({ queryKey: wikiKeys.starredIds() })
          .then(() => queryClient.invalidateQueries({ queryKey: wikiKeys.starredIds() }))
      }
    },
  })
  // 소비자가 참조 안정성에 기대지 않는다(확인함) — 그대로 넘기는 래퍼만 둔다.
  return { toggle: (pageId: number, starred: boolean) => mutation.mutate({ pageId, starred }) }
}

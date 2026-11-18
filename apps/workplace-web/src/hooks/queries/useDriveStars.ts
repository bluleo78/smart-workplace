// 드라이브 「별표」(WP-1698) 쿼리·뮤테이션 — 「별표」 목록 화면, 공간 화면 행 메뉴, 보기 창 별표 단추가 같은 캐시를 본다.
import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { listStarredDriveItems, starDriveItem, unstarDriveItem } from '../../api/drive'
import type { DriveItemList, DriveStarredItem, DriveStarredPage, DriveStarTarget } from '../../types/drive'
import { driveKeys } from './driveKeys'

/** 「별표」 목록(별표한 순, 커서로 이어 받기) — 한 페이지 50개, nextCursor 가 없으면 끝. */
export function useStarredDriveItems() {
  return useInfiniteQuery({
    queryKey: driveKeys.starred(),
    queryFn: ({ pageParam }) => listStarredDriveItems(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: DriveStarredPage) => last.nextCursor ?? undefined,
    retry: false,
  })
}

/**
 * 별표 바꾸기 뮤테이션 키 — 화면(공간 화면·「별표」 목록)이 각자 훅을 써도 진행 중인 별표 바꾸기를 함께 센다.
 * 마지막 하나가 끝날 때만 다시 받아, 다른 바꾸기가 아직 도는 동안 서버 옛 상태가 낙관값을 덮지(행이 깜빡 돌아오지) 않게 한다.
 */
const driveStarMutationKey = ['drive', 'star-toggle'] as const

/**
 * 진행 중인 별표 바꾸기들이 끝난 뒤 맞출 것 — 바꾸기가 닿은 공간 id 와 「별표」 목록을 다시 받아야 하는지.
 * 마지막 바꾸기가 끝날 때 이것만 무효화한다(모든 공간의 폴더 목록을 통째로 다시 받지 않는다). 화면마다 훅이 따로 있어도 진행 중 수는
 * QueryClient 하나에서 세므로 모음도 QueryClient 마다 하나 둔다(테스트처럼 클라이언트가 여럿이어도 섞이지 않는다).
 */
interface PendingStarSync {
  spaceIds: Set<number>
  refetchStarred: boolean
}
const pendingStarSync = new WeakMap<QueryClient, PendingStarSync>()

function pendingFor(queryClient: QueryClient): PendingStarSync {
  let pending = pendingStarSync.get(queryClient)
  if (!pending) {
    pending = { spaceIds: new Set(), refetchStarred: false }
    pendingStarSync.set(queryClient, pending)
  }
  return pending
}

/** 별표 바꾸기 입력 — 대상, 그 항목이 있는 공간(그 공간 폴더 목록을 함께 고친다), 바꾼 뒤 상태(true = 넣기). */
export interface ToggleDriveStarInput {
  target: DriveStarTarget
  spaceId: number
  starred: boolean
}

/**
 * 실패하면 되돌릴 이 항목 하나의 바꾸기 전 값 — 캐시 전체 사본이 아니라 이 항목만 들고 있어, 겹친 다른 바꾸기의 낙관값을 지우지 않는다.
 * prevStarred: 공간 폴더 목록에서 본 바꾸기 전 별표(목록에 없었으면 undefined). removed: 「별표」 목록에서 뺀 행과 그 자리(빼기일 때만).
 */
interface StarRollback {
  prevStarred: boolean | undefined
  removed: { pageIndex: number; index: number; item: DriveStarredItem } | null
}

/** 같은 대상인가 — 파일·폴더 id 는 서로 다른 표라 종류까지 본다. */
function sameTarget(item: DriveStarredItem, target: DriveStarTarget): boolean {
  return item.kind === target.kind && item.id === target.id
}

/** 폴더 목록 한 벌에서 대상 행을 찾는다(없으면 undefined). */
function findItem(list: DriveItemList, target: DriveStarTarget): { starred?: boolean } | undefined {
  return target.kind === 'FOLDER' ? list.folders.find((f) => f.id === target.id) : list.files.find((f) => f.id === target.id)
}

/** 폴더 목록 한 벌에서 대상 행의 starred 를 바꾼 사본(대상이 없으면 그대로). */
function withItemStar(list: DriveItemList, target: DriveStarTarget, starred: boolean): DriveItemList {
  if (target.kind === 'FOLDER') {
    if (!list.folders.some((f) => f.id === target.id)) return list
    return { ...list, folders: list.folders.map((f) => (f.id === target.id ? { ...f, starred } : f)) }
  }
  if (!list.files.some((f) => f.id === target.id)) return list
  return { ...list, files: list.files.map((f) => (f.id === target.id ? { ...f, starred } : f)) }
}

/** 「별표」 목록에서 대상 행이 있는 자리(페이지·순번) — 없으면 null. 실패 때 그 자리에 되돌려 넣으려고 뺄 때 기억한다. */
function locateStarred(
  data: InfiniteData<DriveStarredPage>,
  target: DriveStarTarget,
): StarRollback['removed'] {
  for (let pageIndex = 0; pageIndex < data.pages.length; pageIndex++) {
    const index = data.pages[pageIndex].items.findIndex((it) => sameTarget(it, target))
    if (index >= 0) return { pageIndex, index, item: data.pages[pageIndex].items[index] }
  }
  return null
}

/** 「별표」 목록에서 대상 행을 뺀 사본 — 별표를 빼면 목록에서 바로 사라지게(서버 재조회 전). */
function withoutStarred(data: InfiniteData<DriveStarredPage>, target: DriveStarTarget): InfiniteData<DriveStarredPage> {
  return {
    ...data,
    pages: data.pages.map((p) => ({ ...p, items: p.items.filter((it) => !sameTarget(it, target)) })),
  }
}

/** 실패한 빼기를 되돌린다 — 뺀 행을 원래 자리에 다시 넣는다(그 사이 목록이 줄었으면 그 페이지 끝, 이미 있으면 그대로). */
function withRestoredStarred(
  data: InfiniteData<DriveStarredPage>,
  removed: NonNullable<StarRollback['removed']>,
): InfiniteData<DriveStarredPage> {
  if (data.pages.some((p) => p.items.some((it) => sameTarget(it, removed.item)))) return data
  const pageIndex = Math.min(removed.pageIndex, data.pages.length - 1)
  if (pageIndex < 0) return data
  return {
    ...data,
    pages: data.pages.map((p, i) => {
      if (i !== pageIndex) return p
      const items = [...p.items]
      items.splice(Math.min(removed.index, items.length), 0, removed.item)
      return { ...p, items }
    }),
  }
}

/**
 * 별표 넣기·빼기 — 화면이 바로 바뀌도록 낙관적으로 캐시를 고친다(공간 폴더 목록 행의 starred, 빼기면 「별표」 목록에서 그 행을 뺀다).
 * 실패하면 이 항목의 바꾼 값만 되돌린다(캐시 통째 사본으로 되돌리면 겹친 다른 바꾸기의 낙관값까지 지워진다).
 * 끝나면(성공·실패) 진행 중인 별표 바꾸기가 이것 하나일 때만 그동안 닿은 공간의 폴더 목록을 다시 받아 서버 상태와 맞춘다.
 * 「별표」 목록은 넣기(새 행 내용이 클라이언트에 없다)나 실패가 있었을 때만 다시 받는다 — 성공한 빼기는 낙관적으로 뺀 결과가 이미 맞다.
 * 토스트(「별표 뺌」·되돌리기·오류)는 부르는 쪽이 mutateAsync 결과로 정한다 — 화면마다 문구가 다르고, mutate 의 호출별 콜백은
 * 마지막 호출에만 불려 연달아 누르면 앞선 토스트가 빠진다.
 */
export function useToggleDriveStar() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, ToggleDriveStarInput, StarRollback>({
    mutationKey: driveStarMutationKey,
    mutationFn: ({ target, starred }) => (starred ? starDriveItem(target) : unstarDriveItem(target)),
    onMutate: async ({ target, spaceId, starred }) => {
      // 진행 중 재조회가 낙관값을 덮지 않게 먼저 멈춘다.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: driveKeys.itemsAll(spaceId) }),
        queryClient.cancelQueries({ queryKey: driveKeys.starred() }),
      ])
      let prevStarred: boolean | undefined
      for (const [, list] of queryClient.getQueriesData<DriveItemList>({ queryKey: driveKeys.itemsAll(spaceId) })) {
        const found = list ? findItem(list, target) : undefined
        if (found) {
          prevStarred = found.starred === true
          break
        }
      }
      queryClient.setQueriesData<DriveItemList>({ queryKey: driveKeys.itemsAll(spaceId) }, (old) =>
        old ? withItemStar(old, target, starred) : old,
      )
      let removed: StarRollback['removed'] = null
      if (!starred) {
        const list = queryClient.getQueryData<InfiniteData<DriveStarredPage>>(driveKeys.starred())
        removed = list ? locateStarred(list, target) : null
        if (removed) queryClient.setQueryData(driveKeys.starred(), withoutStarred(list!, target))
      }
      return { prevStarred, removed }
    },
    onError: (_e, { target, spaceId }, rollback) => {
      if (!rollback) return
      const { prevStarred, removed } = rollback
      if (prevStarred !== undefined) {
        queryClient.setQueriesData<DriveItemList>({ queryKey: driveKeys.itemsAll(spaceId) }, (old) =>
          old ? withItemStar(old, target, prevStarred) : old,
        )
      }
      if (removed) {
        queryClient.setQueryData<InfiniteData<DriveStarredPage>>(driveKeys.starred(), (old) =>
          old ? withRestoredStarred(old, removed) : old,
        )
      }
    },
    onSettled: (_data, error, { spaceId, starred }) => {
      const pending = pendingFor(queryClient)
      pending.spaceIds.add(spaceId)
      if (error || starred) pending.refetchStarred = true
      // onSettled 동안 이 뮤테이션은 아직 진행 중으로 세어진다 — 1 이면 남은 것이 없다.
      if (queryClient.isMutating({ mutationKey: driveStarMutationKey }) !== 1) return
      // 겹친 바꾸기가 다른 공간에서 왔을 수 있어 그동안 닿은 공간마다 폴더 목록을 맞춘다(지금 보이는 목록만 실제로 다시 받는다).
      // 기다리지 않는다 — 부르는 쪽 토스트가 재조회 끝까지 늦어지지 않게.
      if (pending.refetchStarred) void queryClient.invalidateQueries({ queryKey: driveKeys.starred() })
      for (const id of pending.spaceIds) void queryClient.invalidateQueries({ queryKey: driveKeys.itemsAll(id) })
      pendingStarSync.delete(queryClient)
    },
  })
}

/**
 * 별표 넣기·빼기를 부르고 실패를 알린다 — 실패 토스트를 화면마다 두지 않게 한 곳에 둔다. 성공하면 true, 실패하면(캐시는 훅이 되돌린 뒤) false.
 * 화면은 결과로 자기 몫(「별표 뺌」 토스트·보기 창 값 되돌리기)만 더한다. 호출마다 mutateAsync 결과를 기다린다 — mutate 의 호출별
 * 콜백은 공유 뮤테이션의 마지막 호출에만 불려 연달아 누르면 앞 실패를 놓친다.
 */
export function useSetDriveStar(): (input: ToggleDriveStarInput) => Promise<boolean> {
  const { mutateAsync } = useToggleDriveStar()
  return useCallback(
    async (input: ToggleDriveStarInput) => {
      try {
        await mutateAsync(input)
        return true
      } catch {
        toast.error(input.starred ? '별표하지 못했습니다. 잠시 후 다시 시도하세요.' : '별표를 빼지 못했습니다. 잠시 후 다시 시도하세요.')
        return false
      }
    },
    [mutateAsync],
  )
}

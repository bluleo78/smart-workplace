// 프로젝트 즐겨찾기 — 서버에 사용자·워크스페이스별로 저장한다(WP-1001).
// 예전엔 브라우저 localStorage 에만 있어(WP-701 키) 브라우저가 저장소를 지우거나, 다른 창의 옛 값에 토글 하나를 더해 통째로 덮어쓰거나,
// 기기를 바꾸면 비거나 달라졌다. 이제 추가·해제는 key 하나씩 보내는 멱등 요청이라 다른 창의 옛 값이 앞서 한 즐겨찾기를 지우지 않는다.
// 사이드바·목록 등 여러 컴포넌트가 같은 쿼리 캐시를 구독하므로 토글이 바로 함께 보인다.
import { useMutation,useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { projectsApi } from '@/api/projects'
import { useAuth } from '@/hooks/useAuth'
import { handleApiError } from '@/lib/api-error'
import { userScopedKey } from '@/lib/userScopedKey'

/** 예전 localStorage 키의 앞부분 — `project-favorites:<userId>:<tenantId>`(WP-701). 이관에만 쓴다. */
const LEGACY_BASE = 'project-favorites'
const EMPTY: ReadonlySet<string> = new Set()
const TOGGLE_MUTATION_KEY = ['project-favorites', 'toggle'] as const

export const projectFavoriteKeys = {
  list: (userId: number, tenantId: number | null) => ['project-favorites', userId, tenantId] as const,
}

/** 이 기기에 남은 예전 즐겨찾기 — 키가 없으면 null(이관할 것 없음), 깨진 값은 빈 목록. */
function readLegacy(storageKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string' && k !== '') : []
  } catch {
    return []
  }
}

function removeLegacy(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // 저장소에 닿지 못함(프라이빗 모드 등) — 다음 조회에서 다시 본다.
  }
}

/**
 * 서버 목록을 읽고, 이 기기에 예전 localStorage 값이 남아 있으면 한 번 합쳐 올린 뒤 로컬 키를 지운다.
 * - 서버가 비어 있을 때만 올리면, 다른 브라우저가 먼저 올린 뒤 이 브라우저에만 있던 즐겨찾기가 사라진다 — 그래서 늘 합친다.
 *   서버가 없는·볼 수 없는 key 는 건너뛰고, 이미 있는 key 는 그대로다.
 * - 올린 뒤 로컬 키를 지워 기기마다 한 번만 합친다(남겨 두면 나중에 해제한 즐겨찾기가 다시 살아난다).
 * - 올리기가 실패하면 로컬 키를 남겨 다음 조회에서 다시 시도한다.
 */
export async function loadProjectFavorites(legacyKey: string): Promise<string[]> {
  const keys = await projectsApi.listFavorites()
  const legacy = readLegacy(legacyKey)
  if (legacy == null) return keys
  const missing = legacy.filter((k) => !keys.includes(k))
  if (missing.length === 0) {
    removeLegacy(legacyKey)
    return keys
  }
  const merged = await projectsApi.importFavorites(missing)
  removeLegacy(legacyKey)
  return merged
}

interface ToggleVars {
  key: string
  add: boolean
}

export function useProjectFavorites() {
  const { user, activeTenant } = useAuth()
  const qc = useQueryClient()
  const userId = user?.id ?? null
  const tenantId = activeTenant?.tenantId ?? null
  // 로그인 전(사용자 없음)에는 조회하지 않고 빈 집합 — 누구의 즐겨찾기도 보이지 않는다.
  const queryKey = useMemo(() => (userId != null ? projectFavoriteKeys.list(userId, tenantId) : null), [userId, tenantId])

  const { data } = useQuery({
    queryKey: queryKey ?? ['project-favorites', 'anonymous'],
    queryFn: () => loadProjectFavorites(userScopedKey(LEGACY_BASE, { userId: userId!, tenantId })),
    enabled: queryKey != null,
  })
  const favs = useMemo<Set<string>>(() => (queryKey != null && data ? new Set(data) : (EMPTY as Set<string>)), [queryKey, data])

  // 같은 scope 는 차례로 보낸다 — 빠른 연타의 추가·해제가 네트워크에서 서로 추월해 마지막 의도와 다르게 저장되는 일을 막는다.
  const mutation = useMutation<unknown, unknown, ToggleVars>({
    mutationKey: TOGGLE_MUTATION_KEY,
    scope: { id: 'project-favorites' },
    onMutate: async ({ key, add }) => {
      if (queryKey == null) return
      await qc.cancelQueries({ queryKey })
      qc.setQueryData<string[]>(queryKey, (old) =>
        old == null ? old : add ? [...old.filter((k) => k !== key), key] : old.filter((k) => k !== key),
      )
    },
    mutationFn: ({ key, add }) => (add ? projectsApi.addFavorite(key) : projectsApi.removeFavorite(key)),
    onError: (err) => {
      handleApiError(err, '즐겨찾기를 저장하지 못했습니다')
      // 실패한 낙관 반영이 남지 않게 늘 서버 상태로 맞춘다(뒤 토글이 있어도 — 그 토글은 끝날 때 다시 맞춘다).
      if (queryKey != null) return qc.invalidateQueries({ queryKey })
    },
    onSettled: (_data, err) => {
      // 성공한 토글은 진행 중인 마지막 토글일 때만 맞춘다 — 앞선 토글의 재조회가 뒤 토글의 낙관 상태를 되돌리지 않게.
      if (!err && queryKey != null && qc.isMutating({ mutationKey: TOGGLE_MUTATION_KEY }) === 1) {
        return qc.invalidateQueries({ queryKey })
      }
    },
  })

  const { mutate } = mutation
  const toggle = useCallback(
    (key: string) => {
      if (queryKey == null) return
      // 첫 조회(이관 포함)가 끝나기 전에는 무엇이 즐겨찾기인지 몰라 추가·해제를 정할 수 없다 — 누르기를 무시한다.
      const current = qc.getQueryData<string[]>(queryKey)
      if (current == null) return
      // 지금 캐시(서버 상태 + 앞선 낙관 반영) 기준으로 추가·해제를 정한다.
      mutate({ key, add: !current.includes(key) })
    },
    [qc, mutate, queryKey],
  )

  return { favs, isFav: (k: string) => favs.has(k), toggle }
}

// 프로젝트 즐겨찾기 — 기기 로컬(localStorage). 기기 간 동기화는 YAGNI(추후 백엔드).
// 사이드바·목록 등 여러 컴포넌트가 동시에 구독하므로 useSyncExternalStore 로
// 토글 즉시 전파한다(같은 탭=리스너 알림, 다른 탭=storage 이벤트).
// 키는 사용자·워크스페이스별이다(WP-701) — 같은 브라우저의 다음 사용자에게 앞 사용자의 즐겨찾기가 보이지 않게.
import { useCallback, useSyncExternalStore } from 'react'

import { useAuth } from '@/hooks/useAuth'
import { userScopedKey } from '@/lib/userScopedKey'

const STORAGE_BASE = 'project-favorites'
const EMPTY: ReadonlySet<string> = new Set()

// 구독자 + 키별 스냅샷 캐시 — getSnapshot 이 변경 전까지 동일 참조를 반환해야 무한 렌더를 피한다.
const listeners = new Set<() => void>()
const cache = new Map<string, Set<string>>()

function read(storageKey: string): Set<string> {
  const hit = cache.get(storageKey)
  if (hit) return hit
  let value: Set<string>
  try {
    value = new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[])
  } catch {
    value = new Set()
  }
  cache.set(storageKey, value)
  return value
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // 다른 탭/창에서의 변경 반영(같은 탭 변경은 storage 이벤트가 안 뜨므로 listeners 로 처리).
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(STORAGE_BASE)) {
      cache.delete(e.key)
      cb()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function toggleFavorite(storageKey: string, key: string): void {
  const next = new Set(read(storageKey))
  if (next.has(key)) next.delete(key)
  else next.add(key)
  try {
    localStorage.setItem(storageKey, JSON.stringify([...next]))
  } catch {
    // 저장 불가(프라이빗 모드 등) — 이 탭에서만 반영.
  }
  cache.set(storageKey, next) // 새 참조 → 구독자 재렌더
  listeners.forEach((l) => l())
}

export function useProjectFavorites() {
  const { user, activeTenant } = useAuth()
  // 로그인 전(사용자 없음)에는 빈 집합 — 누구의 즐겨찾기도 보이지 않는다.
  const storageKey = user ? userScopedKey(STORAGE_BASE, { userId: user.id, tenantId: activeTenant?.tenantId ?? null }) : null
  const favs = useSyncExternalStore(
    subscribe,
    () => (storageKey ? read(storageKey) : (EMPTY as Set<string>)),
    () => EMPTY as Set<string>, // SSR/hydration 폴백(SPA 라 실질 미사용)
  )
  const toggle = useCallback((key: string) => {
    if (storageKey) toggleFavorite(storageKey, key)
  }, [storageKey])
  return { favs, isFav: (k: string) => favs.has(k), toggle }
}

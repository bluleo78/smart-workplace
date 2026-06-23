// 프로젝트 즐겨찾기 — 기기 로컬(localStorage). 기기 간 동기화는 YAGNI(추후 백엔드).
// 사이드바·목록 등 여러 컴포넌트가 동시에 구독하므로 useSyncExternalStore 로
// 토글 즉시 전파한다(같은 탭=리스너 알림, 다른 탭=storage 이벤트).
import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'project-favorites'
const EMPTY: ReadonlySet<string> = new Set()

// 구독자 + 스냅샷 캐시 — getSnapshot 이 변경 전까지 동일 참조를 반환해야 무한 렌더를 피한다.
const listeners = new Set<() => void>()
let cache: Set<string> | null = null

function read(): Set<string> {
  if (cache) return cache
  try {
    cache = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[])
  } catch {
    cache = new Set()
  }
  return cache
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // 다른 탭/창에서의 변경 반영(같은 탭 변경은 storage 이벤트가 안 뜨므로 listeners 로 처리).
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null
      cb()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function toggleFavorite(key: string): void {
  const next = new Set(read())
  if (next.has(key)) next.delete(key)
  else next.add(key)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  cache = next // 새 참조 → 구독자 재렌더
  listeners.forEach((l) => l())
}

export function useProjectFavorites() {
  const favs = useSyncExternalStore(
    subscribe,
    read,
    () => EMPTY as Set<string>, // SSR/hydration 폴백(SPA 라 실질 미사용)
  )
  const toggle = useCallback((key: string) => toggleFavorite(key), [])
  return { favs, isFav: (k: string) => favs.has(k), toggle }
}

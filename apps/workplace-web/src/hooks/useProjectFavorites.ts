// 프로젝트 즐겨찾기 — 기기 로컬(localStorage). 기기 간 동기화는 YAGNI(추후 백엔드).
import { useCallback, useState } from 'react'

const STORAGE_KEY = 'project-favorites'

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function useProjectFavorites() {
  const [favs, setFavs] = useState<Set<string>>(load)
  const toggle = useCallback((key: string) => {
    setFavs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])
  return { favs, isFav: (k: string) => favs.has(k), toggle }
}

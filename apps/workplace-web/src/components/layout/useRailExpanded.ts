// src/components/layout/useRailExpanded.ts
// 앱 레일 확장(아이콘+라벨) 상태를 localStorage 에 영속하는 훅.
// 데스크톱(lg) 전용 개념 — 모바일 드로어는 이 값을 무시하고 항상 라벨을 노출한다.
import { useCallback, useState } from 'react'

const STORAGE_KEY = 'app-rail-expanded'

export function useRailExpanded(): { expanded: boolean; toggle: () => void } {
  // 초기값을 동기로 읽어 첫 페인트 깜빡임 방지. 접근 실패 시 축소(false) 폴백.
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  // 토글 시 메모리 상태와 localStorage 를 함께 갱신(스토리지 실패는 무시).
  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // 스토리지 접근 실패 시 메모리 상태만 갱신.
      }
      return next
    })
  }, [])

  return { expanded, toggle }
}

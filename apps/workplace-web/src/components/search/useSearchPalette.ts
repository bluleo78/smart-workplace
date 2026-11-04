// 통합 검색 팔레트(WP-1353)의 열림 상태와 「/」 단축키 — 트리거 버튼과 팔레트가 같은 상태를 보게 한다.
// 열림은 컴포넌트 상태일 뿐 히스토리에 넣지 않는다(뒤로 가기가 팔레트를 닫는 데 쓰이지 않게).
import { useEffect, useState } from 'react'

import { isSearchShortcut } from './searchRules'

/** 팔레트 열림 상태 + window 「/」 단축키(입력 중·오버레이 열림 중이면 isSearchShortcut 이 걸러 연다). */
export function useSearchPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { open, setOpen }
}

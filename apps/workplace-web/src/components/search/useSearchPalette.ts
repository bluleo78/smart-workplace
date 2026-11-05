// 통합 검색 팔레트(WP-1353)의 열림 상태와 「/」 단축키 — 트리거 버튼과 팔레트가 같은 상태를 보게 한다.
// 열림 상태는 모듈 스토어(searchPaletteStore)에 있어 다른 화면이 openSearchPalette({ q, app }) 으로 검색어·탭을 정해 열 수 있다(WP-1356).
// 열림은 히스토리에 넣지 않는다(뒤로 가기가 팔레트를 닫는 데 쓰이지 않게).
import { useEffect, useSyncExternalStore } from 'react'

import { closeSearchPalette, openSearchPalette, searchPaletteSession, subscribeSearchPalette } from './searchPaletteStore'
import { isSearchShortcut } from './searchRules'

/** 지금 열린 팔레트 세션(닫혀 있으면 null) + 팔레트를 그리는 쪽이 내려갈 때 닫기.
 *  그리는 쪽(트리거·모바일 호스트)이 내려가면 열림이 스토어에 남지 않게 닫는다 — 다시 그려질 때 저절로 열린 채 나오지 않게. */
export function useSearchPaletteSession() {
  const session = useSyncExternalStore(subscribeSearchPalette, searchPaletteSession, searchPaletteSession)
  useEffect(() => () => closeSearchPalette(), [])
  return session
}

/** 팔레트 열림 상태 + window 「/」 단축키(입력 중·오버레이 열림 중이면 isSearchShortcut 이 걸러 연다). */
export function useSearchPalette() {
  const session = useSearchPaletteSession()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return
      e.preventDefault()
      openSearchPalette()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setOpen = (next: boolean) => {
    if (!next) closeSearchPalette()
    // 이미 열려 있으면 그대로 둔다 — 새 세션을 만들면 본문이 다시 마운트돼 입력이 지워진다.
    else if (searchPaletteSession() == null) openSearchPalette()
  }

  return { open: session != null, setOpen, session }
}

// 휴대폰 셸에서 통합 검색을 전체 화면으로 그리는 유일한 호스트(WP-1356 → WP-1354).
// 데스크톱은 SearchTrigger 가 버튼과 팔레트를 함께 그린다. 휴대폰은 탭 첫 화면 헤더의 🔍(MobileSearchButton)와
// 다른 화면(예: 드라이브 「드라이브 전체에서 찾기」)이 openSearchPalette({ q, app }) 로 스토어만 열고, 그리는 곳은 여기 하나다.
// 「/」 단축키는 걸지 않는다(트리거 쪽 몫). 데스크톱과 같은 스토어를 보므로 두 셸에서 동시에 그리지 않는다(AppLayout 이 하나만 둔다).
//
// 뒤로 가기 = 검색만 닫기 — 열 때 같은 주소의 히스토리 항목 하나를 넣고(useSheetHistory), 「취소」·Esc 로 닫으면 그 항목을 걷어 낸다.
// 결과로 이동할 때는 팔레트가 그 항목을 대체하므로(SearchPalette.pick) 이동한 화면에서 뒤로 가면 검색 전 화면이다.
import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { useSheetHistory } from '@/hooks/useSheetHistory'
import { hasLiveStateMark } from '@/lib/historyParam'

import { SearchPalette } from './SearchPalette'
import { closeSearchPalette, SEARCH_PALETTE_HISTORY_KEY } from './searchPaletteStore'
import { useSearchPaletteSession } from './useSearchPalette'

/** 닫을 때 할 일이 없는 검색은 뒤로 가기에 확인을 띄우지 않는다(hasContent=false) — 이 콜백은 불리지 않는다. */
const noop = () => {}

export function SearchPaletteHost() {
  const session = useSearchPaletteSession()
  const open = session != null
  useSheetHistory({ historyKey: SEARCH_PALETTE_HISTORY_KEY, open, hasContent: false, onClose: closeSearchPalette, onBlockedBack: noop })

  // 닫힌 뒤 할 일(「AI에게 검색 요청하기」의 AI 시트 열기) — 걷어 내기(history.back)가 끝나 위치가 바뀐 뒤에 실행한다.
  // 위치 갱신과 같은 커밋에서 AI 쪽 상태(지금 위치·표식)가 먼저 맞춰진 다음이라 AI 시트가 자기 항목을 제자리에 넣는다.
  const pending = useRef<(() => void) | null>(null)
  const { key } = useLocation()
  useEffect(() => {
    if (!pending.current || hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY)) return
    const fn = pending.current
    pending.current = null
    fn()
  }, [key])
  const afterClose = useCallback((fn: () => void) => {
    // 걷어 낼 항목이 없으면(새로고침 뒤 등) 기다릴 위치 변화도 없으니 바로 한다.
    if (hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY)) pending.current = fn
    else fn()
  }, [])

  return (
    <SearchPalette
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSearchPalette()
      }}
      session={session}
      afterClose={afterClose}
    />
  )
}

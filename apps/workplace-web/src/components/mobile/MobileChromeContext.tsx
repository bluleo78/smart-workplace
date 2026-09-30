// 모바일 셸 크롬(탭바) 상태 공유 — 페이지가 "로컬 상세 상태"(메일 본문 열림 등)일 때 탭바를 숨기고,
// 탭 편집 화면이 바꾼 구성을 탭바에 즉시 반영하기 위한 컨텍스트.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { loadTabSlots, saveTabSlots } from '@/lib/mobile/tabConfig'
import type { MobileTabId } from '@/lib/mobile/tabs'

interface MobileChromeValue {
  tabBarHidden: boolean
  setHideCount: (fn: (n: number) => number) => void
  slots: MobileTabId[]
  setSlots: (s: MobileTabId[]) => void
}

const Ctx = createContext<MobileChromeValue | null>(null)

/** 모바일 크롬 상태 Provider — 탭바 숨김 카운트와 탭 슬롯 구성을 보관한다. */
export function MobileChromeProvider({ children }: { children: ReactNode }) {
  // 숨김 요청 수(중첩 컴포넌트가 동시에 요청해도 마지막 해제 때만 다시 보이게 카운트).
  const [hideCount, setHideCount] = useState(0)
  const [slots, setSlotsState] = useState<MobileTabId[]>(loadTabSlots)
  const setSlots = useCallback((s: MobileTabId[]) => {
    saveTabSlots(s)
    setSlotsState(s)
  }, [])
  const value = useMemo(
    () => ({ tabBarHidden: hideCount > 0, setHideCount, slots, setSlots }),
    [hideCount, slots, setSlots],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 셸 밖(데스크톱)에서도 안전하게 호출되도록 null 허용. */
// eslint-disable-next-line react-refresh/only-export-components
export function useMobileChrome() {
  return useContext(Ctx)
}

/** hidden=true 인 동안 탭바를 숨긴다. 데스크톱(Provider 없음)에선 아무 일도 하지 않는다. */
// eslint-disable-next-line react-refresh/only-export-components
export function useHideTabBar(hidden: boolean) {
  const ctx = useContext(Ctx)
  const setHideCount = ctx?.setHideCount
  useEffect(() => {
    if (!hidden || !setHideCount) return
    setHideCount((n) => n + 1)
    return () => setHideCount((n) => n - 1)
  }, [hidden, setHideCount])
}

/** 탭 편집 화면용 — 현재 구성과 저장 함수. */
// eslint-disable-next-line react-refresh/only-export-components
export function useTabSlots(): [MobileTabId[], (s: MobileTabId[]) => void] {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTabSlots must be used within MobileChromeProvider')
  return [ctx.slots, ctx.setSlots]
}

// 모바일 셸 크롬(탭바) 상태 공유 — 페이지가 "로컬 상세 상태"(메일 본문 열림 등)일 때 탭바를 숨기고,
// 탭 편집 화면이 바꾼 구성을 탭바에 즉시 반영하기 위한 컨텍스트.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useIsMobile } from '@/hooks/useIsMobile'
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

/** Provider 는 AppLayout 이 데스크톱·모바일 공통으로 감싸지만, Provider 밖(테스트·독립 렌더)에서도 안전하도록 null 허용. */
// eslint-disable-next-line react-refresh/only-export-components
export function useMobileChrome() {
  return useContext(Ctx)
}

/**
 * hidden=true 인 동안 탭바를 숨긴다. 데스크톱엔 탭바가 없으므로 카운트를 건드리지 않는다 — 불필요한
 * Provider 재렌더(앱 전체 소비자)를 막기 위해. lg 경계를 넘으면 isMobile 변화로 이펙트가 다시 돌아 카운트가 맞춰진다.
 * Provider 밖이면 무동작.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useHideTabBar(hidden: boolean) {
  const ctx = useContext(Ctx)
  const setHideCount = ctx?.setHideCount
  const isMobile = useIsMobile()
  useEffect(() => {
    if (!hidden || !isMobile || !setHideCount) return
    setHideCount((n) => n + 1)
    return () => setHideCount((n) => n - 1)
  }, [hidden, isMobile, setHideCount])
}

/** 탭 편집 화면용 — 현재 구성과 저장 함수. */
// eslint-disable-next-line react-refresh/only-export-components
export function useTabSlots(): [MobileTabId[], (s: MobileTabId[]) => void] {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTabSlots must be used within MobileChromeProvider')
  return [ctx.slots, ctx.setSlots]
}

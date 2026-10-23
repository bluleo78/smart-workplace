// 모바일 셸 크롬(탭바) 상태 공유 — 페이지가 "로컬 상세 상태"(메일 본문 열림 등)일 때 탭바를 숨기고,
// 탭 편집 화면이 바꾼 구성을 탭바에 즉시 반영하기 위한 컨텍스트.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useIsMobile } from '@/hooks/useIsMobile'
import { useIsTabBarWide } from '@/hooks/useIsTabBarWide'
import { loadTabSlots, mergeVisibleSlots, saveTabSlots, visibleSlotCount } from '@/lib/mobile/tabConfig'
import type { MobileTabId } from '@/lib/mobile/tabs'

interface MobileChromeValue {
  tabBarHidden: boolean
  setHideCount: (fn: (n: number) => number) => void
  /** 지금 화면 폭에서 보이는 탭 구성(넓으면 5칸, 좁으면 앞 3칸, WP-877). */
  slots: MobileTabId[]
  /** 보이는 칸 구성을 저장한다 — 좁은 폰이면 안 보이는 뒤 칸은 지킨 채 합친다(mergeVisibleSlots). */
  setSlots: (s: MobileTabId[]) => void
}

const Ctx = createContext<MobileChromeValue | null>(null)

/** 모바일 크롬 상태 Provider — 탭바 숨김 카운트와 탭 슬롯 구성을 보관한다. */
export function MobileChromeProvider({ children }: { children: ReactNode }) {
  // 숨김 요청 수(중첩 컴포넌트가 동시에 요청해도 마지막 해제 때만 다시 보이게 카운트).
  const [hideCount, setHideCount] = useState(0)
  // 저장된 5칸 전체 — 소비자에겐 화면 폭에 맞춰 앞에서부터 자른 slots 만 보인다.
  const [allSlots, setAllSlots] = useState<MobileTabId[]>(loadTabSlots)
  // 폭이 기준을 넘나들면(회전·창 크기) 보이는 칸 수가 바로 바뀐다.
  const wide = useIsTabBarWide()
  const slots = useMemo(() => allSlots.slice(0, visibleSlotCount(wide)), [allSlots, wide])
  // 함수형 갱신 — 한 번에 두 번 저장해도 앞 저장(뒤 칸 맞바꿈)을 덮지 않게 늘 최신 구성에 합친다. 저장은 같은 값이라 두 번 불려도 무해하다.
  const setSlots = useCallback((s: MobileTabId[]) => {
    setAllSlots((prev) => {
      const next = mergeVisibleSlots(prev, s)
      saveTabSlots(next)
      return next
    })
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

/** 탭 편집 화면·앱 목록용 — 지금 보이는 칸 구성과 저장 함수. */
// eslint-disable-next-line react-refresh/only-export-components
export function useTabSlots(): [MobileTabId[], (s: MobileTabId[]) => void] {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTabSlots must be used within MobileChromeProvider')
  return [ctx.slots, ctx.setSlots]
}

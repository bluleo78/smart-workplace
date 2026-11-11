// 도움말 패널 상태(WP-1505) — 열림(기억)·폭·위아래 비율·고른 절과 뒤로 기록, `?` 단축키.
// AppLayout 이 데스크톱·모바일 셸 분기 바깥에 한 번 끼워 두 셸이 같은 상태를 본다. 그리는 쪽(RightDock·MobileHelpSheet·HelpPanel)은
// 이 컨텍스트만 읽고, 판정(이동 reducer·저장 키·단축키)은 순수 함수 모듈에 둔다.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { getIsMobile, useIsMobile } from '@/hooks/useIsMobile'

import { helpNavReducer, type HelpNavState, type HelpTarget } from './helpNav'
import {
  clampHelpSplit,
  clampHelpWidth,
  helpOpenKey,
  readHelpOpen,
  readHelpSplit,
  readHelpWidth,
  writeHelpOpen,
  writeHelpSplit,
  writeHelpWidth,
} from './helpPanelStorage'
import { isHelpShortcut } from './helpShortcut'

export interface HelpPanelValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  /** 도움말 패널 폭(px, 데스크톱 오른쪽 도킹). */
  width: number
  /** 폭 변경(범위 맞춤). persist=true 일 때만 저장 — 드래그 중 매 pointermove 마다 쓰지 않게(AI 패널 resize 와 같다). */
  resize: (width: number, persist?: boolean) => void
  /** AI 패널과 위아래로 쌓일 때 도움말 높이 비율(0.2~0.8). */
  split: number
  setSplit: (ratio: number, persist?: boolean) => void
  /** 지금 주소·고른 절·뒤로 기록. */
  nav: HelpNavState
  /** 절을 고른다 — from(보던 절)이 있으면 뒤로 기록에 쌓는다. */
  select: (target: HelpTarget, from: HelpTarget | null) => void
  back: () => void
}

const HelpPanelContext = createContext<HelpPanelValue | null>(null)

/**
 * 도움말 패널 상태 Provider.
 * - 데스크톱은 이 사용자·워크스페이스가 기억한 열림으로 시작한다. 모바일은 늘 닫힌 채 시작하고 모바일에서 바꾼 열림은 저장하지 않는다
 *   (AI 패널 persist 와 같은 이유 — 전체 화면 시트가 저절로 뜨지 않게, 데스크톱 기억을 덮지 않게).
 *   창을 줄여 모바일 폭이 되면 닫고, 데스크톱 폭으로 돌아오면 기억한 열림으로 돌아간다.
 * - 주소가 바뀌면 고른 절·뒤로 기록을 비운다(새 화면의 도움말을 보여야 하므로 — helpNavReducer route).
 * - `?` 단축키는 window keydown 하나로 받는다(판정은 isHelpShortcut).
 */
export function HelpPanelProvider({ children }: { children: ReactNode }) {
  const { user, activeTenant } = useAuth()
  const isMobile = useIsMobile()
  const openKey = helpOpenKey(user ? { userId: user.id, tenantId: activeTenant?.tenantId ?? null } : null)

  // 열림은 (키, 모바일 여부) 에 묶인다 — 사용자·워크스페이스가 바뀌거나 셸이 바뀌면 렌더 중에 다시 정한다(effect 를 거치면 한 번 어긋나 그려진다).
  const initialOpen = (key: string | null, mobile: boolean) => !mobile && readHelpOpen(key)
  const [openState, setOpenState] = useState(() => ({ key: openKey, mobile: isMobile, open: initialOpen(openKey, isMobile) }))
  if (openState.key !== openKey || openState.mobile !== isMobile) {
    setOpenState({ key: openKey, mobile: isMobile, open: initialOpen(openKey, isMobile) })
  }
  const open = openState.open

  // 열림을 바꾸고, 데스크톱에서만 기억한다. 판정은 호출 시점 뷰포트(getIsMobile) — 렌더 값보다 늦게 바뀐 폭에도 맞게.
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState((s) => ({ ...s, open: next }))
      if (!getIsMobile()) writeHelpOpen(openKey, next)
    },
    [openKey],
  )
  const toggle = useCallback(() => setOpen(!open), [open, setOpen])

  const [width, setWidth] = useState(readHelpWidth)
  const resize = useCallback((w: number, persist = false) => {
    const clamped = clampHelpWidth(w)
    if (persist) writeHelpWidth(clamped)
    setWidth(clamped)
  }, [])

  const [split, setSplitState] = useState(readHelpSplit)
  const setSplit = useCallback((r: number, persist = false) => {
    const clamped = clampHelpSplit(r)
    if (persist) writeHelpSplit(clamped)
    setSplitState(clamped)
  }, [])

  // 이동 상태 — 주소가 바뀐 렌더에서는 route 를 먼저 적용한 값을 보여 옛 화면의 고른 절이 한 번도 그려지지 않게 하고, effect 로 상태를 맞춘다.
  const { pathname } = useLocation()
  const [rawNav, dispatch] = useReducer(helpNavReducer, { pathname, selected: null, history: [] })
  const nav = rawNav.pathname === pathname ? rawNav : helpNavReducer(rawNav, { type: 'route', pathname })
  useEffect(() => {
    dispatch({ type: 'route', pathname })
  }, [pathname])
  const select = useCallback((target: HelpTarget, from: HelpTarget | null) => dispatch({ type: 'select', target, from }), [])
  const back = useCallback(() => dispatch({ type: 'back' }), [])

  // `?` 단축키 — 처리한 키는 preventDefault 해 다른 전역 단축키가 같은 키를 다시 쓰지 않게 한다.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isHelpShortcut(e)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  const value = useMemo<HelpPanelValue>(
    () => ({ open, setOpen, toggle, width, resize, split, setSplit, nav, select, back }),
    [open, setOpen, toggle, width, resize, split, setSplit, nav, select, back],
  )
  return <HelpPanelContext.Provider value={value}>{children}</HelpPanelContext.Provider>
}

/** 도움말 패널 상태. HelpPanelProvider 밖에서 부르면 실수이므로 던진다. */
// eslint-disable-next-line react-refresh/only-export-components
export function useHelpPanel(): HelpPanelValue {
  const ctx = useContext(HelpPanelContext)
  if (!ctx) throw new Error('useHelpPanel 은 HelpPanelProvider 안에서만 쓸 수 있습니다')
  return ctx
}

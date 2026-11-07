// 포털 AI 칩과 페이지 헤더가 하나의 밀도 상태를 공유한다. 헤더 ref 등록으로 라우트 교체도 추적한다.
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

import { type HeaderDensityState, nextHeaderDensityState } from './headerDensity'

const expanded: HeaderDensityState = { folded: false, circle: false }
const DensityContext = createContext(expanded)
const HeaderContext = createContext<HTMLElement | null>(null)
const RegisterContext = createContext<(header: HTMLElement | null) => void>(() => {})

/** 공통 조상에서 헤더를 등록받아 문서 전체 subtree 관찰 없이 밀도를 계산한다. */
export function HeaderDensityProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HTMLElement | null>(null)
  const [state, setState] = useState(expanded)

  useEffect(() => {
    let current = expanded
    let chip: HTMLElement | null = null
    let left: HTMLElement | null = null
    let actions: HTMLElement | null = null
    let foldDisplacement = 0
    let unfoldedActionsWidth: number | null = null
    let settling = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const publish = (next: HeaderDensityState) => {
      if (next.folded === current.folded && next.circle === current.circle) return
      current = next
      setState(next)
    }
    const measure = () => {
      if (!chip || !left) { publish(expanded); return }
      const chipBox = chip.getBoundingClientRect()
      const leftBox = left.getBoundingClientRect()
      if (!chipBox.width || !leftBox.width || settling) return
      const titleSpace = chipBox.left - leftBox.left - 16
      if (unfoldedActionsWidth !== null && actions) {
        // 같은 시점의 액션 오른쪽 경계에서 펼친 액션의 정지선을 복원한다.
        // 검색 32px + 칩과 검색 간격 8px + 액션 앞 간격 16px = 56px.
        // 현재 칩이 중앙/패널 한계에 먼저 닿았다면 실제 이동분만 남는다.
        const unfoldedRightStop = actions.getBoundingClientRect().right - unfoldedActionsWidth - 56
        foldDisplacement = Math.max(0, chipBox.right - unfoldedRightStop)
      }
      const next = nextHeaderDensityState({
        titleSpace,
        hasAuxiliaryActions: header?.dataset.aiHasAuxiliaryActions === 'true',
        hasAiChip: !!chip.querySelector('[data-ai-density-chip]'),
        current,
        foldDisplacement,
      })
      if (next.folded !== current.folded || next.circle !== current.circle) {
        if (next.folded && !current.folded) unfoldedActionsWidth = actions?.getBoundingClientRect().width ?? null
        if (!next.folded) unfoldedActionsWidth = null
        // left 전환(200ms) 중간값은 복귀 판정에 쓰지 않는다. 칩 폭 전환에도 같은 안정 시간을 둔다.
        settling = true
        timer = setTimeout(() => { settling = false; measure() }, 250)
      }
      publish(next)
    }
    const ro = new ResizeObserver(measure)
    const attach = () => {
      const nextChip = document.querySelector<HTMLElement>('[data-ai-chip]')
      const nextLeft = header?.querySelector<HTMLElement>('[data-ai-left-group]') ?? null
      const nextActions = header?.querySelector<HTMLElement>('[data-ai-actions]') ?? null
      if (nextChip !== chip || nextLeft !== left || nextActions !== actions) {
        ro.disconnect()
        chip = nextChip
        left = nextLeft
        actions = nextActions
        for (const element of [header, chip, left, actions]) if (element) ro.observe(element)
      }
      measure()
    }
    // 페이지 교체 시 이전 페이지의 상태와 이동량을 물려주지 않는다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(expanded)
    attach()
    const bodyObserver = new MutationObserver(attach)
    bodyObserver.observe(document.body, { childList: true })
    const headerObserver = new MutationObserver(attach)
    if (header) headerObserver.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ai-has-auxiliary-actions'] })
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
      bodyObserver.disconnect()
      headerObserver.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [header])

  return <RegisterContext.Provider value={setHeader}>
    <HeaderContext.Provider value={header}>
      <DensityContext.Provider value={state}>{children}</DensityContext.Provider>
    </HeaderContext.Provider>
  </RegisterContext.Provider>
}

/** 포털과 헤더가 같은 단계 결과를 소비한다. 제공자 밖의 개별 화면은 기본 표시를 유지한다. */
// eslint-disable-next-line react-refresh/only-export-components
export function useHeaderDensity() { return useContext(DensityContext) }
/** 헤더 등록은 ref 콜백으로 처리해 늦은 마운트와 제거를 놓치지 않는다. */
// eslint-disable-next-line react-refresh/only-export-components
export function useHeaderDensityHeader() { return useContext(RegisterContext) }
/** 액션 폭 관찰도 현재 헤더 안에만 한정한다. */
// eslint-disable-next-line react-refresh/only-export-components
export function useActiveDensityHeader() { return useContext(HeaderContext) }

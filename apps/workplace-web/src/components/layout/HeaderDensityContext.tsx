// 포털 AI 칩과 페이지 헤더가 하나의 밀도 상태를 공유한다. 헤더 ref 등록으로 라우트 교체도 추적한다.
// 마지막 단계(docked, WP-1611)에서도 떠 있는 틀은 숨긴 채(visibility) 마운트돼 있어 같은 측정으로 복귀 시점을 판정한다.
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

import { HEADER_DOCK_SELECTOR, type HeaderDensityState, nextHeaderDensityState } from './headerDensity'

const expanded: HeaderDensityState = { folded: false, circle: false, docked: false }
/** 두 밀도 상태가 같은지 — 단계가 바뀔 때만 다시 그리고 안정 대기를 건다. */
const sameState = (a: HeaderDensityState, b: HeaderDensityState) =>
  a.folded === b.folded && a.circle === b.circle && a.docked === b.docked
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
      if (sameState(next, current)) return
      current = next
      setState(next)
    }
    const measure = () => {
      if (!chip || !left) { publish(expanded); return }
      const chipBox = chip.getBoundingClientRect()
      const leftBox = left.getBoundingClientRect()
      // 제목은 clamp로 폭이 0이 되어도 시작 좌표가 유효하므로 계속 밀도를 판정한다.
      // 헤더에 넣은(docked) 동안에도 틀은 visibility 로만 숨겨 폭·위치가 남는다 — 그 자리가 돌아갔을 때의 자리다(WP-1611).
      if (!chipBox.width || settling) return
      const titleSpace = chipBox.left - leftBox.left - 16
      if (unfoldedActionsWidth !== null && actions) {
        // 같은 시점의 액션 오른쪽 경계에서 펼친 액션의 정지선을 복원한다.
        // 검색 32px + 칩과 검색 간격 8px + 「?」 32px + 검색과 「?」 간격 8px + 액션 앞 간격 16px = 96px(WP-1505 에서 「?」 자리를 더했다).
        // 현재 칩이 중앙/패널 한계에 먼저 닿았다면 실제 이동분만 남는다.
        const unfoldedRightStop = actions.getBoundingClientRect().right - unfoldedActionsWidth - 96
        foldDisplacement = Math.max(0, chipBox.right - unfoldedRightStop)
      }
      const next = nextHeaderDensityState({
        titleSpace,
        hasAuxiliaryActions: header?.dataset.aiHasAuxiliaryActions === 'true',
        hasAiChip: !!chip.querySelector('[data-ai-density-chip]'),
        // 헤더 안 자리가 없는 화면(페이지 헤더 없음)은 떠 있는 틀을 끝까지 유지한다.
        hasDockSlot: !!header?.querySelector(HEADER_DOCK_SELECTOR),
        current,
        foldDisplacement,
      })
      if (!sameState(next, current)) {
        if (next.folded && !current.folded) unfoldedActionsWidth = actions?.getBoundingClientRect().width ?? null
        if (!next.folded) unfoldedActionsWidth = null
        // left 전환(200ms) 중간값은 복귀 판정에 쓰지 않는다. 칩 폭 전환에도 같은 안정 시간을 둔다.
        settling = true
        timer = setTimeout(() => { settling = false; measure() }, 250)
      }
      publish(next)
    }
    // 틀이 옮겨 간 「뒤」에 다시 잰다(WP-1612). 크기 변화(패널 열림·창 크기)는 틀의 left 를 CSS 변수로 바꿔 200ms 전환을 일으키는데,
    // 그 순간 잰 값은 전환 전 옛 자리다. 위치만 바뀌는 이동은 ResizeObserver 가 보지 못하고, 좌측 그룹이 이미 최소 폭(useAiChipClamp 의 120px)
    // 이하로 짧으면(드라이브 같은 짧은 경로) clamp 변화로도 크기가 안 바뀌어, 전에는 단계가 옛 자리 기준으로 남았다.
    //  - 틀 자신의 left transitionend 에서 다시 잰다 — 색·폭 전환이나 자식에서 버블된 종료는 위치와 무관하다(useAiChipClamp 와 같은 거름).
    //  - 전환이 끊기면(패널 손잡이 끌기의 transition-none 등) 종료 이벤트가 오지 않고, 안정 대기(settling) 중에 온 종료는 건너뛰므로
    //    마지막 크기 변화 250ms 뒤에도 한 번 더 잰다(useAiChipClamp 의 안정 재측정과 같은 대비). 종료가 먼저 오면 그 예약은 거둔다.
    let trailing: ReturnType<typeof setTimeout> | undefined
    const measureNowAndSettled = () => {
      measure()
      clearTimeout(trailing)
      trailing = setTimeout(measure, 250)
    }
    const ro = new ResizeObserver(measureNowAndSettled)
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target !== chip || e.propertyName !== 'left' || settling) return
      clearTimeout(trailing)
      measure()
    }
    const attach = () => {
      const nextChip = document.querySelector<HTMLElement>('[data-ai-chip]')
      const nextLeft = header?.querySelector<HTMLElement>('[data-ai-left-group]') ?? null
      const nextActions = header?.querySelector<HTMLElement>('[data-ai-actions]') ?? null
      if (nextChip !== chip || nextLeft !== left || nextActions !== actions) {
        ro.disconnect()
        // 틀이 교체되면(모드 전환·재마운트) 전환 종료 듣기도 새 틀로 옮긴다.
        if (nextChip !== chip) {
          chip?.removeEventListener('transitionend', onTransitionEnd)
          nextChip?.addEventListener('transitionend', onTransitionEnd)
        }
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
    window.addEventListener('resize', measureNowAndSettled)
    return () => {
      clearTimeout(timer)
      clearTimeout(trailing)
      ro.disconnect()
      bodyObserver.disconnect()
      headerObserver.disconnect()
      window.removeEventListener('resize', measureNowAndSettled)
      chip?.removeEventListener('transitionend', onTransitionEnd)
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

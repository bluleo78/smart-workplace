// 데스크톱 오른쪽 도킹(WP-1505) — 도움말 패널과 AI 옆 패널을 본문 오른쪽에 붙인다(본문을 밀어냄, 덮지 않음).
// 하나만이면 그것만, 둘 다 넓으면 「본문 | 도움말 | AI」 나란히, 본문이 640px 보다 좁아지면 AI 패널 폭의 한 칸에
// 도움말(위)·AI(아래)로 합친다(isDockStacked). 판정은 앱 셸 폭 − 레일 폭 − 패널 폭 계산이라 전환이 깜빡이지 않는다.
// 나란히 ↔ 위아래 전환에도 같은 요소(도움말 aside·AI aside)를 props 만 바꿔 그린다 — 감싼 칸은 늘 있고(나란히일 땐 display:contents),
// 그래야 전환할 때 AI 대화 입력·본문 스크롤이 다시 마운트되어 사라지지 않는다.
// 오른쪽 칸 폭 계약 — 칸 전체 폭 = --ai-side-width + --help-side-width 이고, 소비처(대화상자 배치·상단 가운데 칩·메일 크게 보기 등)는
// 둘을 더한 --right-dock-width(index.css :root) 하나만 읽는다. AI 폭은 AIAssistantContext 가, 도움말 폭은 여기서 :root 에 둔다.
// 위아래로 합친 칸은 폭이 AI 폭 하나라(합친 칸 폭 = AI 패널 폭) 그때는 --help-side-width 를 지워 합이 칸 폭과 같게 한다 —
// 합친 칸 손잡이를 끄는 동안 --ai-side-width 에 칸 폭을 직접 쓰는 것(useAiSideResizeHandle)도 같은 계약이다.
import { type KeyboardEvent, type PointerEvent, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { LazyAISidePanel } from '@/components/ai/LazyAiSurfaces'
import { useAiSideResizeHandle } from '@/components/ai/useAiSideResizeHandle'
import { isDockStacked } from '@/components/help/dockLayout'
import { useHelpPanel } from '@/components/help/HelpPanelContext'
import {
  clampHelpSplit,
  HELP_DEFAULT_WIDTH,
  HELP_MAX_WIDTH,
  HELP_MIN_WIDTH,
  HELP_SPLIT_MAX,
  HELP_SPLIT_MIN,
} from '@/components/help/helpPanelStorage'
import { LazyHelpPanel } from '@/components/help/LazyHelpPanel'
import { resizeHandleClass, useResizeHandle } from '@/hooks/useResizeHandle'
import { cn } from '@/lib/utils'

/** 도움말 패널 폭 변수 — index.css 의 --right-dock-width 가 AI 폭과 더한다(위 「오른쪽 칸 폭 계약」). */
const HELP_WIDTH_VAR = '--help-side-width'
/** 위아래 손잡이 키보드 한 번에 바뀌는 비율. */
const SPLIT_KEY_STEP = 0.05

/**
 * 앱 셸(data-ai-page-root)과 레일의 폭 — 배치 판정 입력. 둘 다 도킹 패널과 무관하게 정해지는 폭이라 되먹임이 없다.
 * 레일 폭은 펼침 상태가 레일 컴포넌트 안에만 있어 요소를 잰다.
 * 판정이 폭을 쓰는 것은 도움말·AI 가 둘 다 열렸을 때뿐이라 그때만(enabled) 잰다 — 닫혀 있는 동안 창 크기가 바뀔 때마다
 * 상태를 바꾸면 도킹 칸(AI 패널 트리 포함)이 쓸데없이 다시 그려진다. 다시 켜지면 그 레이아웃 효과에서 곧바로 재므로 낡은 폭이 그려지지 않는다.
 * - 셸은 화면 폭을 채우므로(h-screen flex) ResizeObserver 하나로 창 폭 변화까지 잡는다 — window resize 를 함께 걸면 한 번에 두 번 잰다.
 *   셸이 없을 때(셸 밖 화면·단위 테스트)만 창 폭과 resize 로 대신한다.
 * - 레일은 잴 때마다 다시 찾는다 — 레일이 다시 마운트되면 처음 찾은 노드는 떨어져 폭 0 으로 남는다. 셸 직속 자식이 바뀌면
 *   (MutationObserver, childList 만 — 셸 아래 전체를 보지 않는다) 다시 재고, 새 레일을 ResizeObserver 에 붙인다.
 */
function useShellWidths(enabled: boolean): { container: number; rail: number } {
  const [widths, setWidths] = useState(() => ({ container: window.innerWidth, rail: 0 }))
  useLayoutEffect(() => {
    if (!enabled) return
    const root = document.querySelector<HTMLElement>('[data-ai-page-root]')
    const ro = new ResizeObserver(() => read())
    let observedRail: HTMLElement | null = null
    function read() {
      const rail = (root ?? document).querySelector<HTMLElement>('[data-testid="app-rail"]')
      if (rail !== observedRail) {
        if (observedRail) ro.unobserve(observedRail)
        if (rail) ro.observe(rail)
        observedRail = rail
      }
      const container = root?.clientWidth || window.innerWidth
      const railWidth = rail?.offsetWidth ?? 0
      setWidths((prev) => (prev.container === container && prev.rail === railWidth ? prev : { container, rail: railWidth }))
    }
    read()
    if (!root) {
      window.addEventListener('resize', read)
      return () => {
        ro.disconnect()
        window.removeEventListener('resize', read)
      }
    }
    ro.observe(root)
    const mo = new MutationObserver(read)
    mo.observe(root, { childList: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [enabled])
  return widths
}

/** 도움말 패널 칸 — 나란히일 땐 왼쪽 손잡이가 있는 고정 폭 aside, 위아래일 땐 합친 칸의 윗부분(높이 비율 split). */
function HelpDock({ id, stacked }: { id: string; stacked: boolean }) {
  const { width, resize, split } = useHelpPanel()
  const asideRef = useRef<HTMLElement>(null)
  // 끄는 동안은 aside 폭과 --help-side-width 만 DOM 에 쓰고, 손을 떼면 상태를 바꾸고 기억한다(AI 패널 손잡이와 같은 방식).
  const handleProps = useResizeHandle({
    edge: 'left',
    width,
    min: HELP_MIN_WIDTH,
    max: HELP_MAX_WIDTH,
    defaultWidth: HELP_DEFAULT_WIDTH,
    onPreview: (w) => {
      if (asideRef.current) asideRef.current.style.width = `${w}px`
      document.documentElement.style.setProperty(HELP_WIDTH_VAR, `${w}px`)
    },
    onCommit: (w) => resize(w, true),
    label: '도움말 패널 폭 조절',
  })
  return (
    <aside
      ref={asideRef}
      id={id}
      data-testid="help-panel"
      data-help-panel
      style={stacked ? { flex: `0 0 ${split * 100}%` } : { width }}
      className={cn('relative flex min-h-0 flex-col bg-card', stacked ? 'w-full' : 'shrink-0 border-l')}
    >
      {!stacked && <div data-testid="help-resize-handle" {...handleProps} className={`${resizeHandleClass} left-0`} />}
      <LazyHelpPanel />
    </aside>
  )
}

/**
 * 위아래 사이 가로 손잡이 — 끌거나 ↑↓·Home·End 로 도움말 높이 비율(0.2~0.8)을 바꾼다. 세로 축이라 공용 useResizeHandle(가로 전용) 대신 여기서 처리한다.
 * @param helpId 높이를 바꾸는 도움말 칸의 id — aria-controls 와 끄는 동안 직접 높이를 쓸 대상
 */
function SplitHandle({ containerRef, helpId }: { containerRef: RefObject<HTMLDivElement | null>; helpId: string }) {
  const { split, setSplit } = useHelpPanel()
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const box = containerRef.current?.getBoundingClientRect()
    if (e.button !== 0 || !box || box.height <= 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const help = document.getElementById(helpId)
    let last = split
    // 끄는 동안은 도움말 칸 높이(flex-basis)만 DOM 에 쓰고, 놓을 때 한 번 상태로 반영해 기억한다 —
    // 매 움직임마다 상태를 바꾸면 도움말 컨텍스트를 읽는 패널 전체가 프레임마다 다시 그려진다(폭 손잡이와 같은 방식).
    const move = (ev: globalThis.PointerEvent) => {
      last = clampHelpSplit((ev.clientY - box.top) / box.height)
      if (help) help.style.flexBasis = `${last * 100}%`
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('lostpointercapture', end)
      setSplit(last, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('lostpointercapture', end)
  }
  // ↑↓ 는 5%씩, Home·End 는 도움말을 가장 작게·가장 크게(범위 맞춤은 setSplit 이 한다).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowUp' ? split - SPLIT_KEY_STEP
      : e.key === 'ArrowDown' ? split + SPLIT_KEY_STEP
      : e.key === 'Home' ? HELP_SPLIT_MIN
      : e.key === 'End' ? HELP_SPLIT_MAX
      : null
    if (next === null) return
    e.preventDefault()
    setSplit(next, true)
  }
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="도움말·AI 높이 조절"
      aria-controls={helpId}
      aria-valuenow={Math.round(split * 100)}
      aria-valuemin={HELP_SPLIT_MIN * 100}
      aria-valuemax={HELP_SPLIT_MAX * 100}
      tabIndex={0}
      data-testid="dock-split-handle"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // 보이는 선은 1px 경계 + 4px 잡는 띠, 잡는 영역은 투명 ::after 로 위아래 4px 씩 넓힌다(세로 손잡이 resizeHandleClass 와 같은 감각).
      className="relative z-10 h-1 shrink-0 cursor-row-resize touch-none border-t outline-none after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] hover:bg-primary/20 focus-visible:bg-primary/40 active:bg-primary/30"
    />
  )
}

/** 오른쪽 도킹. AppLayout 데스크톱 셸에서 main 뒤 형제로 둔다(앱 셸 flex 행의 오른쪽 끝). */
export function RightDock({ aiAvailable }: { aiAvailable: boolean }) {
  const help = useHelpPanel()
  const { mode, sidePanelWidth } = useAssistant()
  const aiSide = aiAvailable && mode === 'side'
  const shell = useShellWidths(help.open && aiSide)
  const stacked = isDockStacked({
    containerWidth: shell.container,
    railWidth: shell.rail,
    helpOpen: help.open,
    helpWidth: help.width,
    aiSide,
    aiWidth: sidePanelWidth,
  })
  // 도움말 칸 id — 위아래 손잡이의 aria-controls·끄는 동안 높이를 쓸 대상.
  const helpId = useId()
  const helpBeside = help.open && !stacked

  // 도움말이 옆에 붙어 있는 동안만 그 폭을 :root 에 둔다. 위아래로 합치면 칸 폭은 AI 폭(--ai-side-width)이 이미 알린다(위 계약).
  useLayoutEffect(() => {
    const root = document.documentElement
    if (helpBeside) root.style.setProperty(HELP_WIDTH_VAR, `${help.width}px`)
    else root.style.removeProperty(HELP_WIDTH_VAR)
    return () => {
      root.style.removeProperty(HELP_WIDTH_VAR)
    }
  }, [helpBeside, help.width])

  // 위아래로 합친 칸의 폭 손잡이 — AI 폭을 바꾼다(합친 칸 폭 = AI 패널 폭, 계획 「내가 정한 것」 2).
  const stackRef = useRef<HTMLDivElement>(null)
  const columnHandleProps = useAiSideResizeHandle(stackRef, 'AI·도움말 패널 폭 조절')

  return (
    <div
      ref={stackRef}
      // 페이지 영역 inert(엔티티 다이얼로그) 때 이 칸은 통째로 막지 않고 안의 도움말만 막는다 — 뒤늦게 그려지는 AI 패널을 막지 않게(aiPanelSurface).
      data-ai-dock
      data-testid={stacked ? 'right-dock-stacked' : undefined}
      style={stacked ? { width: sidePanelWidth } : undefined}
      className={stacked ? 'relative z-10 flex shrink-0 flex-col border-l bg-card' : 'contents'}
    >
      {/* 자리마다 한 칸(조건부라도 자리는 고정) — 전환 때 도움말·AI 요소가 다른 자리로 밀려 다시 마운트되지 않게. */}
      {stacked && <div data-testid="dock-resize-handle" {...columnHandleProps} className={`${resizeHandleClass} left-0`} />}
      {help.open && <HelpDock id={helpId} stacked={stacked} />}
      {stacked && <SplitHandle containerRef={stackRef} helpId={helpId} />}
      {aiAvailable && <LazyAISidePanel embedded={stacked} />}
    </div>
  )
}

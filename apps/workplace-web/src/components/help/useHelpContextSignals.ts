// 도움말 문맥 신호 수집(WP-1506) — 화면에서 지금 만지는 칸(포커스·클릭)·열린 대화상자·스크롤 위치를 DOM 이벤트로 모아
// 도움말 id 신호(HelpSignals)로 돌려주는 훅. 판정(우선순위·층 올라가기·스크롤 칸 고르기)은 순수 함수 모듈(helpContext)에 두고,
// 여기서는 브라우저 신호를 그 함수의 입력으로 바꾸는 일만 한다. HelpPanel 이 열려 있을 때만 마운트된다(설계 결정 8).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { AI_DOCK_SELECTOR, AI_PAGE_ROOT_SELECTOR, AI_PANEL_SELECTOR } from '@/components/ai/aiPanelSurface'

import { HELP_SCROLL_SETTLE_MS, type HelpBox, type HelpSignals, pickOpenDialogHelp, pickScrollHelp } from './helpContext'
import { CONTROL_SELECTOR, controlName } from './helpScreenControls'

/**
 * 신호로 보지 않는 자리 — 도움말 패널·AI 표면(칩·사이드 패널·시트)·「?」 단추·대화상자 흐린 막.
 * 여기서 일어난 포커스·클릭은 화면 칸을 만진 것이 아니라 도움말·AI 를 쓰는 것이라 신호도, 직접 고름 풀기도 하지 않는다.
 * 패널이 포털로 그리는 것(⌄ 목록·그림 확대)도 data-help-panel 을 달아 여기 든다. 흐린 막(dialog-overlay)은 화면 칸이 아니다 —
 * 그림 확대를 막 클릭으로 닫을 때 직접 고름이 풀리지 않게 하고, 화면 대화상자를 막으로 닫으면 포커스가 돌아온 단추가 신호를 준다.
 * 오른쪽 도킹(data-ai-dock)도 뺀다 — 도움말·AI 칸 사이 높이 손잡이·합친 칸 폭 손잡이는 패널 밖 형제라, 패널 크기를 바꾸려 누르기만 해도
 * 직접 고른 절이 풀리고 포커스 신호가 지워졌다(리뷰 지적). 도킹 안에는 도움말·AI 칸과 그 손잡이만 있다.
 */
const IGNORE_SELECTOR = `[data-help-panel], ${AI_PANEL_SELECTOR}, ${AI_DOCK_SELECTOR}, [data-help-trigger], [data-slot="dialog-overlay"]`
/** 대화상자 판정에서 「패널에 속함」 — 패널 안(그림 확대·⌄ 목록 팝오버) 또는 AI 표면 안 대화상자. */
const PANEL_SELECTOR = `[data-help-panel], ${AI_PANEL_SELECTOR}`
/** 대화상자 — Radix Dialog·AlertDialog·Popover 가 단다. */
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'
/** 스크롤 신호를 받는 범위 — 앱 셸 페이지 영역의 본문(main). 레일·도킹 패널 스크롤은 화면 칸 위치가 아니다. */
const PAGE_MAIN_SELECTOR = `${AI_PAGE_ROOT_SELECTOR} main`

/** 무시할 자리 안인가. */
function isIgnored(el: Element): boolean {
  return el.closest(IGNORE_SELECTOR) !== null
}

/**
 * 지금 열린 대화상자의 도움말 id — 문서의 대화상자를 DOM 순서로 모아 pickOpenDialogHelp 에 넘긴다.
 * 패널을 품은 대화상자(휴대폰 도움말 시트)도 패널에 속한 것으로 본다 — 패널이 자기 자신을 가리키지 않게(Review Focus 1).
 */
function readOpenDialogHelp(): string | null {
  const dialogs = [...document.querySelectorAll(DIALOG_SELECTOR)].map((el) => ({
    helpId: el.getAttribute('data-help'),
    state: el.getAttribute('data-state'),
    insidePanel: el.closest(PANEL_SELECTOR) !== null || el.querySelector('[data-help-panel]') !== null,
  }))
  return pickOpenDialogHelp(dialogs)
}

/** 감싸는 data-help 조상 수(자기 제외) — 스크롤 칸 고르기의 「가장 안쪽」 판정. */
function helpDepth(el: Element): number {
  let depth = 0
  for (let p = el.parentElement?.closest('[data-help]'); p; p = p.parentElement?.closest('[data-help]')) depth++
  return depth
}

/**
 * 스크롤 요소 안 data-help 칸으로 보고 있는 칸을 잰다.
 * 열린 대화상자·패널·AI 표면 안의 칸은 뺀다(스크롤 위치는 본문 칸만의 신호). 위치는 스크롤 요소 보이는 영역 위끝 기준.
 * 잴 칸이 하나도 없으면 null.
 */
function measureScrollHelp(scroller: Element): string | null {
  const base = scroller.getBoundingClientRect()
  const boxes: HelpBox[] = []
  for (const el of scroller.querySelectorAll('[data-help]')) {
    if (el.closest(DIALOG_SELECTOR) || isIgnored(el)) continue
    const id = el.getAttribute('data-help')
    if (!id) continue
    const r = el.getBoundingClientRect()
    boxes.push({ id, top: r.top - base.top, bottom: r.bottom - base.top, depth: helpDepth(el) })
  }
  const atBottom = scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
  return pickScrollHelp(boxes, scroller.clientHeight, atBottom)
}

/**
 * 스크롤 신호를 줄 수 있는 스크롤 요소인가 — 본문 main 자신, 페이지 본문(page-body), 또는 안에 data-help 칸을 품은 요소.
 * 본문 안의 가로 스크롤 표·코드 블록·textarea 처럼 칸을 품지 않은 안쪽 스크롤은 화면 칸 위치와 무관하다 —
 * 그것을 스크롤 요소로 삼으면 잴 칸이 없어 멀쩡한 스크롤 신호가 지워진다(리뷰 지적).
 */
function isHelpScroller(el: Element): boolean {
  return el.matches(PAGE_MAIN_SELECTOR) || el.matches('[data-testid="page-body"]') || el.querySelector('[data-help]') !== null
}

/**
 * 대화상자 열림·닫힘과 관련된 변화인가 — 대화상자 요소의 data-state·data-help 속성 변화(attributeFilter 로 이름은 이미 좁힘)이거나,
 * 붙거나 떨어진 요소가 대화상자이거나 대화상자를 품을 때. 채팅 스트리밍처럼 대화상자와 무관한 DOM 변화마다
 * 문서의 대화상자를 다시 훑지 않게 한다.
 */
function touchesDialog(record: MutationRecord): boolean {
  // data-state 는 툴팁·탭·아코디언 등 Radix 부품 곳곳이 바꾼다 — 대화상자 판정은 대화상자 요소의 속성만 읽으므로 그 밖의 변화로는 다시 훑지 않는다.
  if (record.type === 'attributes') return record.target instanceof Element && record.target.matches(DIALOG_SELECTOR)
  const nodes = [...record.addedNodes, ...record.removedNodes]
  return nodes.some((n) => n instanceof Element && (n.matches(DIALOG_SELECTOR) || n.querySelector(DIALOG_SELECTOR) !== null))
}

/** 새 화면의 첫 스크롤 요소 — 페이지 본문(Page.Body 의 page-body)이 우선, 없으면 main 자신. */
function firstScroller(): Element | null {
  return document.querySelector(`${PAGE_MAIN_SELECTOR} [data-testid="page-body"]`) ?? document.querySelector(PAGE_MAIN_SELECTOR)
}

/**
 * 새 화면의 첫 측정 — 첫 스크롤 요소 안에 data-help 칸이 있을 때만 잰다(없으면 null).
 * 주소가 바뀐 다음 프레임과, 칸을 기다리는 동안의 DOM 변화마다 같은 규칙으로 쓴다. 칸이 없으면 getBoundingClientRect 를 부르지 않아
 * 칸 없는 화면에서 DOM 변화마다 강제 레이아웃이 일어나지 않는다.
 */
function measureFirst(): string | null {
  const scroller = firstScroller()
  return scroller?.querySelector('[data-help]') ? measureScrollHelp(scroller) : null
}

/** 포커스·클릭 신호 — 칸의 도움말 id 와, 누르거나 포커스한 컨트롤 이름(본문 굵은 글자 강조용). */
type FocusSignal = { id: string | null; control: string | null }
const NO_FOCUS: FocusSignal = { id: null, control: null }

/**
 * 도움말 문맥 신호 훅.
 * - 포커스·클릭(document capture focusin·pointerdown): 패널·AI 표면·「?」 밖이면 onScreenInteraction(직접 고름 풀기)을 부르고,
 *   감싸는 data-help 칸을 포커스 신호로 든다. 그 칸이 화면 밖으로 나가거나(IntersectionObserver) DOM 에서 떨어지면 신호를 푼다.
 * - 대화상자: body MutationObserver(포털 붙고 떨어짐 + data-state 바뀜)로 열린 대화상자의 data-help 를 다시 읽는다.
 * - 스크롤: 본문 스크롤이 멈춘 뒤 HELP_SCROLL_SETTLE_MS 에 한 번 잰다. 처음과 주소가 바뀔 때는 기다리지 않고 다음 프레임에 한 번 잰다.
 * - 마운트 때 이미 화면 요소에 포커스가 있으면(`?` 로 연 경우) 그 칸을 포커스 신호로 심는다(직접 고름 풀기는 부르지 않는다).
 */
export function useHelpContextSignals(opts: { onScreenInteraction: () => void }): {
  signals: HelpSignals
  activeControlName: string | null
} {
  const { pathname } = useLocation()
  const [focus, setFocus] = useState<FocusSignal>(NO_FOCUS)
  // 열 때 이미 열려 있는 대화상자는 첫 렌더에서 읽는다(effect 안에서 바로 setState 하지 않게).
  const [dialog, setDialog] = useState<string | null>(readOpenDialogHelp)
  const [scroll, setScroll] = useState<string | null>(null)

  // 콜백은 ref 로 들어 리스너를 매 렌더 다시 달지 않는다.
  const onScreenInteractionRef = useRef(opts.onScreenInteraction)
  useEffect(() => {
    onScreenInteractionRef.current = opts.onScreenInteraction
  }, [opts.onScreenInteraction])

  // 주소가 바뀐 뒤 사용자가 아직 스크롤하지 않았는가 — 그동안은 본문이 바뀔 때마다(MutationObserver) 다시 잰다.
  // 지연 로딩 화면(React.lazy)이 늦게 그려지거나, 목록 데이터가 늦게 와 칸 위치가 밀리면 첫 측정이 낡기 때문이다
  // (라이브 검증: 토큰 목록이 비어 있을 때 잰 「도구에 연결하기」가 목록이 그려진 뒤에도 남음). 사용자가 스크롤하면 그 측정이 이어받는다.
  const autoMeasureRef = useRef(false)

  // 포커스·클릭·대화상자 — 마운트 동안 한 번 달고 언마운트 때 모두 정리한다.
  useEffect(() => {
    // 포커스 신호를 준 data-help 칸 — 화면 밖으로 나가거나 DOM 에서 떨어지면 신호를 푼다(Review Focus 5). 이 효과 안에서만 쓴다.
    let focusEl: Element | null = null
    /** 포커스 신호를 비운다(칸을 보던 관찰도 끊는다). */
    const clearFocus = () => {
      focusEl = null
      io.disconnect()
      setFocus(NO_FOCUS)
    }
    // 칸이 화면 밖으로 나가면 포커스 신호를 푼다 — 처음 관찰을 시작할 때의 보고도 같은 규칙(화면 밖 칸은 신호가 아님).
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.target === focusEl && !e.isIntersecting)) clearFocus()
    })

    /**
     * target 을 감싸는 칸·컨트롤을 포커스 신호로 든다.
     * data-help 를 다는 칸 요소는 `display: contents` 를 쓰면 안 된다 — 상자가 없어 IntersectionObserver 가 늘 「교차 안 함」으로
     * 보고해, 포커스하자마자 신호가 풀린다(칸을 감싸는 div 에 data-help 를 달 때 주의).
     */
    const adopt = (target: Element) => {
      const helpEl = target.closest('[data-help]')
      const control = target.closest(CONTROL_SELECTOR)
      io.disconnect()
      focusEl = helpEl
      if (helpEl) io.observe(helpEl)
      const next: FocusSignal = { id: helpEl?.getAttribute('data-help') || null, control: control ? controlName(control) || null : null }
      // 같은 칸·같은 단추면 이전 값을 그대로 둬 다시 그리지 않는다(화면 포커스·클릭마다 불린다).
      setFocus((prev) => (prev.id === next.id && prev.control === next.control ? prev : next))
    }

    /** 화면 상호작용 — 패널·AI 표면·「?」 밖이면 직접 고름을 풀고 그 칸을 신호로. */
    const onInteract = (e: Event) => {
      const target = e.target
      if (!(target instanceof Element) || isIgnored(target)) return
      onScreenInteractionRef.current()
      adopt(target)
    }
    document.addEventListener('focusin', onInteract, true)
    document.addEventListener('pointerdown', onInteract, true)

    // 열 때 이미 화면 요소에 포커스가 있으면 그 칸을 잇는다(`?` 단축키로 연 경우).
    const active = document.activeElement
    if (active && active !== document.body && !isIgnored(active)) adopt(active)

    // 다시 재기는 한 프레임에 한 번만 — 목록이 그려질 때 변경 기록이 잇달아 와도 레이아웃을 한 번만 읽는다.
    let remeasureFrame: number | null = null
    const remeasure = () => {
      remeasureFrame = null
      if (!autoMeasureRef.current) return
      // 잴 칸이 없으면(아직 그려지지 않음) 이전 값을 둔다. 같은 값이면 React 가 다시 그리지 않는다.
      const next = measureFirst()
      if (next !== null) setScroll(next)
    }

    // 대화상자 열림·닫힘과 포커스 칸 떨어짐 — 포털은 body 아래 어디든 붙고 data-state 는 포털 루트 안쪽 요소에서 바뀐다.
    const mo = new MutationObserver((records) => {
      if (records.some(touchesDialog)) setDialog(readOpenDialogHelp())
      if (focusEl && !focusEl.isConnected) clearFocus()
      // 사용자가 아직 스크롤하지 않았으면 바뀐 화면으로 다시 잰다(늦게 그려진 칸·늦게 온 데이터).
      if (autoMeasureRef.current && remeasureFrame === null) remeasureFrame = requestAnimationFrame(remeasure)
    })
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'data-help'] })

    return () => {
      document.removeEventListener('focusin', onInteract, true)
      document.removeEventListener('pointerdown', onInteract, true)
      io.disconnect()
      mo.disconnect()
      if (remeasureFrame !== null) cancelAnimationFrame(remeasureFrame)
    }
  }, [])

  // 스크롤 — 본문 스크롤이 멈춘 뒤 한 번 잰다(멈추기 전 매 이벤트마다 재면 패널이 깜박인다).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onScroll = (e: Event) => {
      const target = e.target
      if (!(target instanceof Element) || !target.closest(PAGE_MAIN_SELECTOR) || isIgnored(target) || !isHelpScroller(target)) return
      // 사용자가 스크롤했으면 그 측정이 이어받는다 — 이후 화면 변화로는 다시 재지 않는다(읽던 자리를 흔들지 않게).
      autoMeasureRef.current = false
      if (timer !== null) clearTimeout(timer)
      // 마지막으로 스크롤한 요소를 멈춘 뒤 잰다(타이머가 그 요소를 붙든다 — 새로 스크롤하면 타이머째 바뀐다).
      timer = setTimeout(() => {
        timer = null
        if (!target.isConnected) return
        // 잴 칸이 없으면(칸이 잠시 비었거나 모두 대화상자 안) 이전 신호를 그대로 둔다 — 지우면 패널이 주소 첫머리로 튄다.
        const next = measureScrollHelp(target)
        if (next !== null) setScroll(next)
      }, HELP_SCROLL_SETTLE_MS)
    }
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      if (timer !== null) clearTimeout(timer)
    }
  }, [])

  // 처음 열 때·주소가 바뀔 때는 기다리지 않고 잰다 — 새 화면이 그려진 다음 프레임에(설계 결정 6).
  // 그 뒤 사용자가 스크롤하기 전까지는 화면이 바뀔 때마다 위 MutationObserver 가 다시 잰다(늦게 그려진 칸·늦게 온 데이터).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      autoMeasureRef.current = true
      setScroll(measureFirst())
    })
    return () => {
      cancelAnimationFrame(frame)
      autoMeasureRef.current = false
    }
  }, [pathname])

  const signals = useMemo<HelpSignals>(() => ({ dialog, focus: focus.id, scroll }), [dialog, focus.id, scroll])
  return { signals, activeControlName: focus.control }
}

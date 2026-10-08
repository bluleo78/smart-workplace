// 통합 뷰어 터치 제스처 배선(WP-278) — 본문을 감싼 무대(stage)에 Touch Events 를 직접 건다.
// 왜 Pointer Events 가 아닌가(판정 R2): 브라우저가 스크롤을 가져가면 pointercancel 로 제스처를 잃는다.
// "넓은 표는 내용 먼저, 가장자리에선 넘김"·"문서는 맨 위에서 당길 때만 닫기"처럼 네이티브 스크롤과 제스처를 나누려면
// 첫 이동에서 판정(lockGesture)해 우리 것일 때만 preventDefault 해야 하고, 그러려면 passive:false touchmove 가 필요하다
// (React onTouchMove 는 passive 로 등록돼 preventDefault 가 무시된다).
// 터치 이벤트는 손가락에서만 오므로 iPad 에 트랙패드·마우스를 붙여도 이 제스처는 발동하지 않는다.
// 끌기 중 이동은 React 상태가 아니라 무대 style 에 직접 쓴다 — 프레임마다 뷰어 전체가 다시 그려지지 않게.
import { useEffect, useRef } from 'react'

import { decideSwipe, dragOffset, type GestureLock, lockGesture, releaseVelocity, type Sample } from './viewerGestures'

export interface ViewerGestureOptions {
  /** 터치 제스처 사용 — coarse 포인터일 때만(스펙 §3.2: 폭이 아니라 pointer: coarse). */
  enabled: boolean
  hasPrev: boolean
  hasNext: boolean
  /** 현재 확대 배율(1 = 맞춤) — 확대 중엔 아래로 닫기 대신 팬. */
  zoom: number
  /** 스와이프로 확정된 넘김. */
  onNav: (dir: -1 | 1) => void
}

/** 한 손가락 추적 상태 — 시작 시점의 스크롤 여유를 함께 들고 있어 첫 이동 판정에 쓴다. */
interface OneFinger {
  kind: 'one'
  lock: GestureLock
  startX: number
  startY: number
  samples: Sample[]
  canPanLeft: boolean
  canPanRight: boolean
  atTop: boolean
}
/** ignore = 이번 터치 묶음은 손을 모두 뗄 때까지 무시(버튼 위 시작·두 번째 손가락 등). */
type Track = OneFinger | { kind: 'ignore' } | null

/** 제스처를 받지 않는 대상 — 본문 안 버튼·링크·입력(마크다운 링크·다시 시도 등)은 그 요소의 탭·스크롤에 맡긴다. */
const INTERACTIVE = 'button, a[href], input, textarea, select, [role="button"], [contenteditable="true"]'
/** 표본 보관 개수 — 속도는 최근 100ms 만 보므로 이만큼이면 충분. */
const MAX_SAMPLES = 20

/** 그 축으로 실제 스크롤되는 요소인가(overflow auto/scroll + 넘침, ±1px 허용). */
function scrollable(el: Element, axis: 'x' | 'y'): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const s = getComputedStyle(el)
  const ov = axis === 'x' ? s.overflowX : s.overflowY
  if (ov !== 'auto' && ov !== 'scroll') return false
  return axis === 'x' ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1
}

/** 손가락 아래에서 무대까지 올라가며 그 축의 첫 스크롤 영역(판정 R4). 없으면 null. */
function nearestScroller(target: Element, stage: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (scrollable(el, axis)) return el
    if (el === stage) break
  }
  return null
}

/** 손가락 아래 가로 스크롤 영역의 남은 여유 — 없으면 둘 다 false(어느 방향이든 넘김). */
export function horizontalRoom(target: Element, stage: HTMLElement): { canPanLeft: boolean; canPanRight: boolean } {
  const el = nearestScroller(target, stage, 'x')
  if (!el) return { canPanLeft: false, canPanRight: false }
  return { canPanLeft: el.scrollLeft > 1, canPanRight: el.scrollLeft < el.scrollWidth - el.clientWidth - 1 }
}

/** 손가락 아래 세로 스크롤 영역이 맨 위인가 — 세로 스크롤 영역이 없으면(맞춤 이미지 등) 참. */
export function atScrollTop(target: Element, stage: HTMLElement): boolean {
  const el = nearestScroller(target, stage, 'y')
  return !el || el.scrollTop <= 1
}

/**
 * 무대에 터치 제스처를 건다. 옵션은 최신값 ref 로 읽어 리스너를 매 렌더 다시 달지 않는다(stage·enabled 가 바뀔 때만).
 */
export function useViewerGestures(stage: HTMLElement | null, opts: ViewerGestureOptions): void {
  const latest = useRef(opts)
  useEffect(() => {
    latest.current = opts
  })
  const { enabled } = opts
  useEffect(() => {
    if (!stage || !enabled) return
    let track: Track = null
    /** 끌기 중 위치 — 전환 없이 즉시. */
    const paint = (x: number, y: number) => {
      stage.style.transition = ''
      stage.style.transform = x || y ? `translate3d(${x}px, ${y}px, 0)` : ''
    }
    /** 제자리로 부드럽게 돌아간다(넘김 취소). */
    const settle = () => {
      stage.style.transition = 'transform 200ms ease-out'
      stage.style.transform = ''
    }
    const onStart = (e: TouchEvent) => {
      const target = e.target as Element
      if (e.touches.length !== 1 || target.closest(INTERACTIVE)) {
        // 두 번째 손가락이 닿으면 진행 중이던 넘김을 원위치하고 이번 묶음은 무시한다(Review Focus 3).
        if (track?.kind === 'one' && track.lock === 'swipe') settle()
        track = { kind: 'ignore' }
        return
      }
      const t = e.touches[0]
      track = {
        kind: 'one',
        lock: 'pending',
        startX: t.clientX,
        startY: t.clientY,
        samples: [{ t: e.timeStamp, x: t.clientX, y: t.clientY }],
        ...horizontalRoom(target, stage),
        atTop: atScrollTop(target, stage),
      }
    }
    const onMove = (e: TouchEvent) => {
      if (track?.kind !== 'one' || e.touches.length !== 1) return
      const o = latest.current
      const t = e.touches[0]
      const dx = t.clientX - track.startX
      const dy = t.clientY - track.startY
      track.samples.push({ t: e.timeStamp, x: t.clientX, y: t.clientY })
      if (track.samples.length > MAX_SAMPLES) track.samples.shift()
      if (track.lock === 'pending') {
        track.lock = lockGesture({
          dx,
          dy,
          startX: track.startX,
          viewportWidth: window.innerWidth,
          canPanLeft: track.canPanLeft,
          canPanRight: track.canPanRight,
          atTop: track.atTop,
          zoom: o.zoom,
        })
      }
      if (track.lock === 'swipe') {
        // 우리 제스처 — 브라우저 스크롤·뒤로가기 제스처를 막고 무대를 손가락에 붙인다(끝이면 러버밴드).
        if (e.cancelable) e.preventDefault()
        paint(dragOffset(dx, stage.clientWidth, o.hasPrev, o.hasNext), 0)
      }
    }
    const onEnd = (e: TouchEvent) => {
      const cur = track
      if (e.touches.length === 0) track = null
      if (cur?.kind !== 'one') return
      const o = latest.current
      const t = e.changedTouches[0]
      if (cur.lock === 'swipe') {
        const dx = t.clientX - cur.startX
        const { vx } = releaseVelocity([...cur.samples, { t: e.timeStamp, x: t.clientX, y: t.clientY }])
        const d = decideSwipe({ dx, vx, width: stage.clientWidth, hasPrev: o.hasPrev, hasNext: o.hasNext })
        if (d === 'stay') settle()
        else {
          paint(0, 0)
          o.onNav(d === 'next' ? 1 : -1)
        }
      }
    }
    const onCancel = () => {
      if (track?.kind === 'one' && track.lock === 'swipe') settle()
      track = null
    }
    stage.addEventListener('touchstart', onStart, { passive: true })
    stage.addEventListener('touchmove', onMove, { passive: false })
    stage.addEventListener('touchend', onEnd)
    stage.addEventListener('touchcancel', onCancel)
    return () => {
      stage.removeEventListener('touchstart', onStart)
      stage.removeEventListener('touchmove', onMove)
      stage.removeEventListener('touchend', onEnd)
      stage.removeEventListener('touchcancel', onCancel)
      stage.style.transform = ''
      stage.style.transition = ''
    }
  }, [stage, enabled])
}

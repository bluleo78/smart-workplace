// 통합 뷰어 터치 제스처 배선(WP-278) — 본문을 감싼 무대(stage)에 Touch Events 를 직접 건다.
// 왜 Pointer Events 가 아닌가(판정 R2): 브라우저가 스크롤을 가져가면 pointercancel 로 제스처를 잃는다.
// "넓은 표는 내용 먼저, 가장자리에선 넘김"·"문서는 맨 위에서 당길 때만 닫기"처럼 네이티브 스크롤과 제스처를 나누려면
// 첫 이동에서 판정(lockGesture)해 우리 것일 때만 preventDefault 해야 하고, 그러려면 passive:false touchmove 가 필요하다
// (React onTouchMove 는 passive 로 등록돼 preventDefault 가 무시된다).
// 터치 이벤트는 손가락에서만 오므로 iPad 에 트랙패드·마우스를 붙여도 이 제스처는 발동하지 않는다.
// 끌기 중 이동은 React 상태가 아니라 무대 style 에 직접 쓴다 — 프레임마다 뷰어 전체가 다시 그려지지 않게.
import { useEffect, useRef } from 'react'

import {
  decideDismiss,
  decideSwipe,
  DOUBLE_TAP_MS,
  doubleTapTarget,
  dragOffset,
  focusFraction,
  type GestureLock,
  isDoubleTap,
  isTapDuration,
  lockGesture,
  pickAnchorIndex,
  pinchZoom,
  releaseVelocity,
  type Sample,
  type ZoomFocus,
} from './viewerGestures'

/** 확대 기준 — 기준 요소(PDF 페이지 캔버스·이미지)와 그 안 비율·화면 좌표. 기준 요소가 없으면(아직 로딩) 호출부는 스크롤을 건드리지 않는다. */
export interface ZoomAnchor extends ZoomFocus {
  el: Element
}

export interface ViewerGestureOptions {
  /** 터치 제스처 사용 — coarse 포인터일 때만(스펙 §3.2: 폭이 아니라 pointer: coarse). */
  enabled: boolean
  hasPrev: boolean
  hasNext: boolean
  /** 현재 확대 배율(1 = 맞춤) — 확대 중엔 아래로 닫기 대신 팬. */
  zoom: number
  /** 스와이프로 확정된 넘김. */
  onNav: (dir: -1 | 1) => void
  /** 아래로 닫기 중 옅어질 배경 레이어(없으면 무대만 움직인다). */
  backdrop?: HTMLElement | null
  /** 아래로 쓸어 닫기 확정. */
  onDismiss: () => void
  /** 단일 탭(움직임 없는 터치) — 모바일 배치에서 바 토글(판정 R5). 없으면 탭은 무시. */
  onTap?: () => void
  /** 핀치·두 번 탭 확대 대상 형식인가(이미지·PDF, 사용 가능 항목). */
  zoomable: boolean
  /** 확대 확정 — anchor 의 기준 비율 지점이 화면의 같은 자리(anchor.x·y)에 남게 호출부가 레이아웃 뒤 스크롤을 맞춘다. */
  onZoom: (next: number, anchor: ZoomAnchor | null) => void
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
  /**
   * 브라우저가 이미 스크롤을 가져갔는가 — 취소할 수 없는(cancelable=false) touchmove 가 왔으면 참.
   * 이 상태에서 두 번째 손가락이 닿아도 핀치 미리보기를 걸지 않는다(네이티브 팬 위에 scale 이 겹치고, 확정 기준점도 이미 밀려 있다).
   */
  scrolling: boolean
}
/** 두 손가락 핀치 — 시작 거리·배율·확대 기준(시작 중점). 진행 중엔 무대 scale 미리보기만(판정 R1). */
interface Pinch {
  kind: 'pinch'
  startDist: number
  startZoom: number
  /** 확대 기준 — 시작 때(무대 transform 이 없을 때) 잰다. 손을 뗄 때 재면 미리보기 scale 이 섞인 위치가 된다. */
  anchor: ZoomAnchor | null
  /** 미리보기 scale 의 기준점(무대 왼쪽 위 기준 px) — 시작 때 한 번 잰다. 이동마다 재면 이미 걸린 scale 이 섞인 rect 로 기준점이 떠다닌다. */
  originX: number
  originY: number
  /** 시작 배율 대비 미리보기 배율(1 = 그대로) — 손을 뗄 때 startZoom × scale 로 확정한다. */
  scale: number
}
/** ignore = 이번 터치 묶음은 손을 모두 뗄 때까지 무시(버튼 위 시작·확대 대상이 아닌 두 손가락 등). */
type Track = OneFinger | Pinch | { kind: 'ignore' } | null

/** 제스처를 받지 않는 대상 — 본문 안 버튼·링크·입력(마크다운 링크·다시 시도 등)은 그 요소의 탭·스크롤에 맡긴다. */
const INTERACTIVE = 'button, a[href], input, textarea, select, [role="button"], [contenteditable="true"]'
/** 표본 보관 개수 — 속도는 최근 100ms 만 보므로 이만큼이면 충분. */
const MAX_SAMPLES = 20

/** 확대 기준 요소 표식 — PDF 페이지 캔버스·이미지(ViewerBody·PdfPages 가 단다). 배율에 정확히 비례하는 건 이 요소들의 크기뿐이다. */
const ZOOM_CONTENT = '[data-zoom-content]'

/** 화면 좌표 (x, y) 의 확대 기준 — 가장 가까운 기준 요소와 그 안 비율. 기준 요소가 없으면 null. */
function captureAnchor(stage: HTMLElement, x: number, y: number): ZoomAnchor | null {
  const els = Array.from(stage.querySelectorAll(ZOOM_CONTENT))
  const k = pickAnchorIndex(
    els.map((el) => el.getBoundingClientRect()),
    x,
    y,
  )
  if (k < 0) return null
  const el = els[k]
  return { el, x, y, ...focusFraction(el.getBoundingClientRect(), x, y) }
}

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
  // 배경 레이어는 콜백 ref 로 늦게 들어오므로 의존성에 넣어 마운트된 뒤 리스너를 다시 단다.
  const { enabled, backdrop: backdropEl } = opts
  useEffect(() => {
    if (!stage || !enabled) return
    let track: Track = null
    const backdrop = backdropEl ?? null
    /** 단일 탭 지연 타이머 — 두 번 탭과 구분하고, 탭으로 옮겨간 포커스를 본 뒤 바를 토글하려고 기다린다(판정 R6). */
    let tapTimer: ReturnType<typeof setTimeout> | undefined
    /** 직전 단일 탭 — 다음 탭이 두 번 탭인지 가린다. 탭이 아닌 제스처가 끼면 비운다. */
    let lastTap: Sample | null = null
    /** 두 손가락 거리·중점(화면 좌표). */
    const twoFinger = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]]
      return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), midX: (a.clientX + b.clientX) / 2, midY: (a.clientY + b.clientY) / 2 }
    }
    /** 움직임 없이 짧게 끝난 터치 — 두 번 탭이면 확대 전환, 아니면 지연 뒤 onTap(판정 R6). */
    const handleTap = (s: Sample) => {
      const o = latest.current
      if (o.zoomable && isDoubleTap(lastTap, s)) {
        // 두 번 탭 — 대기 중인 단일 탭(바 토글)을 취소하고 1× ↔ 2×(탭 지점 기준, 판정 R9).
        clearTimeout(tapTimer)
        lastTap = null
        o.onZoom(doubleTapTarget(o.zoom), captureAnchor(stage, s.x, s.y))
        return
      }
      lastTap = s
      clearTimeout(tapTimer)
      tapTimer = setTimeout(() => {
        lastTap = null
        latest.current.onTap?.()
      }, DOUBLE_TAP_MS)
    }
    /** 끌기 중 위치 — 전환 없이 즉시. 아래로 끌면 배경이 옅어진다(시안 M2, 최소 0.2 — 완전히 투명해져 뒤 화면이 튀지 않게). */
    const paint = (x: number, y: number) => {
      stage.style.transition = ''
      stage.style.transform = x || y ? `translate3d(${x}px, ${y}px, 0)` : ''
      if (backdrop) backdrop.style.opacity = y > 0 ? String(Math.max(0.2, 1 - y / stage.clientHeight)) : ''
    }
    /** 제자리로 부드럽게 돌아간다(넘김·닫기 취소). */
    const settle = () => {
      stage.style.transition = 'transform 200ms ease-out'
      stage.style.transform = ''
      if (backdrop) backdrop.style.opacity = ''
    }
    /** 핀치 미리보기(scale·기준점)를 확정 없이 걷어낸다 — 세 번째 손가락·touchcancel 로 핀치가 끊길 때. */
    const clearPinchPreview = () => {
      stage.style.transition = ''
      stage.style.transform = ''
      stage.style.transformOrigin = ''
    }
    /** 무대를 움직이는 중인 제스처인가 — 취소(두 번째 손가락·touchcancel) 때 원위치가 필요한 상태. */
    const moving = (t: Track) => t?.kind === 'one' && (t.lock === 'swipe' || t.lock === 'dismiss')
    const onStart = (e: TouchEvent) => {
      const target = e.target as Element
      const o = latest.current
      // 새 터치가 시작되면 대기 중인 단일 탭(바 토글)을 취소한다 — 탭 직후 300ms 안의 스와이프·핀치가 바를 토글하지 않게.
      // 이 터치가 다시 탭으로 끝나면 handleTap 이 두 번 탭 판정 또는 새 지연 토글을 건다(lastTap 은 그대로 둔다).
      clearTimeout(tapTimer)
      // 첫 손가락으로 이미 네이티브 스크롤 중이면 두 번째 손가락은 무시 — 스크롤 위에 scale 미리보기를 겹치지 않는다(아래 ignore 로).
      const nativeScrolling = track?.kind === 'one' && track.scrolling
      if (e.touches.length === 2 && o.zoomable && !target.closest(INTERACTIVE) && !nativeScrolling) {
        // 스와이프·닫기 중 두 번째 손가락이 닿았으면 무대를 즉시 원위치하고 핀치로 이어간다(Review Focus 3).
        if (moving(track)) paint(0, 0)
        const f = twoFinger(e)
        // 무대 transform 을 비운 상태(위 원위치 포함)에서 기준점을 한 번만 잰다.
        const r = stage.getBoundingClientRect()
        track = {
          kind: 'pinch',
          startDist: f.dist,
          startZoom: o.zoom,
          anchor: captureAnchor(stage, f.midX, f.midY),
          originX: f.midX - r.left,
          originY: f.midY - r.top,
          scale: 1,
        }
        lastTap = null
        return
      }
      if (e.touches.length !== 1 || target.closest(INTERACTIVE)) {
        // 두 번째 손가락이 닿으면(확대 대상이 아니거나 세 손가락 이상) 진행 중이던 넘김·닫기를 원위치하고 이번 묶음은 무시한다.
        if (moving(track)) settle()
        // 핀치 중 세 번째 손가락(손바닥 오접촉 등) — 이후 묶음은 무시라 손을 떼도 확정·정리가 없으므로 미리보기를 지금 걷는다.
        // 남겨 두면 data-zoom 과 다른 배율로 확대된 채 다음 파일까지 따라간다(무대는 항목별 key 가 없다).
        if (track?.kind === 'pinch') clearPinchPreview()
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
        scrolling: false,
      }
    }
    const onMove = (e: TouchEvent) => {
      if (track?.kind === 'pinch') {
        if (e.touches.length !== 2) return
        // 브라우저 페이지 확대를 막고 무대에 scale 미리보기만 건다 — PDF 캔버스는 손을 뗄 때 한 번만 다시 그린다(판정 R1).
        if (e.cancelable) e.preventDefault()
        const f = twoFinger(e)
        track.scale = pinchZoom(track.startZoom, track.startDist, f.dist) / track.startZoom
        stage.style.transition = ''
        stage.style.transformOrigin = `${track.originX}px ${track.originY}px`
        stage.style.transform = `scale(${track.scale})`
        return
      }
      if (track?.kind !== 'one' || e.touches.length !== 1) return
      // 브라우저가 스크롤을 시작하면 이후 touchmove 는 취소할 수 없게 온다 — 그 신호로 "네이티브 스크롤 중"을 안다.
      // (판정이 native 라도 가장자리 20px 시작처럼 브라우저가 스크롤하지 않는 경우가 있어 판정값 대신 이 신호를 쓴다.)
      if (!e.cancelable) track.scrolling = true
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
          // 1.01 — scale 은 1.0000001 같은 부동소수로 올 수 있어 여유를 둔다.
          pageZoomed: (window.visualViewport?.scale ?? 1) > 1.01,
        })
      }
      if (track.lock === 'swipe') {
        // 우리 제스처 — 브라우저 스크롤·뒤로가기 제스처를 막고 무대를 손가락에 붙인다(끝이면 러버밴드).
        if (e.cancelable) e.preventDefault()
        paint(dragOffset(dx, stage.clientWidth, o.hasPrev, o.hasNext), 0)
      } else if (track.lock === 'dismiss') {
        // 아래로 닫기 — 당겨서 새로고침·스크롤 바운스를 막고 무대를 손가락에 붙인다(위로는 따라가지 않음).
        if (e.cancelable) e.preventDefault()
        paint(0, Math.max(0, dy))
      }
    }
    const onEnd = (e: TouchEvent) => {
      const cur = track
      if (cur?.kind === 'pinch') {
        // 한 손가락이라도 떼면 확정 — 남은 손가락은 다 뗄 때까지 무시(팬·넘김으로 튀지 않게).
        track = e.touches.length === 0 ? null : { kind: 'ignore' }
        stage.style.transform = ''
        stage.style.transformOrigin = ''
        // 배율은 둘째 자리에서 자른다(데스크톱 ＋/－ 단계와 같은 규칙 — data-zoom·표시가 긴 소수가 되지 않게).
        const next = +(cur.startZoom * cur.scale).toFixed(2)
        if (next !== cur.startZoom) latest.current.onZoom(next, cur.anchor)
        return
      }
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
      } else if (cur.lock === 'dismiss') {
        const dy = t.clientY - cur.startY
        const { vy } = releaseVelocity([...cur.samples, { t: e.timeStamp, x: t.clientX, y: t.clientY }])
        // 확정이면 무대·배경은 그대로 두고 닫는다(언마운트로 사라짐) — 원위치 애니메이션이 닫힘 위로 보이지 않게.
        if (decideDismiss({ dy, vy, height: stage.clientHeight })) o.onDismiss()
        else settle()
      } else if (cur.lock === 'pending' && e.touches.length === 0 && isTapDuration(cur.samples[0].t, e.timeStamp)) {
        // 판정 임계(6px) 안에서 짧게(500ms 미만) 끝난 터치 = 탭. 길게 누르기는 탭이 아니다.
        handleTap({ t: e.timeStamp, x: t.clientX, y: t.clientY })
        return
      }
      // 탭이 아닌 제스처(넘김·닫기·스크롤·길게 누르기)가 끼면 두 번 탭 판정을 끊는다.
      lastTap = null
    }
    const onCancel = () => {
      if (moving(track)) settle()
      // 취소된 핀치는 확정하지 않고 미리보기만 걷어낸다.
      if (track?.kind === 'pinch') clearPinchPreview()
      track = null
      lastTap = null
    }
    // 터치 도중 시작 대상이 DOM 에서 빠지는 경우(넘긴 직후 로딩 뼈대가 이미지로 바뀌는 등) — 이후 touchmove/end 는
    // 떨어져 나간 그 요소로만 가고 무대까지 버블링되지 않아 탭·스와이프를 잃는다(끝난 줄 모르고 track 도 남음).
    // 그래서 시작 대상에도 리스너를 걸되, 그 요소가 문서에서 빠진 뒤의 이벤트만 처리한다(붙어 있으면 무대 리스너가 받으므로 중복 없음).
    const watched = new Set<EventTarget>()
    const whenDetached =
      <E extends TouchEvent>(fn: (e: E) => void) =>
      (e: E) => {
        if (!(e.currentTarget as Node).isConnected) fn(e)
      }
    /** 손을 모두 떼면 이번 묶음의 시작 대상 감시를 푼다. */
    const onEndWatched = (e: TouchEvent) => {
      onEnd(e)
      if (e.touches.length === 0) unwatchAll()
    }
    const onCancelWatched = (e: TouchEvent) => {
      onCancel()
      if (e.touches.length === 0) unwatchAll()
    }
    const detachedMove = whenDetached(onMove)
    const detachedEnd = whenDetached(onEndWatched)
    const detachedCancel = whenDetached(onCancelWatched)
    function unwatchAll() {
      for (const t of watched) {
        t.removeEventListener('touchmove', detachedMove as EventListener)
        t.removeEventListener('touchend', detachedEnd as EventListener)
        t.removeEventListener('touchcancel', detachedCancel as EventListener)
      }
      watched.clear()
    }
    const onStartWatched = (e: TouchEvent) => {
      // 손을 모두 뗀 상태에서 새로 시작하면 지난 묶음의 감시는 버린다.
      if (e.touches.length === 1) unwatchAll()
      const t = e.target
      if (t && t !== stage && !watched.has(t)) {
        watched.add(t)
        t.addEventListener('touchmove', detachedMove as EventListener, { passive: false })
        t.addEventListener('touchend', detachedEnd as EventListener)
        t.addEventListener('touchcancel', detachedCancel as EventListener)
      }
      onStart(e)
    }
    stage.addEventListener('touchstart', onStartWatched, { passive: true })
    stage.addEventListener('touchmove', onMove, { passive: false })
    stage.addEventListener('touchend', onEndWatched)
    stage.addEventListener('touchcancel', onCancelWatched)
    return () => {
      stage.removeEventListener('touchstart', onStartWatched)
      stage.removeEventListener('touchmove', onMove)
      stage.removeEventListener('touchend', onEndWatched)
      stage.removeEventListener('touchcancel', onCancelWatched)
      unwatchAll()
      stage.style.transform = ''
      stage.style.transition = ''
      stage.style.transformOrigin = ''
      clearTimeout(tapTimer)
      if (backdrop) backdrop.style.opacity = ''
    }
  }, [stage, enabled, backdropEl])
}

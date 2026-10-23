// 패널 경계선 손잡이로 폭을 바꾸는 공용 훅 — 앱 왼쪽 목록(ResizableSidebar, WP-878)·AI 사이드 패널(WP-892)이 함께 쓴다.
// 손잡이 요소에 펼칠 props(분할선 접근성·포인터 끌기·키보드·두 번 누르기)를 돌려준다. 폭 상태·저장은 호출처가 맡는다.
import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react'

import { clampWidth } from '@/lib/clampWidth'

/** 키보드(←→) 한 번에 바뀌는 폭. */
const KEY_STEP = 16
/** 이만큼(px) 움직여야 끌기로 본다 — 클릭·두 번 누르기의 손떨림이 폭을 저장하지 않게. */
const DRAG_THRESHOLD = 2
/**
 * 끄는 동안 body 에 붙는 표식 — 패널 폭을 따라 움직이는 요소(AI 칩 등)는 index.css 의 `panel-resizing:` 변형으로
 * 끄는 동안 transition 을 꺼 경계선을 늦게 따라오지 않게 한다. 이름을 바꾸면 index.css 의 @custom-variant 도 함께 바꾼다.
 */
const RESIZING_ATTR = 'data-panel-resizing'

/**
 * 손잡이 공통 모양 — 보이는 선은 4px, 잡는 영역은 투명 ::after 로 좌우 4px 씩 넓힌다.
 * touch-none: 데스크톱 화면의 터치 끌기(iPad 가로 등)가 스크롤·뒤로가기 제스처로 가로채이지 않게. 위치(left/right)는 호출처가 붙인다.
 */
export const resizeHandleClass =
  "absolute top-0 z-10 h-full w-1 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:-inset-x-1 after:content-[''] hover:bg-primary/20 focus-visible:bg-primary/40 active:bg-primary/30"

interface ResizeHandleOptions {
  /** 손잡이가 패널의 어느 쪽 경계에 있나 — right(왼쪽에 붙은 목록): 오른쪽으로 끌면 넓어짐, left(오른쪽에 붙은 패널): 왼쪽으로 끌면 넓어짐. */
  edge: 'left' | 'right'
  /** 지금 폭(상태) — aria-valuenow. */
  width: number
  min: number
  /** 최대 폭(고정) — aria-valuemax. */
  max: number
  /** 지금 화면의 상한 — 앱 영역에 따라 max 보다 작아질 수 있다. 끌기·키보드에서만 읽는다(렌더 중 레이아웃 읽기 없음). 없으면 max. */
  cap?: () => number
  /** 두 번 누르면 돌아갈 기본 폭. */
  defaultWidth: number
  /** 끄는 동안의 폭(프레임당 한 번) — 저장하지 않는다. 상태 대신 DOM 만 바꿔도 된다(넓은 트리 재렌더를 피할 때). */
  onPreview: (width: number) => void
  /** 확정 폭(손을 뗌·키보드·두 번 누르기·끄는 도중 끝남) — 저장한다. */
  onCommit: (width: number) => void
  /** 스크린리더용 손잡이 이름. */
  label: string
}

/**
 * 손잡이 요소에 펼칠 props 를 만든다. 손잡이는 폭이 바뀌는 패널(틀)의 직계 자식이어야 한다 — 끌기·키보드는 그 부모의
 * 실제로 보이는 폭(CSS 상한·애니메이션 중이면 상태 폭과 다르다)에서 시작한다. 끄는 도중 언마운트되면 body 를 되돌리고 끈 폭을 확정한다.
 */
export function useResizeHandle({
  edge,
  width,
  min,
  max,
  cap = () => max,
  defaultWidth,
  onPreview,
  onCommit,
  label,
}: ResizeHandleOptions) {
  // 진행 중인 끌기를 끝내는 함수 — 손잡이가 든 컴포넌트가 언마운트될 때도 부른다.
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])

  // 오른쪽 경계 손잡이는 마우스가 오른쪽으로 갈수록, 왼쪽 경계 손잡이는 왼쪽으로 갈수록 넓어진다.
  const dir = edge === 'right' ? 1 : -1
  /** 손잡이의 부모(패널)가 지금 보이는 폭을 그 화면의 범위로 맞춘 값. */
  const visibleWidth = (handle: HTMLElement, hi: number) =>
    clampWidth(handle.parentElement?.getBoundingClientRect().width ?? width, min, hi)

  // 포인터를 손잡이에 캡처해, 메일 본문·미리보기 iframe 위에서 움직이거나 손을 떼도 이벤트가 손잡이로(→ window 로 버블) 온다.
  // 리스너는 window·document 에 단다 — 끄는 도중 손잡이만 DOM 에서 빠져도(AI 패널이 Esc·⌘K 로 닫힘 등, 컴포넌트는 그대로)
  // 캡처가 풀린 lostpointercapture 는 document 로, 이후 pointerup 은 window 로 와서 끌기가 반드시 끝난다.
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const hi = cap()
    const startWidth = visibleWidth(e.currentTarget, hi)
    let last = startWidth
    let moved = false
    let frame = 0
    // 끄는 동안 본문(노트 편집기 등) 글자가 선택되지 않게, 커서가 경계선을 벗어나도 리사이즈 커서를 유지한다.
    const body = document.body
    const prevCursor = body.style.cursor
    const prevSelect = body.style.userSelect
    body.style.cursor = 'col-resize'
    body.style.userSelect = 'none'
    body.setAttribute(RESIZING_ATTR, '')
    // 무거운 본문(노트 편집기·캘린더 격자) 재배치를 줄이려 폭 갱신은 프레임당 한 번.
    const move = (ev: globalThis.PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return
      moved = true
      last = clampWidth(startWidth + dir * (ev.clientX - startX), min, hi)
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        onPreview(last)
      })
    }
    // 끈 폭을 확정한다(pointerup·pointercancel·캡처 풀림·언마운트 중 먼저 온 것 한 번). 움직이지 않았거나 제자리면 확정하지 않는다.
    const finish = () => {
      if (endDrag.current !== finish) return
      endDrag.current = null
      cancelAnimationFrame(frame)
      body.style.cursor = prevCursor
      body.style.userSelect = prevSelect
      body.removeAttribute(RESIZING_ATTR)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.removeEventListener('lostpointercapture', finish)
      if (moved && last !== startWidth) onCommit(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    document.addEventListener('lostpointercapture', finish)
    endDrag.current = finish
  }

  // 분할선 키보드 관례(WAI-ARIA window splitter): ←→ 로 경계선을 한 칸 옮기고, Home 최소, End 그 화면의 최대.
  // 조합 키(Alt+← 뒤로가기, ⌘← 등)는 브라우저·OS 단축키라 가로채지 않는다.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
    const hi = cap()
    const now = visibleWidth(e.currentTarget, hi)
    const next =
      e.key === 'ArrowLeft' ? now - dir * KEY_STEP
      : e.key === 'ArrowRight' ? now + dir * KEY_STEP
      : e.key === 'Home' ? min
      : e.key === 'End' ? hi
      : null
    if (next === null) return
    e.preventDefault()
    onCommit(clampWidth(next, min, hi))
  }

  return {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': label,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': width,
    tabIndex: 0,
    title: '끌어서 폭 조절 · 두 번 눌러 원래 폭으로',
    onPointerDown,
    onKeyDown,
    onDoubleClick: () => onCommit(defaultWidth),
  } as const
}

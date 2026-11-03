// 일정 끌어 옮기기(WP-1328) 제스처 훅 — 월 보기 칸·주/일 보기 종일 줄·시간 그리드가 함께 쓴다.
// 시간 구간 끌어 만들기(TimeGrid, WP-949)와 같은 생 포인터 이벤트 방식이다: 마우스·펜만, 4px 넘게 움직여야 끌기로 보고
// 그때 포인터를 붙잡는다(누르자마자 붙잡으면 움직이지 않은 클릭이 흔들린다). 놓을 자리는 포인터 아래 요소의 data-move-day 로 찾는다.
import { parse } from 'date-fns'
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'

import { DRAG_THRESHOLD_PX } from '@/lib/calendar'
import { type MovedRange, moveTimedInGrid, moveToDay } from '@/lib/calendarMove'
import type { CalendarEvent } from '@/types/calendar'

// 끌기를 마친 뒤 그 제스처의 click 을 막아 두는 시간(ms) — click 이 오지 않은 채 남은 막음이 한참 뒤의 클릭(새 일정 만들기 등)을 삼키지 않게.
const SUPPRESS_CLICK_MS = 600

/**
 * 끄는 방식 — day: 날짜 칸 사이(월 보기 칸·종일 줄), grid: 시간 그리드 열 사이(날짜 + 30분 칸).
 * 놓을 자리 요소는 `data-move-day="yyyy-MM-dd"` 와 `data-move-kind` 를 단다 — 같은 방식의 자리에만 놓인다(종일 ↔ 타임드 바꾸지 않음).
 */
export type MoveKind = 'day' | 'grid'

/** 끄는 중 화면에 그릴 미리보기 — 어떤 일정이 어디로(range, 제자리면 null) 갈지. */
export interface MovePreview {
  event: CalendarEvent
  range: MovedRange | null
}

interface MoveDrag {
  event: CalendarEvent
  kind: MoveKind
  fromDay: Date
  startX: number
  startY: number
  /** 누른 점의 y — 잡은 열 맨 위 기준(px). 열마다 같은 높이라 놓은 열의 y 와 빼면 옮긴 거리다(스크롤해도 맞다). */
  startColumnY: number
  moved: boolean
  /** Esc 로 취소한 끌기 — 놓아도 저장하지 않고, 그 제스처의 click 도 일정을 열지 않는다. */
  cancelled?: boolean
  range: MovedRange | null
}

/** 포인터 아래 놓을 자리 요소 — 미리보기는 pointer-events-none 이라 걸리지 않는다. jsdom 엔 elementFromPoint 가 없을 수 있다. */
function dropTargetAt(x: number, y: number, kind: MoveKind): HTMLElement | null {
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
  const el = hit?.closest<HTMLElement>('[data-move-day]') ?? null
  return el && el.dataset.moveKind === kind ? el : null
}

/** data-move-day 값(yyyy-MM-dd) → 로컬 자정 Date */
function parseMoveDay(value: string): Date {
  return parse(value, 'yyyy-MM-dd', new Date())
}

/**
 * 일정 칩·블록에 붙일 끌기 처리기와 미리보기 상태를 돌려준다.
 * - bind(event, fromDay, kind): 그 일정 버튼에 펼쳐 넣을 포인터 처리기. 옮길 수 없는 일정(canMove=false)·터치·오른쪽 버튼은 끌지 않는다.
 * - consumeClick(): 끌기를 마친 같은 제스처의 click 이면 true(한 번만) — 버튼·칸 onClick 이 먼저 불러 일정 열기·새 일정을 막는다.
 * - preview: 끄는 중이면 일정과 놓일 범위 — 뷰가 놓일 자리에 반투명 사본을 그리고 원래 자리는 흐리게 둔다.
 */
export function useEventMoveDrag({
  onMoveEvent,
  canMoveEvent,
}: {
  onMoveEvent?: (event: CalendarEvent, range: MovedRange) => void
  canMoveEvent?: (event: CalendarEvent) => boolean
}) {
  const [preview, setPreview] = useState<MovePreview | null>(null)
  // 처리기는 ref 의 최신 값을 읽는다 — 빠르게 끌면 다시 그리기 전에 pointerup 이 온다(만들기 끌기와 같은 이유).
  const dragRef = useRef<MoveDrag | null>(null)
  // 끌기를 마친 시각 — 그 직후(SUPPRESS_CLICK_MS 안) 같은 제스처의 click 이 일정을 열거나 새 일정을 만들지 않게 막는다. 0 이면 막지 않는다.
  const suppressClickRef = useRef(0)

  const setDrag = (next: MoveDrag | null) => {
    dragRef.current = next
    setPreview(next?.moved && !next.cancelled ? { event: next.event, range: next.range } : null)
  }

  const consumeClick = () => {
    const at = suppressClickRef.current
    suppressClickRef.current = 0
    return at !== 0 && Date.now() - at < SUPPRESS_CLICK_MS
  }

  // 끄는 중 Esc — 끌기를 취소한다(놓아도 저장하지 않는다). 미리보기가 있을 때만 듣는다.
  const dragging = preview != null
  useEffect(() => {
    if (!dragging) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !dragRef.current) return
      ev.preventDefault()
      setDrag({ ...dragRef.current, cancelled: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragging])

  const bind = (event: CalendarEvent, fromDay: Date, kind: MoveKind) => ({
    onPointerDown: (ev: ReactPointerEvent<HTMLElement>) => {
      // 새 제스처마다 막음을 푼다 — 붙잡은 끌기 뒤엔 click 이 오지 않을 수도 있어 남은 막음이 다음 클릭을 삼키지 않게.
      suppressClickRef.current = 0
      // 터치는 스크롤과 겹쳐 끌지 않는다(만들기 끌기와 같은 이유). 오른쪽 버튼·옮길 수 없는 일정도.
      if (!onMoveEvent || ev.pointerType === 'touch' || ev.button !== 0) return
      if (canMoveEvent && !canMoveEvent(event)) return
      const column = ev.currentTarget.closest<HTMLElement>('[data-move-day]')
      const top = column?.getBoundingClientRect().top ?? 0
      setDrag({
        event,
        kind,
        fromDay,
        startX: ev.clientX,
        startY: ev.clientY,
        startColumnY: ev.clientY - top,
        moved: false,
        range: null,
      })
    },
    onPointerMove: (ev: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || drag.cancelled) return
      // 단추를 누르고 있지 않은데 끌기가 남아 있으면(칩 밖에서 놓아 pointerup 을 못 받음) 버린다 — 그냥 지나가는 포인터가 끌기를 잇지 않게.
      if (ev.buttons === 0) {
        setDrag(null)
        return
      }
      const moved =
        drag.moved ||
        Math.abs(ev.clientX - drag.startX) >= DRAG_THRESHOLD_PX ||
        Math.abs(ev.clientY - drag.startY) >= DRAG_THRESHOLD_PX
      if (!moved) return
      // 끌기가 시작되면 포인터를 이 버튼에 붙잡는다 — 칸 밖으로 끌어도 계속 받고, 놓은 뒤 click 도 이 버튼으로 온다.
      if (!drag.moved) ev.currentTarget.setPointerCapture?.(ev.pointerId)
      const target = dropTargetAt(ev.clientX, ev.clientY, drag.kind)
      // 놓을 자리 밖(그리드 밖·다른 방식의 칸)이면 마지막으로 가리킨 자리를 그대로 둔다.
      let range = drag.range
      if (target?.dataset.moveDay) {
        const toDay = parseMoveDay(target.dataset.moveDay)
        range =
          drag.kind === 'grid'
            ? moveTimedInGrid(
                drag.event,
                drag.fromDay,
                toDay,
                ev.clientY - target.getBoundingClientRect().top - drag.startColumnY,
              )
            : moveToDay(drag.event, drag.fromDay, toDay)
      }
      // 놓일 범위가 그대로면(같은 칸 안에서 움직임) 다시 그리지 않는다 — 월 보기 42칸을 포인터가 움직일 때마다 다시 계산하지 않게.
      if (drag.moved && range?.startsAt === drag.range?.startsAt && range?.endsAt === drag.range?.endsAt) return
      setDrag({ ...drag, moved: true, range })
    },
    onPointerUp: () => {
      const drag = dragRef.current
      if (!drag) return
      setDrag(null)
      if (!drag.moved) return // 움직이지 않았으면 click 이 일정을 연다.
      suppressClickRef.current = Date.now()
      // 제자리(range=null)·Esc 로 취소한 끌기는 저장하지 않는다.
      if (drag.range && !drag.cancelled) onMoveEvent?.(drag.event, drag.range)
    },
    onPointerCancel: () => setDrag(null),
  })

  return { bind, consumeClick, preview }
}

/** 미리보기 대상인 일정인가 — 반복 회차는 회차 날짜까지 같아야 같은 칩이다(원래 자리를 흐리게 그릴 때). */
export function isMovingEvent(preview: MovePreview | null, e: CalendarEvent): boolean {
  return preview != null && preview.event.id === e.id && (preview.event.occurrenceDate ?? null) === (e.occurrenceDate ?? null)
}

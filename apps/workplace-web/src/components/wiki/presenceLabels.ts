import type { CollabCursor } from '@smart-workplace/wiki-editor-schema/collab-protocol'

/**
 * 원격 커서 이름표 규칙(WP-292, 스펙 Q7 B안) — "움직일 때만 ~3초, hover/탭 시 다시 보임". 시각·좌표만 다루는 순수 로직이다.
 */

/** 이름표가 보이는 시간(ms) — 스펙 "~3초". */
export const LABEL_SHOW_MS = 3000
/** 마우스 hover 로 캐럿을 잡는 좌우 여유(px) — 마우스는 정밀하다. */
export const CARET_SLOP_MOUSE = 6
/** 터치 탭 좌우 여유(px) — 12px × 2 = 24px 폭(WCAG 2.5.8 최소 대상 크기, 스펙 "터치 영역은 캐럿보다 넓게"). */
export const CARET_SLOP_TOUCH = 12
/** 줄 위아래 여유(px) — 캐럿 높이보다 조금 넓게 잡는다. */
const VERTICAL_SLOP = 4

/** 접속자별 "이름표를 언제까지 보일지" 시계. */
export interface LabelClock {
  /** 지금부터 showMs 동안 보인다(움직임·hover·탭·목록에서 이동). */
  touch(id: number, now: number): void
  visible(id: number, now: number): boolean
  /** 다음에 이름표가 꺼지는 때까지 남은 ms — 타이머 하나로 다시 칠할 시점. 없으면 null. */
  nextChange(now: number): number | null
  /** 떠난 접속자 정리. */
  forget(id: number): void
}

export function createLabelClock(showMs = LABEL_SHOW_MS): LabelClock {
  const until = new Map<number, number>()
  return {
    touch: (id, now) => {
      until.set(id, now + showMs)
    },
    visible: (id, now) => (until.get(id) ?? 0) > now,
    nextChange: (now) => {
      let next: number | null = null
      for (const [id, t] of until) {
        if (t <= now) {
          until.delete(id)
          continue
        }
        if (next === null || t - now < next) next = t - now
      }
      return next
    },
    forget: (id) => {
      until.delete(id)
    },
  }
}

/**
 * 커서 비교 키 — anchor·head 가 같으면 같다. awareness 는 15초마다 같은 상태를 다시 보내고 user·aiMarkers 만 바뀌어도
 * change 를 내므로, 이 키가 바뀔 때 "움직였다" 로 본다(스펙 "움직일 때만"). 위치가 그대로인 문단 중간 타이핑은 cursor.seq 로 따로 본다
 * (wikiPresenceCursors).
 */
export function cursorSignature(cursor: CollabCursor | null): string {
  return cursor ? JSON.stringify([cursor.anchor, cursor.head]) : ''
}

/** 캐럿 하나의 화면 위치(가운데 x, 줄 위아래). */
export interface CaretBox {
  id: number
  x: number
  top: number
  bottom: number
}

/** 포인터 위치에서 가장 가까운 캐럿(좌우 slop, 같은 줄) — 없으면 null. 위젯에 포인터 이벤트를 켜지 않고 루트에서 판정한다. */
export function hitCaret(p: { x: number; y: number }, carets: CaretBox[], slop: number): number | null {
  let best: number | null = null
  let bestDx = Infinity
  for (const c of carets) {
    if (p.y < c.top - VERTICAL_SLOP || p.y > c.bottom + VERTICAL_SLOP) continue
    const dx = Math.abs(p.x - c.x)
    if (dx <= slop && dx < bestDx) {
      best = c.id
      bestDx = dx
    }
  }
  return best
}

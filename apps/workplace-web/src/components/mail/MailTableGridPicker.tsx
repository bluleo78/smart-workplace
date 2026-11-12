import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  /** 격자 한 변의 최대 칸 수(데스크톱 dock 6 · fill 8 · 모바일 6). */
  max: number
  /** 터치 모드 — 칸을 크게(44px) 하고 미리보기 없이 탭 한 번에 넣는다. */
  touch: boolean
  /** 고른 행·열 크기로 표를 넣는다. */
  onPick: (rows: number, cols: number) => void
}

/** 화살표 키 → [행, 열] 이동량. */
const ARROW_DELTA: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

/**
 * 메일 작성창의 표 넣기 격자(WP-1524).
 * 칸에 올리거나(호버) 끌어서 행×열을 고르고, 누르거나 놓으면 그 크기로 넣는다.
 * 키보드는 화살표로 미리보기를 옮기고 Enter 로 넣는다. 터치는 미리보기 없이 탭 = 넣기.
 */
export function MailTableGridPicker({ max, touch, onPick }: Props) {
  // 미리보기(호버·포커스) 중인 크기. 고르기 전에는 null.
  const [preview, setPreview] = useState<{ r: number; c: number } | null>(null)
  // 끌기 진행 여부 / 방금 pointerup 으로 이미 넣었는지(뒤따르는 click 중복 방지).
  const dragging = useRef(false)
  const picked = useRef(false)

  // 끌기가 격자 밖에서 끝나도(놓기·취소) 끌기 상태를 푼다 — 안 풀면 나중에 칸 위의 pointerup 이 클릭 없이 표를 넣는다.
  // 칸의 pointerup 은 버블링으로 window 에도 오므로, 칸 위에서 놓은 경우는 칸 핸들러가 먼저 넣고 여기서 한 번 더 풀 뿐이다.
  useEffect(() => {
    const stop = () => {
      dragging.current = false
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  const size = touch ? 'size-11' : 'size-5'
  const indexes = Array.from({ length: max }, (_, i) => i + 1)

  /** 화살표로 이웃 칸에 포커스를 옮긴다(포커스가 미리보기를 따라간다). */
  function move(e: React.KeyboardEvent<HTMLButtonElement>, r: number, c: number) {
    const d = ARROW_DELTA[e.key]
    if (!d) return
    e.preventDefault()
    const nr = Math.min(max, Math.max(1, r + d[0]))
    const nc = Math.min(max, Math.max(1, c + d[1]))
    const next = e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-row="${nr}"][data-col="${nc}"]`)
    next?.focus()
  }

  /**
   * 마우스·키보드 전용 핸들러(호버 미리보기·끌어 고르기). 터치는 미리보기 없이 탭(click) 한 번이라 하나도 달지 않는다.
   * 끌기가 칸 위에서 끝나면 pointerup 이 넣고, 뒤따르는 click 은 picked 로 막는다.
   */
  const mouseHandlers = (r: number, c: number) =>
    touch
      ? {}
      : {
          onPointerEnter: () => setPreview({ r, c }),
          onFocus: () => setPreview({ r, c }),
          onPointerDown: () => {
            dragging.current = true
            picked.current = false
          },
          onPointerUp: () => {
            // 끌어서 놓은 칸의 크기로 넣는다. 뒤따르는 click 은 picked 로 막는다.
            if (!dragging.current) return
            dragging.current = false
            picked.current = true
            // 실제 브라우저의 뒤따르는 click 은 칸이 아닌 공통 조상에 가서 flag 가 안 풀릴 수 있다 —
            // 같은 틱 뒤에 스스로 풀어, 이후의 선택이 삼켜지지 않게 한다.
            setTimeout(() => {
              picked.current = false
            }, 0)
            onPick(r, c)
          },
        }

  return (
    <div data-testid="mail-table-grid" className="flex flex-col gap-2 p-2">
      <div className="text-xs text-muted-foreground">{preview ? `표 넣기 — ${preview.r} × ${preview.c}` : '표 넣기'}</div>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${max}, minmax(0, auto))` }}
        onPointerLeave={() => setPreview(null)}
      >
        {indexes.flatMap((r) =>
          indexes.map((c) => {
            const active = !touch && preview != null && r <= preview.r && c <= preview.c
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                data-row={r}
                data-col={c}
                aria-label={`${r}행 ${c}열 표`}
                tabIndex={r === 1 && c === 1 ? 0 : -1}
                className={cn(size, 'rounded-sm border', active ? 'border-primary bg-primary/20' : 'border-border')}
                {...mouseHandlers(r, c)}
                onClick={() => {
                  if (picked.current) {
                    picked.current = false
                    return
                  }
                  onPick(r, c)
                }}
                onKeyDown={(e) => {
                  picked.current = false // 키보드 선택은 끌기 뒤 남은 flag 에 막히지 않는다.
                  move(e, r, c)
                }}
              />
            )
          }),
        )}
      </div>
    </div>
  )
}

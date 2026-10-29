// 둥근 토글 칩 줄 — AI 위임 작업의 이슈별 빠른 필터 칩(WP-377)과 AI별 상태 칩(WP-1201)이 함께 쓴다.
// 메일 「안 읽은 메일만」과 같은 둥근 토글 + 건수. 모바일은 줄바꿈 대신 가로 스크롤.
import { useLayoutEffect, useRef } from 'react'

import { revealInScrollX } from '@/lib/revealInScrollX'
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import { HIDE_SCROLLBAR } from '@/pages/projects/components/mobile/chipStyles'

export interface ToggleChip {
  /** testid 끝말 — 칩은 `${testIds.chip}-${key}`, 건수는 `${testIds.count}-${key}`. */
  key: string
  label: string
  on: boolean
  /** 건수 — 아직 못 받았으면 생략(숫자를 비운다). */
  count?: number
  onClick: () => void
}

export function ToggleChips({
  chips,
  label,
  testIds,
}: {
  chips: ToggleChip[]
  /** 칩 묶음의 접근성 이름(role=group). */
  label: string
  testIds: { row: string; chip: string; count: string }
}) {
  // WP-676: 켜진 칩이 줄 밖(모바일 가로 스크롤)에 있으면 그 칩까지 줄을 굴린다 — 「완료」·「다음 회차 대기」로 열면 어떤 보기인지 안 보였다.
  // 켜진 칩이 바뀔 때 맞추고, 그 뒤 칩 폭이 바뀌면(건수 도착·웹폰트 적용) 다시 맞춘다 — 한 번만 맞추면 늦게 넓어진 칩에
  // 다시 밀려 잘렸다. 사용자가 손으로 굴리는 것은 칩 폭을 바꾸지 않으므로 되돌리지 않는다. 데스크톱처럼 다 보이면 아무것도 하지 않는다.
  const rowRef = useRef<HTMLDivElement>(null)
  const onKey = chips.find((c) => c.on)?.key
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const reveal = () => {
      const on = row.querySelector<HTMLElement>('[aria-pressed="true"]')
      if (on) revealInScrollX(row, on)
    }
    reveal()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(reveal)
    for (const chip of Array.from(row.children)) ro.observe(chip)
    return () => ro.disconnect()
  }, [onKey])

  // 모바일은 py-2 로 칩 터치 영역(::after)이 스크롤 영역에 잘리지 않게 하고 -my-2 로 레이아웃 높이는 그대로 둔다.
  return (
    <div
      ref={rowRef}
      className={cn('flex items-center gap-2 overflow-x-auto max-lg:-my-2 max-lg:py-2', HIDE_SCROLLBAR)}
      role="group"
      aria-label={label}
      data-testid={testIds.row}
    >
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={c.on}
          data-testid={`${testIds.chip}-${c.key}`}
          onClick={c.onClick}
          className={cn(
            // 보이는 높이는 시안대로 h-7(28px) — 모바일은 보이지 않는 ::after 를 위아래 8px 넓혀 터치 44px(디자인 시스템 I).
            'relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
            "max-lg:after:absolute max-lg:after:inset-x-0 max-lg:after:-inset-y-2 max-lg:after:content-['']",
            c.on ? cn(TOGGLE_ON_CLASS, 'font-medium') : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          {c.label}
          {c.count != null && (
            <span className={cn('tabular-nums', c.on ? 'text-primary' : 'text-muted-foreground')} data-testid={`${testIds.count}-${c.key}`}>
              {c.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

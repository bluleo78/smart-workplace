// 캘린더 팔레트 색 고르기 줄 (WP-801) — 캘린더 편집·태그 편집 다이얼로그와 일정 폼의 색 팝오버가 같이 쓴다.
// 세 곳이 같은 8색 원을 따로 그리며 선택 표시(테두리·링)와 aria 가 조금씩 달랐다 — 모양·선택 표시·aria-pressed 를 한곳에 둔다.
import { PALETTE_KEYS, resolvePalette } from '@/lib/calendarPalette'
import { cn } from '@/lib/utils'

/** 선택된 원의 표시 — 바깥 링(배경색 간격 + ring 색). 상속(점선) 원도 같은 표시라 「무엇이 골라졌나」가 한눈에 같다. */
const SELECTED_RING = 'ring-2 ring-ring ring-offset-2 ring-offset-background'

interface PaletteSwatchesProps {
  /** 지금 고른 팔레트 키 — null 이면 「상속」(inherit 를 줬을 때만 의미가 있다) */
  value: string | null
  /** 원을 누르면 그 키(상속이면 null) */
  onChange: (next: string | null) => void
  /** 원마다 붙는 data-testid 앞부분 — `${testIdPrefix}${키}`, 상속은 `${testIdPrefix}inherit` (예: 'calendar-color-') */
  testIdPrefix: string
  /** 「상속」 원을 맨 앞에 둔다 — 일정 색처럼 「캘린더 색 따르기(null)」가 있는 자리에서만 */
  inherit?: { label: string }
  /** 원마다 title(마우스 툴팁)도 단다 — 팝오버처럼 이름표 없는 자리 */
  withTitle?: boolean
  className?: string
}

/** 팔레트 색 원 줄 — (선택) 상속 원 + 8색. 고른 원은 aria-pressed 와 바깥 링으로 표시한다. */
export function PaletteSwatches({
  value,
  onChange,
  testIdPrefix,
  inherit,
  withTitle = false,
  className,
}: PaletteSwatchesProps) {
  // 원 공통 — 7×7 둥근 단추, 키보드 포커스 링(선택 링과 같은 모양이라 offset 으로 구분)
  const base =
    'size-7 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {inherit && (
        <button
          type="button"
          data-testid={`${testIdPrefix}inherit`}
          aria-label={inherit.label}
          aria-pressed={value === null}
          title={withTitle ? inherit.label : undefined}
          onClick={() => onChange(null)}
          className={cn(
            base,
            'flex items-center justify-center border-2 border-dashed border-muted-foreground/40 text-[10px]',
            value === null && SELECTED_RING,
          )}
        >
          상속
        </button>
      )}
      {PALETTE_KEYS.map((k) => {
        const entry = resolvePalette(k)
        return (
          <button
            key={k}
            type="button"
            data-testid={`${testIdPrefix}${k}`}
            aria-label={entry.label}
            aria-pressed={value === k}
            title={withTitle ? entry.label : undefined}
            onClick={() => onChange(k)}
            className={cn(base, entry.dotClass, value === k && SELECTED_RING)}
          />
        )
      })}
    </div>
  )
}

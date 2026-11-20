// 기간 고르기 단추 묶음(WP-1822) — 값 하나를 고르는 분절 단추. 선택 상태는 aria-pressed 로 알린다.
import { cn } from '@/lib/utils'

/** 제네릭 값 T 를 고르는 단추 묶음. 접근성 이름('aria-label')은 필수 — 묶음이 무엇을 고르는지 알려야 한다. */
export function PeriodToggle<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  'aria-label': string
  className?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('inline-flex rounded-md border border-border p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs',
            value === o.value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

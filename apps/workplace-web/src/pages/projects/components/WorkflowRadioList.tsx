// 시작할 워크플로우 라디오 목록(WP-1989) — 이름과 게시 버전(vN)을 한 줄씩. 시작 창과 담당 창 「지정하고 바로 시작」이 함께 쓴다.
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { WorkflowSummary } from '@/lib/workflows'

interface Props {
  workflows: WorkflowSummary[]
  /** 고른 워크플로우 id — 없으면 아무것도 고르지 않은 상태. */
  value: number | null
  onValueChange: (id: number) => void
  'aria-label'?: string
  className?: string
}

export function WorkflowRadioList({ workflows, value, onValueChange, 'aria-label': ariaLabel, className }: Props) {
  return (
    <RadioGroup
      aria-label={ariaLabel}
      value={value != null ? String(value) : ''}
      onValueChange={(v) => onValueChange(Number(v))}
      className={className}
    >
      {workflows.map((w) => (
        <label key={w.id} className="flex cursor-pointer items-center gap-2 text-sm">
          <RadioGroupItem value={String(w.id)} aria-label={`${w.name} v${w.activeVersionNo}`} />
          <span>{w.name}</span>
          <span className="text-xs text-muted-foreground">v{w.activeVersionNo}</span>
        </label>
      ))}
    </RadioGroup>
  )
}

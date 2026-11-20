// 사용률 막대(WP-1822) — 0~100% 한 줄 막대. AI 계정 사용량(AccountUsageCell)에서 옮겨 왔고 DOM 은 그대로다.
// 색은 tone(시맨틱 토큰)으로만 정하고, 너비는 0~100 으로 자른다.
import { type UsageBarTone, usageBarWidth } from '@/lib/agentAccountUsage'
import { cn } from '@/lib/utils'

/** 막대 색 → 채움 클래스(시맨틱 토큰만). */
const TONE_CLASS: Record<UsageBarTone, string> = {
  destructive: 'bg-destructive',
  warning: 'bg-warning',
  primary: 'bg-primary',
  // 초기화 시각이 지난 창 — 지난 값이라 경고 색 없이 흐리게.
  muted: 'bg-muted-foreground/40',
}

/** 사용률 막대. label 은 접근성 이름(예: 「5시간 사용률」). aria-valuenow 는 옛 막대와 같게 내림한 값. */
export function UsageMeter({ percent, tone, label, className }: { percent: number; tone: UsageBarTone; label: string; className?: string }) {
  const width = usageBarWidth(percent)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(width)}
      data-tone={tone}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className={cn('h-full rounded-full', TONE_CLASS[tone])} style={{ width: `${width}%` }} />
    </div>
  )
}

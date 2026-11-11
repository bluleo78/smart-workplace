// 개요 카드 공통 틀(WP-1484) — 개요 탭의 모든 위젯이 같은 표면·테두리·여백을 쓴다.
import { cn } from '@/lib/utils'

/** 개요 카드 — 카드 표면·테두리 토큰(DS 01). */
export function OverviewCard({ className, children, testId }: { className?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4', className)} data-testid={testId}>
      {children}
    </section>
  )
}

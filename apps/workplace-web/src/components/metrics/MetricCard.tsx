// 지표 카드 표면(WP-1822) — 숫자 카드·차트 카드·개요 카드가 같은 표면·테두리·여백(DS 01 카드 토큰)을 쓰게 하는 한 벌.
// 공용 부품이 pages/ 를 import 하지 않도록 표면은 여기에 두고, pages/me/overview/OverviewCard 가 이걸 위임해 쓴다.
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** 카드 표면 — rounded-lg border bg-card p-4. className 은 안쪽 간격 등 덧붙일 클래스, testId 는 data-testid. */
export function MetricCard({ className, children, testId }: { className?: string; children: ReactNode; testId?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4', className)} data-testid={testId}>
      {children}
    </section>
  )
}

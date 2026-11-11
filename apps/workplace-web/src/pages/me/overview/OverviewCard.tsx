// 개요 카드 공통 틀(WP-1484) — 개요 탭의 모든 위젯이 같은 표면·테두리·여백을 쓴다. 「직전 같은 기간」 비교 문구도 여기서 한 벌로 그린다.
import { IconHint } from '@/components/ui/icon-hint'
import { cn } from '@/lib/utils'

import { compareRangeLabel } from './overviewModel'

/** 개요 카드 — 카드 표면·테두리 토큰(DS 01). */
export function OverviewCard({ className, children, testId }: { className?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4', className)} data-testid={testId}>
      {children}
    </section>
  )
}

/**
 * 「직전 같은 기간 …」 비교 문구 — 올리거나 초점을 주면(터치는 탭) 실제 비교 날짜(「10월 21일~31일과 비교」)를 보인다.
 * 서버는 같은 길이의 바로 앞 기간과 비교해 「지난달」이 아니므로 날짜로 밝힌다. 숫자 카드·마감 준수가 같은 컴포넌트를 써 문구가 갈라지지 않게 한다.
 * 링크 안에 넣지 않는다 — 터치 기기에선 팝오버 단추가 되어 링크 안 단추가 된다.
 */
export function CompareHint({ from, to, value, testId }: { from: string; to: string; value: string; testId?: string }) {
  return (
    <IconHint label={compareRangeLabel(from, to)} data-testid={testId}>
      <span className="underline decoration-dotted underline-offset-2">직전 같은 기간 {value}</span>
    </IconHint>
  )
}

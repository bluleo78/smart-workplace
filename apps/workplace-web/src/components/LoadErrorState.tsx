// 불러오기 실패 상태 — 목록·본문이 첫 조회에 실패했을 때 빈 상태(「…이 없습니다」·「다 확인했습니다」)와 구분해 보인다(WP-865).
// 실패를 빈 상태로 그리면 사용자가 데이터가 사라졌다고 오해하거나 같은 것을 다시 만든다.
// - block: 본문 자리 — 빈 상태와 같은 배치(아이콘·제목·설명·액션)에 에러 아이콘(디자인 시스템 06 §B·§C).
// - inline: 사이드바·카드 안의 좁은 자리 — destructive 안내문 + outline 다시 시도(홈 WidgetError 와 같은 모양).
// - banner: 내용을 가리지 않고 위에 한 줄 — 실패해도 나머지 화면은 쓸 수 있을 때(캘린더 달력 위).
// 다시 부르는 동안은 버튼을 잠그고 돌린다 — 연타가 진행 중 요청을 끊고 다시 보내지 않게.
// 쿼리를 넘기면(queries) 다시 시도·잠금을 거기서 꺼낸다 — 실패한 쿼리들을 모두 다시 부르고, 하나라도 부르는 중이면 잠근다.

import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 다시 부를 쿼리 — useQuery 결과 그대로 넘긴다. */
type RetryableQuery = { isFetching: boolean; refetch: () => unknown }

/** 다시 시도 연결 — 쿼리를 넘기거나, 직접 onRetry·retrying 을 준다(쿼리가 아닌 곳: 홈 위젯 등). */
type RetryProps =
  | { queries: RetryableQuery[]; onRetry?: never; retrying?: never }
  | { queries?: never; onRetry: () => void; retrying?: boolean }

export function LoadErrorState({
  title,
  description = '일시적인 문제일 수 있어요. 잠시 뒤 다시 시도해 주세요.',
  queries,
  onRetry: onRetryProp,
  retrying: retryingProp = false,
  variant = 'block',
  className,
  testId,
}: {
  /** 「…을(를) 불러오지 못했습니다」 — 무엇이 실패했는지 화면 말로. */
  title: string
  /** block 에서만 보이는 보조 설명. */
  description?: string
  variant?: 'block' | 'inline' | 'banner'
  className?: string
  testId: string
} & RetryProps) {
  const onRetry = queries ? () => queries.forEach((q) => void q.refetch()) : onRetryProp
  const retrying = queries ? queries.some((q) => q.isFetching) : retryingProp
  const retry = (
    <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying} data-testid={`${testId}-retry`}>
      <RefreshCw className={cn('h-4 w-4', retrying && 'animate-spin')} aria-hidden="true" />
      다시 시도
    </Button>
  )
  if (variant === 'banner') {
    return (
      <div
        role="alert"
        className={cn('flex shrink-0 items-center gap-3 border-b bg-destructive/5 px-4 py-2 text-sm', className)}
        data-testid={testId}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-destructive">{title}</span>
        {retry}
      </div>
    )
  }
  if (variant === 'inline') {
    return (
      <div role="alert" className={cn('flex flex-col items-center gap-2 px-3 py-4 text-center', className)} data-testid={testId}>
        <p className="text-sm text-destructive">{title}</p>
        {retry}
      </div>
    )
  }
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}
      data-testid={testId}
    >
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {retry}
    </div>
  )
}

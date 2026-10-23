// 불러오기 실패 상태 — 목록·본문이 첫 조회에 실패했을 때 빈 상태(「…이 없습니다」·「다 확인했습니다」)와 구분해 보인다(WP-865).
// 실패를 빈 상태로 그리면 사용자가 데이터가 사라졌다고 오해하거나 같은 것을 다시 만든다.
// - block: 본문 자리 — 빈 상태와 같은 배치(아이콘·제목·설명·액션)에 에러 아이콘(디자인 시스템 06 §B·§C).
// - inline: 사이드바·카드 안의 좁은 자리 — destructive 안내문 + outline 다시 시도(홈 WidgetError 와 같은 모양).
// - banner: 내용을 가리지 않고 위에 한 줄 — 실패해도 나머지 화면은 쓸 수 있을 때(캘린더 달력 위).
// 다시 부르는 동안은 버튼을 잠그고 돌린다 — 연타가 진행 중 요청을 끊고 다시 보내지 않게.
// 잠금은 disabled 대신 aria-disabled·aria-busy + 누름 무시로 한다 — disabled 로 꺼지면 키보드 초점이 body 로 사라졌다(WP-881, WP-847 과 같은 기준).
// 다시 불러 성공해 안내가 사라질 때 초점이 다시 시도에 있었으면, 안내가 있던 자리 뒤(불러온 목록)의 첫 조작 요소로 옮긴다.
// 이 정리가 성공일 때만 돌도록, 쓰는 화면은 다시 부르는 동안에도 안내를 그대로 둔다(lib/queryFailure).
// 쿼리를 넘기면(queries) 다시 시도·잠금을 거기서 꺼낸다 — 실패한 쿼리들을 모두 다시 부르고, 하나라도 부르는 중이면 잠근다.

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 안내가 사라진 뒤 초점을 받을 수 있는 요소. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  const retryRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const button = retryRef.current
    const root = button?.closest<HTMLElement>(`[data-testid="${testId}"]`)
    // 정리 함수는 React 가 이 안내를 DOM 에서 떼기 전에 부른다 — 그래서 그 안에서 읽는 부모·앞 형제는 아직 떼기 전 자리다.
    return () => {
      const area = root?.parentElement
      if (!button || document.activeElement !== button || !area) return
      const before = root?.previousElementSibling ?? null
      // 새 내용이 그려진 뒤(다음 프레임) 초점을 옮긴다. 순서:
      // 1) 같은 자리에 아직 실패 안내가 있으면(일부만 성공해 배너로 바뀐 경우 등) 그 다시 시도.
      // 2) 안내가 있던 자리 뒤의 첫 조작 요소 — 머리말 버튼(＋ 등)보다 불러온 목록이 먼저다.
      // 3) 그 자리의 첫 조작 요소. 보이지 않는 요소(display:none 등)는 건너뛴다. 없으면 옮기지 않는다.
      requestAnimationFrame(() => {
        if (!area.isConnected) return
        const visible = (el: HTMLElement) => el.getClientRects().length > 0
        const stillFailing = area.querySelector<HTMLElement>('[data-load-error-retry]')
        if (stillFailing && visible(stillFailing)) {
          stillFailing.focus()
          return
        }
        const candidates = Array.from(area.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible)
        const after = before?.isConnected
          ? candidates.find((el) => !before.contains(el) && before.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
          : undefined
        ;(after ?? candidates[0])?.focus()
      })
    }
  }, [testId])
  const retry = (
    <Button
      ref={retryRef}
      variant="outline"
      size="sm"
      onClick={() => { if (!retrying) onRetry() }}
      aria-disabled={retrying || undefined}
      aria-busy={retrying || undefined}
      className={cn(retrying && 'cursor-progress opacity-50')}
      data-testid={`${testId}-retry`}
      data-load-error-retry=""
    >
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

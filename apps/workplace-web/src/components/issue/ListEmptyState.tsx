import type { LucideIcon } from 'lucide-react'

import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 빈 상태 다음 행동 버튼 하나. */
type EmptyStateAction = { label: string; onClick: () => void; testId: string }

/**
 * 목록 빈 상태(WP-919) — 디자인 시스템 empty state 4요소(아이콘·제목·설명·액션, DS 06 §B).
 * 프로젝트 목록의 IssueFilterEmptyState 도 이것을 감싼다. 내 작업·지켜보는 이슈·개인 목록이 함께 써
 * 「데이터 없음」과 「필터 0건 + 필터 지우기」를 같은 모양으로 그린다. 다음 행동이 있으면 action 으로 버튼을 준다.
 * 다음 행동이 둘이면(예: 필터 0건인데 완료도 숨긴 중 — 「필터 지우기」와 「완료 모두 보기」, WP-941) secondaryAction 으로 옆에 둔다.
 */
export function ListEmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  testId,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: EmptyStateAction
  /** 두 번째 다음 행동 — action 옆에 같은 모양으로 둔다. 좁은 폭에서는 줄을 바꾼다. */
  secondaryAction?: EmptyStateAction
  testId: string
  /** 바깥 여백 등 — 좌우 여백이 없는 칸(Page.Body padded=false)에 둘 때 px 를 더한다. */
  className?: string
}) {
  return (
    // min-w-0(바깥)·max-w-full(글 칸): 긴 낱말이 칸을 부모 폭 너머로 키우지 않게 — 그래야 break-words 가 끊는다(WP-1869).
    // 한국어는 어절 단위로(break-keep, WP-941), 띄어쓰기 없는 긴 값은 칸을 넘칠 때만(break-words) 끊는다.
    // wrap-anywhere 는 최소 폭을 0 으로 만들어 한국어가 글자 단위로 끊겨 쓰지 않는다(WP-1869).
    <EmptyState
      icon={Icon}
      title={title}
      description={description || undefined}
      grouped
      textClassName="max-w-full"
      descriptionClassName="break-keep break-words"
      className={cn('min-w-0 justify-center gap-3 py-16', className)}
      testId={testId}
      action={
        action || secondaryAction ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[action, secondaryAction].map(
              (a) =>
                a && (
                  <Button key={a.testId} variant="outline" size="sm" onClick={a.onClick} data-testid={a.testId}>
                    {a.label}
                  </Button>
                ),
            )}
          </div>
        ) : undefined
      }
    />
  )
}

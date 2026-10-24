import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** 빈 상태 다음 행동 버튼 하나. */
type EmptyStateAction = { label: string; onClick: () => void; testId: string }

/**
 * 목록 빈 상태(WP-919) — 디자인 시스템 empty state 4요소(아이콘·제목·설명·액션, DS 06 §B).
 * 프로젝트 목록의 IssueFilterEmptyState 도 이것을 감싼다. 내 작업·지켜보는 이슈·개인 목록이 함께 써
 * 「데이터 없음」과 「필터 0건 + 필터 초기화」를 같은 모양으로 그린다. 다음 행동이 있으면 action 으로 버튼을 준다.
 * 다음 행동이 둘이면(예: 필터 0건인데 완료도 숨긴 중 — 「필터 초기화」와 「완료 모두 보기」, WP-941) secondaryAction 으로 옆에 둔다.
 */
export function ListEmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  testId,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: EmptyStateAction
  /** 두 번째 다음 행동 — action 옆에 같은 모양으로 둔다. 좁은 폭에서는 줄을 바꾼다. */
  secondaryAction?: EmptyStateAction
  testId: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center" data-testid={testId}>
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {/* 한국어는 어절 단위로 줄을 바꾼다 — 좁은 폭에서 「있습/니다」처럼 끊기지 않게(WP-941). */}
        {description && <p className="break-keep text-xs text-muted-foreground">{description}</p>}
      </div>
      {(action || secondaryAction) && (
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
      )}
    </div>
  )
}

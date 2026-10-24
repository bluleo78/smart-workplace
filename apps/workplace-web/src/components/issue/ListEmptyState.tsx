import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * 목록 빈 상태(WP-919) — 디자인 시스템 empty state 4요소(아이콘·제목·설명·액션, DS 06 §B).
 * 레이아웃은 프로젝트 목록의 IssueFilterEmptyState 와 같다. 내 작업·지켜보는 이슈·개인 목록이 함께 써
 * 「데이터 없음」과 「필터 0건 + 필터 초기화」를 같은 모양으로 그린다. 다음 행동이 있으면 action 으로 버튼을 준다.
 */
export function ListEmptyState({
  icon: Icon,
  title,
  description,
  action,
  testId,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void; testId: string }
  testId: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center" data-testid={testId}>
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick} data-testid={action.testId}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

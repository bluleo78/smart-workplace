// 「완료 모두 보기」 토글 — 프로젝트 목록(IssueFilterBar)과 내 작업(MeTaskFilterBar)이 같은 모양·문구·testid 를 쓰게 한곳에 둔다.
import { CircleCheckBig } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ghostToggleClass } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

/**
 * 종료 이슈 숨김 기본 범위를 켜고 끄는 고스트 토글.
 * overridden — 상태·사이클 등 명시 필터가 이미 숨김을 풀었으면 눌린 상태로 비활성화한다(누를 의미가 없으므로).
 */
export function ShowAllClosedToggle({
  on,
  overridden,
  onToggle,
  className,
}: {
  /** closed=all 로 켜져 있는지 */
  on: boolean
  overridden: boolean
  onToggle: () => void
  /** 놓이는 자리에 따른 배치(예: ml-auto) */
  className?: string
}) {
  const pressed = on || overridden
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="show-all-closed-toggle"
      aria-pressed={pressed}
      disabled={overridden}
      onClick={onToggle}
      className={cn('transition-colors', ghostToggleClass(pressed), className)}
    >
      <CircleCheckBig aria-hidden="true" /> 완료 모두 보기
    </Button>
  )
}

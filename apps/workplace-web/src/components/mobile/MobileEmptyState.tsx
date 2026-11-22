// 모바일 전체 화면 빈 상태 공용 규격(U3-R11) — 알림 없음·메일 계정 없음이 같은 모양·위치를 쓴다.
// 아이콘 48px(muted) · 17px semibold 제목 · 14px 설명 · (선택) 44pt 주 버튼. 세로 가운데보다 살짝 위(pb-16)에 둔다 —
// 정확한 가운데는 하단 탭바·엄지 영역 때문에 시각적으로 낮아 보인다.
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { EmptyState } from '@/components/layout/EmptyState'
import { cn } from '@/lib/utils'

export function MobileEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  'data-testid': testId,
}: {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** 주 버튼(선택). 호출부가 44pt 버튼을 넘긴다. */
  action?: ReactNode
  /** 높이 채우기 방식 — 부모가 flex 열이면 flex-1, 스크롤 영역 안이면 h-full 등. */
  className?: string
  'data-testid'?: string
}) {
  return (
    <EmptyState
      size="mobile"
      icon={Icon}
      title={title}
      description={description}
      action={action != null ? <div className="mt-3">{action}</div> : undefined}
      className={cn('justify-center gap-2 px-8 pb-16', className)}
      testId={testId}
    />
  )
}

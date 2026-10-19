// 홈 대시보드 빈 상태(WP-520) — 보기 모드에서 보이는 위젯이 없을 때(모두 숨김), 편집 모드에서 위젯을 모두 지웠을 때.
// 빈 화면만 남기지 않고 다음 행동(편집 진입·위젯 추가)을 함께 준다(디자인 시스템 06 §B 일반 빈 상태).
// 모바일은 다른 모바일 전체 화면 빈 상태와 같은 규격(MobileEmptyState)을 쓴다.
import { LayoutGrid } from 'lucide-react'

import { MobileEmptyState } from '@/components/mobile/MobileEmptyState'
import { Button } from '@/components/ui/button'

interface Props {
  isMobile: boolean
  /** view = 저장된 위젯이 모두 숨김, edit = 편집 초안에 위젯이 하나도 없음. */
  mode: 'view' | 'edit'
  /** 주 버튼 — view 는 편집 진입, edit 는 위젯 추가 모달 열기. */
  onAction: () => void
}

const COPY = {
  view: {
    title: '보이는 위젯이 없습니다',
    description: '편집에서 숨긴 위젯을 다시 보이게 하거나 새 위젯을 추가해 보세요.',
    action: '홈 편집',
  },
  edit: {
    title: '위젯이 하나도 없습니다',
    description: '위젯이 하나 이상 있어야 저장할 수 있습니다. 위젯을 추가하거나 되돌리기로 지운 위젯을 살려 보세요.',
    action: '위젯 추가',
  },
} as const

export function DashboardEmptyState({ isMobile, mode, onAction }: Props) {
  const copy = COPY[mode]
  if (isMobile) {
    return (
      <MobileEmptyState
        data-testid="dashboard-empty"
        className="py-16"
        icon={LayoutGrid}
        title={copy.title}
        description={copy.description}
        action={
          <Button type="button" className="h-11" data-testid="dashboard-empty-action" onClick={onAction}>
            {copy.action}
          </Button>
        }
      />
    )
  }
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center"
      data-testid="dashboard-empty"
    >
      <LayoutGrid className="h-10 w-10 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="text-xs text-muted-foreground">{copy.description}</p>
      </div>
      <Button type="button" size="sm" data-testid="dashboard-empty-action" onClick={onAction}>
        {copy.action}
      </Button>
    </div>
  )
}

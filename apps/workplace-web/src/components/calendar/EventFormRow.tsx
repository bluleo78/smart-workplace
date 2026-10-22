// 일정 편집·새 일정 폼의 아이콘 줄 한 칸 (일정 편집 폼 배치 B — Google·Outlook·Notion 방식).
// 상세 보기(EventDetailView)와 같은 아이콘·같은 순서로 두어 보기 ↔ 수정을 오가도 자리가 그대로다.
// 이름표 대신 아이콘이 무엇의 줄인지 보이고, 각 입력은 aria-label 로 옛 이름표를 그대로 읽힌다.
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * 아이콘 + 내용 한 줄. 첫 줄 컨트롤은 h-8(32px) 기준이라 아이콘을 mt-2 로 내려 첫 줄 가운데에 맞춘다
 * — 칩 줄도 같은 첫 줄 높이를 잡아 둔다(FORM_CHIP_LINE_CLASS, EventTagsField·AttendeeSection).
 * 터치(거친 포인터)에선 컨트롤이 44px(h-11, WCAG 2.5.5)로 커지므로 아이콘도 mt-3.5 로 따라 내린다.
 */
export function EventFormRow({
  icon: Icon,
  children,
  testId,
  className,
}: {
  icon: LucideIcon
  children: ReactNode
  testId?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-3', className)} data-testid={testId}>
      {/* 아이콘은 꾸밈 — 무엇의 줄인지는 각 입력의 aria-label 이 읽힌다 */}
      <Icon className="mt-2 size-4 shrink-0 text-muted-foreground pointer-coarse:mt-3.5" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </div>
  )
}

/**
 * 아이콘 줄 안 칩 줄(참석자·태그) — 칩(22px) 위아래를 5px(터치 11px) 띄워 첫 줄 가운데가 입력 칸(h-8, 터치 h-11) 가운데와 같게 한다.
 * min-h 로 맞추면 칩이 두 줄로 꺾일 때 아이콘이 두 줄 사이로 내려갔다 — 패딩으로 맞춰 꺾여도 아이콘은 첫 줄에 붙는다.
 * 터치에선 줄 간격도 벌려 위아래 칩의 넓힌 터치 영역(DashedAddChip ::after)이 덜 겹치게 한다.
 */
export const FORM_CHIP_LINE_CLASS = 'flex flex-wrap items-center gap-1.5 py-[5px] pointer-coarse:gap-y-3 pointer-coarse:py-[11px]'

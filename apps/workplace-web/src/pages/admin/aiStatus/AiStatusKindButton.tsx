// 처리 종류 단추(WP-1825) — 표·카드의 키보드·보조기기 진입점. 행·카드 전체를 버튼으로 두면 안의 대상 링크와 중첩되므로(WP-1555) 종류 이름만 단추로 둔다.
import type { AiRunListItem } from '@/api/aiStatus'
import { aiRunKindLabel } from '@/lib/aiRunKindLabels'
import { cn } from '@/lib/utils'

/** 종류 이름 단추 — 누르면 상세 열기. 행·카드 onClick 과 겹쳐 두 번 열지 않게 전파를 막는다. */
export function AiStatusKindButton({
  item,
  onOpen,
  className,
}: {
  item: AiRunListItem
  onOpen: (item: AiRunListItem) => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn('rounded text-left focus-visible:ring-2 focus-visible:ring-ring', className)}
      aria-label={`${aiRunKindLabel(item.kind)} 처리 상세 보기`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(item)
      }}
    >
      {aiRunKindLabel(item.kind)}
    </button>
  )
}

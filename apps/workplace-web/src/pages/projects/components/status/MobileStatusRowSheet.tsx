// 모바일 상태 행 ⋯ 시트(WP-809) — 터치 끌기 대신 위로/아래로 이동을 두고, 편집·삭제를 같은 시트에 모은다.
// 범주 경계의 이동과 범주의 마지막 상태 삭제는 숨기지 않고 비활성으로 보여 이유를 알린다.
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'

import { MobileActionSheet } from '@/components/mobile/MobileActionSheet'
import type { ProjectStatus } from '@/types/projectStatus'

import { LAST_IN_CATEGORY_REASON, type StatusRowActions } from './StatusRow'

export function MobileStatusRowSheet({
  status,
  actions,
  onClose,
}: {
  /** 시트 대상 — null 이면 닫힘. */
  status: ProjectStatus | null
  actions: StatusRowActions | null
  onClose: () => void
}) {
  return (
    <MobileActionSheet
      open={status != null}
      onClose={onClose}
      title={status?.name ?? ''}
      testId="status-row-sheet"
      actions={
        actions
          ? [
              { key: 'status-edit', label: '편집', icon: <Pencil />, onSelect: actions.onEdit },
              {
                key: 'status-move-up',
                label: '위로 이동',
                icon: <ArrowUp />,
                disabled: !actions.onMoveUp,
                onSelect: () => actions.onMoveUp?.(),
              },
              {
                key: 'status-move-down',
                label: '아래로 이동',
                icon: <ArrowDown />,
                disabled: !actions.onMoveDown,
                onSelect: () => actions.onMoveDown?.(),
              },
              {
                key: 'status-delete',
                label: '삭제',
                icon: <Trash2 />,
                destructive: true,
                disabled: !actions.onDelete,
                // 막힌 이유를 행 오른쪽에 — 툴팁이 없는 터치에서도 보인다.
                hint: actions.onDelete ? undefined : LAST_IN_CATEGORY_REASON,
                onSelect: () => actions.onDelete?.(),
              },
            ]
          : []
      }
    />
  )
}

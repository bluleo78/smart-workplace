// 알림 목록(WP-1822) — 위험·주의·알림을 아이콘과 글자로 함께 보인다(색만으로 구분하지 않는다).
import { Info, OctagonAlert, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type AlertLevel = 'danger' | 'warning' | 'info'

export type AlertItem = { id: string; level: AlertLevel; label: ReactNode; action?: ReactNode }

/** 수준별 아이콘·글자 라벨·색 토큰. */
const LEVELS = {
  danger: { Icon: OctagonAlert, text: '위험', className: 'text-destructive' },
  warning: { Icon: TriangleAlert, text: '주의', className: 'text-warning' },
  info: { Icon: Info, text: '알림', className: 'text-muted-foreground' },
} as const

/** 항목마다 수준 아이콘+글자, 내용, 선택 동작. 비면 emptyLabel(기본 「이상 없음」). */
export function AlertList({ items, emptyLabel = '이상 없음' }: { items: AlertItem[]; emptyLabel?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  return (
    <ul role="list" className="divide-y divide-border">
      {items.map((item) => {
        const { Icon, text, className } = LEVELS[item.level]
        return (
          <li key={item.id} className="flex items-center gap-2 py-2 text-sm">
            <span className={cn('flex shrink-0 items-center gap-1 text-xs font-medium', className)}>
              <Icon className="h-4 w-4" aria-hidden />
              {text}
            </span>
            <span className="min-w-0 flex-1">{item.label}</span>
            {item.action}
          </li>
        )
      })}
    </ul>
  )
}

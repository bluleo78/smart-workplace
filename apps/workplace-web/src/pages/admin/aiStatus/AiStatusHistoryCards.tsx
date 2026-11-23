// 처리 이력 모바일 카드(WP-1825) — 표는 좁은 화면에 열이 넘쳐 처리 하나를 3줄 카드로 보인다.
// ① 종류 · 상태 배지 · 시각 ② 대상(이슈면 링크) ③ 실행 주체 · 처리 시간 · 토큰 · 오류(값 없는 조각은 뺀다).
import type { AiRunListItem } from '@/api/aiStatus'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatDurationMs } from '@/lib/formatters'

import { AiStatusActor } from './AiStatusActor'
import {
  runStatusBadge,
  runStatusLabel,
  runTimeText,
  tokensText,
} from './aiStatusHistoryModel'
import { AiStatusKindButton } from './AiStatusKindButton'
import { AiStatusRunTarget } from './AiStatusRunTarget'

/** 셋째 줄 조각(실행 주체 뒤) — 처리 시간·토큰·오류는 값이 없으면 뺀다. */
function detailParts(item: AiRunListItem): string[] {
  const hasTokens = item.inputTokens !== null || item.outputTokens !== null
  return [
    item.durationMs === null ? null : formatDurationMs(item.durationMs),
    hasTokens ? tokensText(item.inputTokens, item.outputTokens) : null,
    item.errorReason,
  ].filter((p): p is string => p !== null && p !== '')
}

/** 처리 이력 카드 목록 — 로딩 중이면 스켈레톤, 빈 목록 안내는 쓰는 쪽이 아래에 둔다. */
export function AiStatusHistoryCards({
  items,
  loading = false,
  onOpen,
}: {
  items: AiRunListItem[]
  loading?: boolean
  onOpen: (item: AiRunListItem) => void
}) {
  if (loading) {
    return (
      <div className='space-y-2'>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className='h-20 w-full' />
        ))}
      </div>
    )
  }
  return (
    <div className='space-y-2'>
      {items.map((item) => (
          <div
            key={item.id}
            data-testid='ai-run-card'
            className='space-y-1 rounded-md border p-3 focus-visible:ring-2 focus-visible:ring-ring'
            onClick={() => onOpen(item)}
          >
            <div data-line className='flex items-center gap-2'>
              {/* 카드 전체가 아니라 종류 이름이 키보드·보조기기 진입점이다 — 안의 대상 링크와 중첩되지 않게(WP-1555) */}
              <AiStatusKindButton item={item} onOpen={onOpen} className='font-medium' />
              <StatusBadge type={runStatusBadge(item.status)}>
                {runStatusLabel(item.status)}
              </StatusBadge>
              <span className='ml-auto whitespace-nowrap text-xs text-muted-foreground'>
                {runTimeText(item.startedAt)}
              </span>
            </div>
            <div data-line className='truncate text-sm'>
              <AiStatusRunTarget target={item.target} />
            </div>
            <div data-line className='truncate text-xs text-muted-foreground'>
              <AiStatusActor actor={item.actor} />
              {detailParts(item).map((p, i) => (
                <span key={i}> · {p}</span>
              ))}
            </div>
          </div>
      ))}
    </div>
  )
}

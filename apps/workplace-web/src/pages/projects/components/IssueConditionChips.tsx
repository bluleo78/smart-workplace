// 이슈 탭 조건 칩(WP-1478) — 「오래 멈춤」「기다리는 중」「마감 …」처럼 빠른 필터 facet 이 없는 조건을 지울 수 있는 칩으로 보인다.
// 데스크톱 필터 줄(빠른 필터 칩 뒤)과 모바일 툴바 칩 줄이 같은 컴포넌트를 쓴다 — 모양만 variant 로 다르다.
import { X } from 'lucide-react'

import type { IssueConditionChip, IssueConditionKey } from '@/lib/issueConditionChips'
import { cn } from '@/lib/utils'

import { HIT_EXPAND, MOBILE_CHIP_ACTIVE } from './mobile/chipStyles'

export function IssueConditionChips({
  chips,
  onRemove,
  variant = 'desktop',
}: {
  chips: IssueConditionChip[]
  onRemove: (key: IssueConditionKey) => void
  variant?: 'desktop' | 'mobile'
}) {
  if (chips.length === 0) return null
  return (
    <>
      {chips.map((c) =>
        variant === 'desktop' ? (
          // 걸린 빠른 필터 칩과 같은 모양(primary 틴트) — 본문은 누를 것이 없어 글만, × 로 이 조건만 지운다.
          <span
            key={c.key}
            className="inline-flex h-8 shrink-0 items-center rounded-md border border-primary/40 bg-primary/10 pl-2.5 text-sm font-medium whitespace-nowrap text-primary"
            data-testid={`condition-chip-${c.key}`}
          >
            {c.label}
            <button
              type="button"
              aria-label={`${c.label} 조건 지우기`}
              data-testid={`condition-chip-${c.key}-remove`}
              className="ml-1 inline-flex h-full items-center rounded-md px-1.5 hover:bg-primary/15"
              onClick={() => onRemove(c.key)}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ) : (
          <span
            key={c.key}
            className={cn('inline-flex h-8 shrink-0 items-center rounded-full border pl-3 text-sm whitespace-nowrap', MOBILE_CHIP_ACTIVE)}
            data-testid={`condition-chip-${c.key}`}
          >
            {c.label}
            <button
              type="button"
              aria-label={`${c.label} 조건 지우기`}
              data-testid={`condition-chip-${c.key}-remove`}
              className={cn(HIT_EXPAND, 'inline-flex h-full items-center pl-1 pr-2.5')}
              onClick={() => onRemove(c.key)}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ),
      )}
    </>
  )
}

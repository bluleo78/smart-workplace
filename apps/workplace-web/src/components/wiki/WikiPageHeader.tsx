import {
  Check,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Fragment } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/ui/status-badge'

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict'

/**
 * 노트 페이지 뷰 헤더 — 브레드크럼(조상 경로) + 저장상태 + 더보기(AI 초안·삭제).
 * PageHeader 와 동일한 셸(h-14·border-b)을 쓰되, 브레드크럼은 nav 시맨틱이 필요해 직접 구성한다.
 */
export function WikiPageHeader({
  crumbs,
  saveState,
  canUseAi,
  onNavigate,
  onDraft,
  onDelete,
}: {
  crumbs: { id: number; title: string }[]
  saveState: SaveState
  canUseAi: boolean
  onNavigate: (pageId: number) => void
  onDraft: () => void
  onDelete: () => void
}) {
  return (
    <header
      data-testid="wiki-page-header"
      className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4"
    >
      <nav className="flex min-w-0 items-center gap-1 text-sm" aria-label="페이지 경로">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={c.id}>
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              )}
              {last ? (
                <span className="truncate font-semibold text-foreground">{c.title}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(c.id)}
                  className="truncate text-muted-foreground hover:text-foreground"
                >
                  {c.title}
                </button>
              )}
            </Fragment>
          )
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        {saveState === 'saving' && (
          <StatusBadge type="info" data-testid="wiki-save-state">
            <Loader2 className="animate-spin" />
            저장 중…
          </StatusBadge>
        )}
        {saveState === 'saved' && (
          <StatusBadge type="success" data-testid="wiki-save-state">
            <Check />
            저장됨
          </StatusBadge>
        )}
        {saveState === 'conflict' && (
          <StatusBadge type="error" data-testid="wiki-save-state">
            <TriangleAlert />
            충돌
          </StatusBadge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="페이지 메뉴"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canUseAi && (
              <DropdownMenuItem onSelect={() => setTimeout(onDraft, 0)}>
                <Sparkles className="mr-2 h-4 w-4" /> AI 초안 작성
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(onDelete, 0)}>
              <Trash2 className="mr-2 h-4 w-4" /> 페이지 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

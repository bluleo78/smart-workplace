import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// 들여쓰기 1단계 폭(px) — 사이드바와 동일 값.
const INDENT = 16

/**
 * 노트 트리 행 — 접기 토글(자식 있을 때) + 제목(클릭=이동) + 호버 시 ＋(하위 생성)·⋯(삭제).
 * DnD 는 useSortable. PointerSensor distance:5 가 클릭과 드래그를 분리하므로 행 컨테이너에
 * listeners 를 두고, 내부 버튼은 stopPropagation 으로 이동/드래그와 분리한다.
 */
export function WikiTreeRow({
  id,
  title,
  aiAttributed,
  depth,
  hasChildren,
  collapsed,
  selected,
  onToggle,
  onOpen,
  onAddChild,
  onRequestDelete,
}: {
  id: number
  title: string
  // #736: 이 페이지에 AI 생성 이력이 있는지 — true 면 제목 옆에 AiSignalBadge 노출.
  aiAttributed: boolean
  depth: number
  hasChildren: boolean
  collapsed: boolean
  selected: boolean
  onToggle: (id: number) => void
  onOpen: (id: number) => void
  onAddChild: (id: number) => void
  onRequestDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Translate.toString(transform), transition }
  const label = title || '제목 없음'
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`wiki-tree-row-${id}`}
      className={`group relative flex items-center ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex w-full items-center" style={{ paddingLeft: depth * INDENT }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={collapsed ? '펼치기' : '접기'}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(id)
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onOpen(id)}
          className={`flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1 text-left text-sm hover:bg-accent ${
            selected ? 'bg-accent font-medium' : ''
          }`}
        >
          <span className="truncate">{label}</span>
          {aiAttributed && (
            <AiSignalBadge
              variant="info"
              reason="AI가 생성한 콘텐츠를 포함합니다"
              data-testid={`wiki-tree-ai-badge-${id}`}
              className="shrink-0"
            >
              AI
            </AiSignalBadge>
          )}
        </button>
        <div className="absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            aria-label="하위 페이지"
            onClick={(e) => {
              e.stopPropagation()
              onAddChild(id)
            }}
            className="flex h-6 w-6 items-center justify-center rounded bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="페이지 메뉴"
              onClick={(e) => e.stopPropagation()}
              className="flex h-6 w-6 items-center justify-center rounded bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setTimeout(() => onRequestDelete(id), 0)}
              >
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

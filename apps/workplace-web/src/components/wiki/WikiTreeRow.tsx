import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Trash2 } from 'lucide-react'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'

// 들여쓰기 1단계 폭(px) — 사이드바와 동일 값.
const INDENT = 16

/**
 * 노트 트리 행 — 접기 토글(자식 있을 때) + 제목(클릭=이동) + 호버 시 ＋(하위 생성)·⋯(삭제).
 * DnD 는 useSortable. PointerSensor distance:5 가 클릭과 드래그를 분리하므로 행 컨테이너에
 * listeners 를 두고, 내부 버튼은 stopPropagation 으로 이동/드래그와 분리한다.
 * 터치 기기(pointer: coarse)는 hover 가 없어 ＋·⋯ 클러스터에 닿을 수 없으므로 44px ⋯ 하나로 모은다(WP-237) —
 * 폭 <1024(휴대폰)는 액션 시트, ≥1024(태블릿)는 드롭다운. 마우스 데스크톱은 기존 hover 클러스터 그대로.
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
  // role: 'group' — dnd-kit 기본값(role="button")을 쓰면 행 안에 실제 button 3개(열기/자식추가/메뉴)가
  // 중첩되어 무효한 interactive-in-interactive 구조가 되고, accname 계산 시 세 버튼 이름이 하나로
  // 뒤섞여 낭독된다(#801). group 은 콘텐츠 기반 이름 계산을 하지 않아 자손 버튼과 충돌하지 않으면서도
  // tabIndex/키보드 리스너는 그대로 유지해 키보드 드래그(Space+화살표)는 그대로 동작한다.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    attributes: { role: 'group' },
  })
  const style = { transform: CSS.Translate.toString(transform), transition }
  const label = title || '제목 없음'
  const coarse = useIsCoarsePointer()
  // 삭제는 메뉴/시트가 닫힌 뒤 다이얼로그를 연다 — 닫히는 오버레이의 포커스 복귀·pointer-events 정리와 겹치지 않게.
  const requestDelete = () => setTimeout(() => onRequestDelete(id), 0)
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-label={label}
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
        {coarse ? (
          // 터치: 제목 옆 제자리(absolute 아님)에 ⋯ 하나 — 제목을 덮지 않는다(WP-237).
          // 행의 DnD 리스너로 이벤트가 새지 않게 isolateEvents 로 버블링을 끊는다.
          <TouchRowActionsMenu
            title={label}
            ariaLabel="페이지 메뉴"
            testId={`wiki-tree-more-${id}`}
            sheetTestId="wiki-tree-action-sheet"
            isolateEvents
            actions={[
              { key: 'wiki-add-child', label: '하위 페이지 추가', icon: <Plus />, onSelect: () => onAddChild(id) },
              { key: 'wiki-delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: requestDelete },
            ]}
          />
        ) : (
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
                <DropdownMenuItem variant="destructive" onSelect={requestDelete}>
                  삭제
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}

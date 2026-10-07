// 모바일 편집 모드 위젯 카드(WP-161 에서 Dashboard.tsx 로부터 분리).
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

import { cn } from '@/lib/utils'

import { MobileWidgetCard } from '../widgets/mobile/MobileWidgetCard'
import { EntryBody } from './EntryBody'
import { type CatalogConfigPatch, entryTitle, hasCountSelect, type ResolvedEntry } from './resolvedEntry'
import { WidgetCountSelect, WidgetEditControls } from './WidgetEditControls'

/**
 * 모바일 편집 카드(WP-142) — 보기 모드와 같은 카드 모양(펼친 본문·접힌 한 줄·타일 한 줄)을 유지하고 ⌃ 자리만
 * 편집 컨트롤로 바꾼다. 375px 에 데스크톱 컨트롤 6개는 넘치므로 ↑↓ 는 드래그로, "테두리 없음" 은 모바일 카드가
 * 항상 테두리를 쓰므로 노출하지 않는다. 모든 컨트롤은 44px 터치 대상.
 */
export function MobileEditableWidgetCard({
  entry,
  onToggleHidden,
  onCount,
  onApplyCatalogConfig,
  onRemove,
  cardRef,
  highlighted,
}: {
  entry: ResolvedEntry
  onToggleHidden: () => void
  onCount: (count: number) => void
  onApplyCatalogConfig: (patch: CatalogConfigPatch) => void
  onRemove: () => void
  cardRef: (el: HTMLDivElement | null) => void
  highlighted: boolean
}) {
  const title = entryTitle(entry)
  const { cfg } = entry
  // 드래그앤드랍 재배치 — 데스크톱과 같이 핸들에서만 드래그 시작(카드 내 다른 버튼과 제스처 분리).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cfg.id })
  // 핸들·숨김·설정·삭제 — 음수 여백으로 44px 터치 영역을 확보하면서 머리 높이는 시안대로 유지한다.
  const controls = (
    <div className="-my-2.5 -mr-2.5 flex shrink-0 items-center">
      <button
        type="button"
        className="flex size-11 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        data-testid="widget-drag-handle"
        aria-label={`드래그 핸들: ${title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <WidgetEditControls
        entry={entry}
        title={title}
        buttonClassName="size-11"
        onToggleHidden={onToggleHidden}
        onApplyCatalogConfig={onApplyCatalogConfig}
        onRemove={onRemove}
      />
    </div>
  )
  return (
    <MobileWidgetCard
      cfg={cfg}
      title={title}
      icon={entry.def.icon}
      mobile={entry.def.mobile}
      body={<EntryBody entry={entry} />}
      edit={{
        controls,
        // 항목 수(3/5/10)는 데스크톱 편집 카드와 같은 공용 선택기·같은 노출 조건. 해당 없으면 보조 줄 자체를 생략한다
        // (빈 줄 여백이 머리와 요약 사이에 끼지 않게).
        extra: hasCountSelect(entry) ? (
          <WidgetCountSelect entry={entry} title={title} onCount={onCount} size="mobile" />
        ) : undefined,
        frameRef: (el) => {
          setNodeRef(el)
          cardRef(el)
        },
        style: { transform: CSS.Translate.toString(transform), transition },
        // 강조(ring) 페이드·숨김/드래그 dim 은 데스크톱 편집 카드와 같은 규칙.
        className: cn(
          'transition-shadow duration-700 focus-visible:transition-none',
          (cfg.hidden || isDragging) && 'opacity-50',
          highlighted && 'ring-2 ring-ai-accent',
        ),
        hidden: cfg.hidden,
        justAdded: highlighted,
      }}
    />
  )
}

// 데스크톱 편집 모드 위젯 카드(WP-161 에서 Dashboard.tsx 로부터 분리).
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical, PanelTop, PanelTopClose } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { EntryBody } from './EntryBody'
import { type CatalogConfigPatch, entryTitle, isWideEntry, type ResolvedEntry } from './resolvedEntry'
import { WidgetCountSelect, WidgetEditControls } from './WidgetEditControls'

/** 편집 모드 위젯 카드 — 본문 + 표시/숨김·이동·(시스템)항목수/(카탈로그)설정·삭제 컨트롤. 숨김은 dimmed 로 잔류(재표시 경로). */
export function EditableWidgetCard({
  entry,
  index,
  total,
  onMove,
  onToggleHidden,
  onToggleChromeless,
  onCount,
  onApplyCatalogConfig,
  onRemove,
  cardRef,
  upRef,
  downRef,
  highlighted,
}: {
  entry: ResolvedEntry
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
  onToggleHidden: () => void
  onToggleChromeless: () => void
  onCount: (count: number) => void
  onApplyCatalogConfig: (patch: CatalogConfigPatch) => void
  onRemove: () => void
  // 포커스 복원용 ref(I2: 경계 이동 후 포커스 유지) — 카드/위·아래 버튼.
  cardRef: (el: HTMLDivElement | null) => void
  upRef: (el: HTMLButtonElement | null) => void
  downRef: (el: HTMLButtonElement | null) => void
  /** 방금 추가된 위젯이면 true — 테두리 강조 표시(4초 후 자동 해제, 타이밍은 useDashboardEditDraft 가 관리). */
  highlighted: boolean
}) {
  const Icon = entry.def.icon
  const title = entryTitle(entry)
  const { cfg } = entry
  // 드래그앤드랍 재배치 — 핸들(GripVertical)에서만 드래그 시작(카드 내 다른 버튼과 제스처 분리).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cfg.id,
  })
  const dragStyle = { transform: CSS.Translate.toString(transform), transition }
  // wide: 카운트 스트립·2x2 분면처럼 1/3 폭에 찌그러지는 시스템 위젯 — lg:col-span-3(전체 폭).
  const wide = isWideEntry(entry)
  return (
    <Card
      ref={(el) => {
        setNodeRef(el)
        cardRef(el)
      }}
      style={dragStyle}
      tabIndex={-1}
      // transition-shadow duration-700 은 강조 표시(ring-ai-accent) 페이드 인/아웃용. 다만 이 상태로는
      // 키보드 포커스 링(focus-visible:ring-2)도 같이 700ms 페이드 되어 포커스 이동이 굼떠 보이는 접근성
      // 회귀가 생긴다 — focus-visible:transition-none 으로 포커스 시에만 트랜지션을 무효화해 포커스 링은
      // 즉시 나타나게 하고, 강조 표시의 페이드 인/아웃(비-포커스 상태)은 그대로 유지한다.
      className={`border-l-2 border-l-ai-accent transition-shadow duration-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:transition-none${cfg.hidden ? ' opacity-50' : ''}${highlighted ? ' ring-2 ring-ai-accent' : ''}${wide ? ' lg:col-span-3' : ''}${isDragging ? ' opacity-50' : ''}`}
      data-testid="dashboard-widget"
      data-widget={cfg.type}
      data-widget-id={cfg.id}
      data-hidden={cfg.hidden}
      data-just-added={highlighted ? 'true' : undefined}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <button
              type="button"
              className="cursor-grab touch-none rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              data-testid="widget-drag-handle"
              aria-label={`드래그 핸들: ${title}`}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <Icon className="h-4 w-4" />
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              ref={upRef}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              data-testid="widget-move-up"
              aria-label={`위로 이동: ${title}`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              ref={downRef}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              data-testid="widget-move-down"
              aria-label={`아래로 이동: ${title}`}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <WidgetEditControls
              entry={entry}
              title={title}
              buttonClassName="size-8"
              onToggleHidden={onToggleHidden}
              onApplyCatalogConfig={onApplyCatalogConfig}
              onRemove={onRemove}
              afterHide={
                <Button
                  type="button"
                  variant={cfg.chromeless ? 'default' : 'ghost'}
                  size="icon"
                  className="size-8"
                  data-testid="widget-chromeless-toggle"
                  aria-label={cfg.chromeless ? `테두리·제목 표시: ${title}` : `테두리·제목 숨김: ${title}`}
                  aria-pressed={Boolean(cfg.chromeless)}
                  onClick={onToggleChromeless}
                >
                  {/* Eye/EyeOff 와 동일 관례 — 아이콘이 "현재 상태"를 나타낸다(테두리 있음/없음). */}
                  {cfg.chromeless ? (
                    <PanelTopClose className="h-4 w-4" />
                  ) : (
                    <PanelTop className="h-4 w-4" />
                  )}
                </Button>
              }
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <WidgetCountSelect entry={entry} title={title} onCount={onCount} />
        <EntryBody entry={entry} />
      </CardContent>
    </Card>
  )
}

// 위젯 추가 모달 — 좌: 카테고리, 중: 카드 목록, 우: 선택한 위젯의 라이브 프리뷰(목데이터).
// 카드 클릭은 선택(하이라이트)만 하고, 프리뷰 패널의 "+ 위젯 추가" 버튼을 눌러야 실제로 추가된다
// (예전엔 카드 클릭 = 즉시 추가였으나, 어떤 위젯인지 모르고 고르는 문제를 해결하기 위해 변경).
import { createElement, Suspense, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { CATALOG_CATEGORIES, type CatalogWidget } from './catalogRegistry'
import { getChatWidget } from './chatWidgetRegistry'
import { type DashboardWidget,getDashboardWidget } from './registry'
import { widgetPreviewFixtures } from './widgetPreviewFixtures'

const ALL_CATEGORY = '전체'
const SYSTEM_CATEGORY = '기본'

// 시스템 위젯 크기 라벨 — tall(행 2칸)·wide(그리드 전체 폭 3칸) 조합에 따라 실제 그리드 점유 크기를 표시.
function systemSizeLabel(w: DashboardWidget): string {
  const cols = w.wide ? 3 : 1
  const rows = w.tall ? 2 : 1
  return `${cols}×${rows}`
}

type CardEntry =
  | { kind: 'system'; widget: DashboardWidget }
  | { kind: 'catalog'; widget: CatalogWidget }

export function AddWidgetModal({
  open,
  onOpenChange,
  systemWidgets,
  catalogWidgets,
  disabled,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** draft 에 아직 없는 시스템 위젯만(싱글턴 재추가 경로). */
  systemWidgets: DashboardWidget[]
  /** 카탈로그 위젯 전체(항상 노출, 다중 추가 허용). */
  catalogWidgets: CatalogWidget[]
  /** 총 인스턴스 상한 도달 시 카드 클릭 비활성화. */
  disabled: boolean
  onAdd: (type: string) => void
}) {
  const [category, setCategory] = useState<string>(ALL_CATEGORY)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const categories = [ALL_CATEGORY, SYSTEM_CATEGORY, ...CATALOG_CATEGORIES]

  const visibleSystem: CardEntry[] =
    (category === ALL_CATEGORY || category === SYSTEM_CATEGORY ? systemWidgets : []).map((widget) => ({
      kind: 'system',
      widget,
    }))
  const visibleCatalog: CardEntry[] = (
    category === ALL_CATEGORY ? catalogWidgets : catalogWidgets.filter((w) => w.category === category)
  ).map((widget) => ({ kind: 'catalog', widget }))
  const visible = [...visibleSystem, ...visibleCatalog]

  // 카테고리를 바꾸면(또는 모달을 열면) 해당 목록의 첫 카드를 자동 선택 — 빈 프리뷰 상태 없음.
  useEffect(() => {
    if (!open) return
    setSelectedType(visible.length > 0 ? visible[0].widget.type : null)
    // category/open 변경 시에만 재선택. visible 은 category 에서 파생되므로 의존성에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category])

  const selectedEntry = visible.find((e) => e.widget.type === selectedType) ?? null

  function handleAdd() {
    if (disabled || !selectedType) return
    onAdd(selectedType)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent 기본 클래스가 sm:max-w-lg 라 breakpoint 없는 max-w-6xl 은 tailwind-merge 가
          다른 variant 그룹으로 취급해 덮어쓰지 못한다(512px 로 눌린 채 lg:flex-row 만 켜져 3단이
          찌그러지는 원인) — 반드시 동일 variant(sm:)로 지정해야 실제로 덮어써진다. */}
      <DialogContent className="sm:max-w-6xl" data-testid="add-widget-modal">
        <DialogHeader>
          <DialogTitle>위젯 추가</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex shrink-0 gap-1 overflow-x-auto lg:w-32 lg:flex-col lg:overflow-visible lg:space-y-1" data-testid="add-widget-categories">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`shrink-0 rounded-md px-2 py-1.5 text-left text-sm ${
                  category === c
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
                data-testid="add-widget-category"
                data-category={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div
            className="flex w-full max-h-56 shrink-0 flex-col gap-2 overflow-y-auto lg:w-56 lg:max-h-[70vh]"
            data-testid="add-widget-grid"
          >
            {visible.map(({ kind, widget }) => {
              const Icon = widget.icon
              const selected = widget.type === selectedType
              return (
                <button
                  key={widget.type}
                  type="button"
                  className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected ? 'border-ai-accent bg-ai-accent/5' : 'hover:border-ai-accent'
                  }`}
                  data-testid="add-widget-card"
                  data-widget-type={widget.type}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => setSelectedType(widget.type)}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">{widget.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {kind === 'system' ? `기본 위젯 · ${systemSizeLabel(widget)}` : `${widget.category} · ${widget.size}`}
                  </span>
                </button>
              )
            })}
            {visible.length === 0 && (
              <p className="text-sm text-muted-foreground">이 카테고리에 추가할 수 있는 위젯이 없습니다.</p>
            )}
          </div>
          <div className="flex min-h-[24rem] flex-1 flex-col" data-testid="add-widget-preview">
            {selectedEntry ? (
              <>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">미리보기</div>
                <div className="mb-1 text-base font-bold">{selectedEntry.widget.title}</div>
                <p className="mb-3 text-xs text-muted-foreground">{selectedEntry.widget.description}</p>
                <div className="flex-1 overflow-y-auto rounded-md border p-3">
                  <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                    <PreviewBody entry={selectedEntry} />
                  </Suspense>
                </div>
                <Button className="mt-3 self-end" disabled={disabled} onClick={handleAdd} data-testid="add-widget-confirm">
                  + 위젯 추가
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">왼쪽 목록에서 위젯을 선택하세요.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 선택된 위젯을 실제 컴포넌트로 렌더 — 카탈로그는 chatWidgetRegistry, 시스템은 registry 를 그대로 재사용.
// previewData 를 주입해 실제 API 호출 없이 목데이터로 즉시 렌더한다(각 위젯 컴포넌트가 자체 지원).
function PreviewBody({ entry }: { entry: CardEntry }) {
  const previewData = widgetPreviewFixtures[entry.widget.type]
  // JSX(`<Component .../>`)로 렌더하면 react-hooks/static-components 가 "렌더 중 컴포넌트 생성"으로 오탐(false
  // positive)한다 — 레지스트리 조회는 매 호출 동일 lazy 참조를 반환할 뿐 신규 생성이 아니다.
  // createElement 로 우회(Dashboard.tsx CatalogWidgetBody 의 동일 패턴과 동등한 동작).
  if (entry.kind === 'catalog') {
    const Component = getChatWidget(entry.widget.type)
    if (!Component) return null
    return createElement(Component, { params: entry.widget.defaultParams, previewData })
  }
  const def = getDashboardWidget(entry.widget.type)
  if (!def) return null
  return createElement(def.Component, { count: 5, previewData })
}

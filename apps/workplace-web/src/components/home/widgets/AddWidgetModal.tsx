// 위젯 추가 모달 — 왼쪽 카테고리(전체/기본/카탈로그 카테고리) + 오른쪽 카드 그리드.
// 카드 클릭 시 기본값으로 즉시 추가(모달은 열린 채 유지, 연속 추가 가능). Grafana/iOS 위젯 패턴 — "먼저 추가, 나중에 설정".
import { useState } from 'react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { CATALOG_CATEGORIES, type CatalogWidget } from './catalogRegistry'
import type { DashboardWidget } from './registry'

const ALL_CATEGORY = '전체'
const SYSTEM_CATEGORY = '기본'

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
  const categories = [ALL_CATEGORY, SYSTEM_CATEGORY, ...CATALOG_CATEGORIES]

  const visibleSystem =
    category === ALL_CATEGORY || category === SYSTEM_CATEGORY ? systemWidgets : []
  const visibleCatalog =
    category === ALL_CATEGORY
      ? catalogWidgets
      : catalogWidgets.filter((w) => w.category === category)

  function handleAdd(type: string) {
    if (disabled) return
    onAdd(type)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="add-widget-modal">
        <DialogHeader>
          <DialogTitle>위젯 추가</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4">
          <div className="w-32 shrink-0 space-y-1" data-testid="add-widget-categories">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
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
            className="grid max-h-[60vh] flex-1 grid-cols-2 gap-3 overflow-auto sm:grid-cols-3"
            data-testid="add-widget-grid"
          >
            {visibleSystem.map((w) => {
              const Icon = w.icon
              return (
                <button
                  key={w.type}
                  type="button"
                  className="flex flex-col items-start gap-1 rounded-md border p-3 text-left hover:border-ai-accent disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="add-widget-card"
                  data-widget-type={w.type}
                  disabled={disabled}
                  onClick={() => handleAdd(w.type)}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">{w.title}</span>
                  <span className="text-xs text-muted-foreground">기본 위젯 · 1×1</span>
                </button>
              )
            })}
            {visibleCatalog.map((w) => {
              const Icon = w.icon
              return (
                <button
                  key={w.type}
                  type="button"
                  className="flex flex-col items-start gap-1 rounded-md border p-3 text-left hover:border-ai-accent disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="add-widget-card"
                  data-widget-type={w.type}
                  disabled={disabled}
                  onClick={() => handleAdd(w.type)}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">{w.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {w.category} · {w.size}
                  </span>
                </button>
              )
            })}
            {visibleSystem.length === 0 && visibleCatalog.length === 0 && (
              <p className="col-span-full text-sm text-muted-foreground">
                이 카테고리에 추가할 수 있는 위젯이 없습니다.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

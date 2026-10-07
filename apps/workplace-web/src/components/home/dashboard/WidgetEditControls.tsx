// 편집 카드 공용 컨트롤(WP-161 에서 Dashboard.tsx 로부터 분리) — 항목 수 선택·숨김/설정/삭제 버튼.
// 데스크톱 편집 카드(EditableWidgetCard)와 모바일 편집 카드(MobileEditableWidgetCard)가 크기만 달리 같은 컨트롤을 쓴다.
import { Eye, EyeOff, Settings, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

import { WidgetSettingsPopover } from '../widgets/WidgetSettingsPopover'
import { type CatalogConfigPatch, hasCountSelect, type ResolvedEntry } from './resolvedEntry'

// 항목 수 선택지 — 백엔드 화이트리스트({3,5,10})와 일치.
const COUNT_OPTIONS = [3, 5, 10] as const

// 항목 수 버튼 크기 — 데스크톱 기본(28px)은 기존 그대로, 모바일 편집은 44px 터치 대상.
const COUNT_BUTTON_CLASS = { desktop: 'h-7 min-w-9 px-2', mobile: 'h-11 min-w-11 px-2' } as const
/** 편집 모드 항목 수(3/5/10) 선택 — 데스크톱·모바일 편집 카드 공용. 노출 조건은 hasCountSelect. */
export function WidgetCountSelect({
  entry,
  title,
  onCount,
  size = 'desktop',
}: {
  entry: ResolvedEntry
  title: string
  onCount: (count: number) => void
  /** 버튼 크기 — 모바일 편집 카드만 'mobile'(44px). */
  size?: keyof typeof COUNT_BUTTON_CLASS
}) {
  if (!hasCountSelect(entry)) return null
  return (
    <div
      className="flex items-center gap-2"
      role="group"
      aria-label={`항목 수: ${title}`}
      data-testid="widget-count-select"
    >
      <span className="text-xs text-muted-foreground">항목 수</span>
      {COUNT_OPTIONS.map((n) => (
        <Button
          key={n}
          type="button"
          variant={entry.cfg.count === n ? 'default' : 'outline'}
          size="sm"
          className={COUNT_BUTTON_CLASS[size]}
          aria-pressed={entry.cfg.count === n}
          aria-label={`${n}개`}
          onClick={() => onCount(n)}
        >
          {n}
        </Button>
      ))}
    </div>
  )
}
/**
 * 편집 카드 공용 컨트롤 — 숨김 토글·(카탈로그)설정·삭제(WP-142). 데스크톱(size-8)·모바일(size-11, 44px 터치) 편집 카드가
 * 크기만 달리 같은 버튼을 쓴다. 데스크톱은 숨김과 설정 사이에 "테두리 없음" 토글이 있어 afterHide 슬롯으로 끼우고,
 * 부모 flex 줄의 DOM 을 그대로 두려고 래퍼 없이 Fragment 로 그린다(testid·aria-label 동일).
 */
export function WidgetEditControls({
  entry,
  title,
  buttonClassName,
  onToggleHidden,
  onApplyCatalogConfig,
  onRemove,
  afterHide,
}: {
  entry: ResolvedEntry
  title: string
  buttonClassName: 'size-8' | 'size-11'
  onToggleHidden: () => void
  onApplyCatalogConfig: (patch: CatalogConfigPatch) => void
  onRemove: () => void
  afterHide?: ReactNode
}) {
  const { cfg } = entry
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        data-testid="widget-hide-toggle"
        aria-label={cfg.hidden ? `표시: ${title}` : `숨김: ${title}`}
        aria-pressed={cfg.hidden}
        onClick={onToggleHidden}
      >
        {cfg.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      {afterHide}
      {entry.kind === 'catalog' && entry.def.fields.length > 0 && (
        <WidgetSettingsPopover catalogDef={entry.def} cfg={cfg} onApply={onApplyCatalogConfig}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={buttonClassName}
            data-testid="widget-settings"
            aria-label={`설정: ${title}`}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </WidgetSettingsPopover>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        data-testid="widget-remove"
        aria-label={`삭제: ${title}`}
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  )
}

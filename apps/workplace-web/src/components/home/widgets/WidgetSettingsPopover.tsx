// 카탈로그 위젯 설정 팝오버 — 라벨(표시 이름) + catalogDef.fields 기반 필터 폼.
// "추가 시점 기본값 편집"과 "이후 편집"이 이 컴포넌트 하나로 통일된다(Dashboard.tsx EditableWidgetCard 의 ⚙ 아이콘).
// 모바일 편집 카드에서는 팝오버 대신 바텀시트(MobileSheetShell)로 연다 — 좁은 화면에서 팝오버가 배경 딤 없이
// 아래 위젯 카드 위에 겹쳐 떠, 다른 모바일 편집 흐름(위젯 추가·선택 시트)과 같은 시트 패턴으로 맞춘다(WP-642).
import { Slot } from 'radix-ui'
import { type ReactNode, useState } from 'react'

import { MobileSheetShell } from '@/components/mobile/MobileSheetShell'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DashboardWidgetConfig } from '@/types/dashboard'

import type { CatalogWidget } from './catalogRegistry'

/** 위젯 표시 이름 최대 길이 — 서버 DashboardService.MAX_LABEL_LENGTH 와 맞춘다(WP-519). */
const WIDGET_LABEL_MAX_LENGTH = 40

export function WidgetSettingsPopover({
  catalogDef,
  cfg,
  onApply,
  mobile = false,
  children,
}: {
  catalogDef: CatalogWidget
  cfg: DashboardWidgetConfig
  onApply: (patch: { params: Record<string, unknown>; label: string | null }) => void
  /** 모바일 편집 카드면 true — 같은 폼을 바텀시트로 연다. */
  mobile?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(cfg.label ?? '')
  const [values, setValues] = useState<Record<string, unknown>>({
    ...catalogDef.defaultParams,
    ...(cfg.params ?? {}),
  })

  function handleOpenChange(next: boolean) {
    if (next) {
      // 열 때마다 현재 저장된 값으로 폼을 리셋(이전 편집 취소 상태가 남지 않도록).
      setLabel(cfg.label ?? '')
      setValues({ ...catalogDef.defaultParams, ...(cfg.params ?? {}) })
    }
    setOpen(next)
  }

  function apply() {
    onApply({ params: values, label: label.trim() ? label.trim() : null })
    setOpen(false)
  }

  // 폼 본문 — 팝오버·바텀시트가 같은 입력·적용 버튼을 쓴다.
  const form = (
    <>
        <div className="space-y-1">
          <Label htmlFor={`widget-label-${cfg.id}`}>표시 이름</Label>
          <Input
            id={`widget-label-${cfg.id}`}
            data-testid="widget-settings-label"
            placeholder={catalogDef.title}
            // 서버 상한(DashboardService.MAX_LABEL_LENGTH)과 같은 40자 — 넘겨 저장하면 400 이 나고 헤더도 길어진다(WP-519).
            maxLength={WIDGET_LABEL_MAX_LENGTH}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        {catalogDef.fields.map((field) => (
          <div key={field.key} className="space-y-1">
            {field.kind === 'boolean' ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`widget-field-${cfg.id}-${field.key}`}
                  data-testid={`widget-settings-field-${field.key}`}
                  checked={Boolean(values[field.key])}
                  onCheckedChange={(checked) =>
                    setValues((prev) => ({ ...prev, [field.key]: checked === true }))
                  }
                />
                <Label htmlFor={`widget-field-${cfg.id}-${field.key}`}>{field.label}</Label>
              </div>
            ) : (
              <>
                <Label htmlFor={`widget-field-${cfg.id}-${field.key}`}>{field.label}</Label>
                {field.kind === 'select' ? (
                  <Select
                    value={String(values[field.key] ?? '')}
                    onValueChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                  >
                    <SelectTrigger
                      id={`widget-field-${cfg.id}-${field.key}`}
                      data-testid={`widget-settings-field-${field.key}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`widget-field-${cfg.id}-${field.key}`}
                    data-testid={`widget-settings-field-${field.key}`}
                    placeholder={field.placeholder}
                    value={String(values[field.key] ?? '')}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                )}
              </>
            )}
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          // 모바일 시트에서는 44px 터치 대상(10-accessibility).
          className={mobile ? 'h-11 w-full' : 'w-full'}
          data-testid="widget-settings-apply"
          onClick={apply}
        >
          적용
        </Button>
    </>
  )

  if (mobile) {
    return (
      <>
        {/* 트리거(⚙ 버튼)는 그대로 두고 누르면 시트를 연다 — Slot 이 버튼에 onClick 을 합친다. */}
        <Slot.Root onClick={() => handleOpenChange(true)}>{children}</Slot.Root>
        <MobileSheetShell
          open={open}
          onClose={() => setOpen(false)}
          title="위젯 설정"
          description="위젯 표시 이름과 조건을 바꾼 뒤 적용을 누르세요"
          testId="widget-settings-sheet"
        >
          <div className="space-y-3 overflow-y-auto px-4 pb-4 pt-1">{form}</div>
        </MobileSheetShell>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" data-testid="widget-settings-popover">
        {form}
      </PopoverContent>
    </Popover>
  )
}

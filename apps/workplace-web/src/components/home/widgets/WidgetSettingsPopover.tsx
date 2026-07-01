// 카탈로그 위젯 설정 팝오버 — 라벨(표시 이름) + catalogDef.fields 기반 필터 폼.
// "추가 시점 기본값 편집"과 "이후 편집"이 이 컴포넌트 하나로 통일된다(Dashboard.tsx EditableWidgetCard 의 ⚙ 아이콘).
import { type ReactNode, useState } from 'react'

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

export function WidgetSettingsPopover({
  catalogDef,
  cfg,
  onApply,
  children,
}: {
  catalogDef: CatalogWidget
  cfg: DashboardWidgetConfig
  onApply: (patch: { params: Record<string, unknown>; label: string | null }) => void
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

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" data-testid="widget-settings-popover">
        <div className="space-y-1">
          <Label htmlFor={`widget-label-${cfg.id}`}>표시 이름</Label>
          <Input
            id={`widget-label-${cfg.id}`}
            data-testid="widget-settings-label"
            placeholder={catalogDef.title}
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
          className="w-full"
          data-testid="widget-settings-apply"
          onClick={apply}
        >
          적용
        </Button>
      </PopoverContent>
    </Popover>
  )
}

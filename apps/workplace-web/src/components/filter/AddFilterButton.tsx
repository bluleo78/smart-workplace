// src/components/filter/AddFilterButton.tsx
// [＋ 필터] 단일 Popover. step 1=facet 목록, step 2=선택 facet 의 값 체크리스트.
// Radix 중첩 Popover 회피(포커스/dismiss 충돌) — 한 Popover 안에서 내용만 교체.
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { FacetValueList } from './FacetValueList';
import type { FacetDef, FacetValue, FilterValue } from './types';

export function AddFilterButton({
  facets,
  value,
  onToggle,
}: {
  facets: FacetDef[];
  value: FilterValue;
  onToggle: (key: string, v: FacetValue) => void;
}) {
  const [open, setOpen] = useState(false);
  // 선택된 facet key(2-step). null = facet 목록 단계.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = facets.find((f) => f.key === activeKey) ?? null;

  // 팝오버를 닫을 때 항상 facet 목록 단계로 초기화.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setActiveKey(null);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="add-filter-trigger">
          <Plus className="h-4 w-4" />
          필터
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        {active == null ? (
          <div className="space-y-0.5">
            {facets.map((f) => (
              <button
                key={f.key}
                type="button"
                className="flex w-full items-center gap-2 rounded p-1.5 text-left text-sm hover:bg-accent"
                data-testid={`add-filter-facet-${f.key}`}
                onClick={() => setActiveKey(f.key)}
              >
                {f.label}
                {(value[f.key]?.length ?? 0) > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {value[f.key].length}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <button
              type="button"
              className="mb-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setActiveKey(null)}
            >
              ← {active.label}
            </button>
            <FacetValueList
              facet={active}
              selected={value[active.key] ?? []}
              onToggle={(v) => onToggle(active.key, v)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

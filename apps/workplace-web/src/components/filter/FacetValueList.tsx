// src/components/filter/FacetValueList.tsx
// facet 옵션 멀티셀렉트 체크리스트. AddFilterButton 2-step 과 FilterChip 편집 팝오버가 공유.
import { Checkbox } from '@/components/ui/checkbox';

import type { FacetDef, FacetValue } from './types';

export function FacetValueList({
  facet,
  selected,
  onToggle,
}: {
  facet: FacetDef;
  selected: FacetValue[];
  onToggle: (value: FacetValue) => void;
}) {
  return (
    <div className="max-h-64 overflow-y-auto space-y-1">
      {facet.options.map((opt) => (
        <label
          key={String(opt.value)}
          className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-accent"
          data-testid={`facet-value-${facet.key}-${opt.value}`}
        >
          <Checkbox
            checked={selected.includes(opt.value)}
            onCheckedChange={() => onToggle(opt.value)}
            aria-label={opt.label}
          />
          {opt.render ?? <span className="text-sm">{opt.label}</span>}
        </label>
      ))}
      {facet.options.length === 0 && (
        <p className="text-xs text-muted-foreground py-2 text-center">옵션이 없습니다</p>
      )}
    </div>
  );
}

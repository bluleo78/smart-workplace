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
      {/* AND 결합 facet(라벨) 전용 안내 — 다른 facet(OR)과 시맨틱이 다름을 선택 전에 미리 알림 (#626) */}
      {facet.combineMode === 'and' && (
        <p
          className="px-1 pb-1 text-xs text-muted-foreground"
          data-testid={`facet-value-${facet.key}-and-hint`}
        >
          선택한 {facet.label}을(를) 모두 가진 이슈만 표시됩니다
        </p>
      )}
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

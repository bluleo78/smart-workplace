// src/components/filter/FilterChip.tsx
// 값이 1개 이상인 facet 의 칩. 본문 클릭=값 편집 팝오버, ×=해당 facet 값 전부 비움.
import { X } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';

import { summarizeFacet } from './facetSummary';
import { FacetValueList } from './FacetValueList';
import type { FacetDef, FacetValue } from './types';

export function FilterChip({
  facet,
  selected,
  onToggle,
  onClear,
}: {
  facet: FacetDef;
  selected: FacetValue[];
  onToggle: (value: FacetValue) => void;
  onClear: () => void;
}) {
  // 값 요약: 첫 선택값의 render/label + 나머지 개수. 옵션에 없는 값은 「(알 수 없음)」(#609), AND 결합은 「모두 포함」(#626).
  const { firstOpt, isUnresolved, extra, isAndCombine, text } = summarizeFacet(facet, selected);

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border bg-accent/40 pl-2 pr-1 py-0.5 text-xs"
      data-testid={`filter-chip-${facet.key}`}
      title={isAndCombine ? `선택한 ${facet.label}을(를) 모두 가진 항목만 표시` : undefined}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1"
            data-testid={isAndCombine ? `filter-chip-${facet.key}-and` : undefined}
          >
            <span className="text-muted-foreground">{facet.label}:</span>
            {firstOpt?.render ?? (
              <span className={isUnresolved ? 'italic text-muted-foreground' : undefined}>
                {text}
              </span>
            )}
            {extra > 0 &&
              (isAndCombine ? (
                <span className="text-muted-foreground">
                  외 {extra} <span className="font-medium">(모두 포함)</span>
                </span>
              ) : (
                <span className="text-muted-foreground">+{extra}</span>
              ))}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <FacetValueList facet={facet} selected={selected} onToggle={onToggle} />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`${facet.label} 필터 제거`}
        data-testid={`filter-chip-${facet.key}-remove`}
        className="rounded-full p-1.5 hover:bg-accent"
        onClick={onClear}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

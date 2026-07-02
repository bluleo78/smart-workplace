// src/components/filter/FilterChip.tsx
// 값이 1개 이상인 facet 의 칩. 본문 클릭=값 편집 팝오버, ×=해당 facet 값 전부 비움.
import { X } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
  // 값 요약: 첫 선택값의 render/label + 나머지 개수.
  // 옵션 목록에서 찾지 못하면(삭제된 라벨/제외된 담당자 등) 원시 ID를 노출하는 대신
  // "(알 수 없음)" 플레이스홀더를 흐림 처리로 표시해 유효하지 않은 필터임을 알린다 (#609).
  const firstOpt = facet.options.find((o) => o.value === selected[0]);
  const isUnresolved = selected.length > 0 && !firstOpt;
  const extra = selected.length - 1;

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border bg-accent/40 pl-2 pr-1 py-0.5 text-xs"
      data-testid={`filter-chip-${facet.key}`}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">{facet.label}:</span>
            {firstOpt?.render ?? (
              <span className={isUnresolved ? 'italic text-muted-foreground/70' : undefined}>
                {firstOpt?.label ?? (isUnresolved ? '(알 수 없음)' : selected[0])}
              </span>
            )}
            {extra > 0 && <span className="text-muted-foreground">+{extra}</span>}
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

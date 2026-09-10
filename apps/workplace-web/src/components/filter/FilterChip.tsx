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
  // AND 결합 facet(라벨)이 2개 이상 선택된 경우에만 의미가 갈린다 — "모두 포함" 명시로
  // 다른 facet(OR)과 다른 시맨틱임을 드러낸다 (#626 사람 결정: 동작은 AND 유지, 표기만 추가).
  const isAndCombine = facet.combineMode === 'and' && extra > 0;

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
              <span className={isUnresolved ? 'italic text-muted-foreground/70' : undefined}>
                {firstOpt?.label ?? (isUnresolved ? '(알 수 없음)' : selected[0])}
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

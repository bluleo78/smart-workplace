// src/components/filter/FacetFilter.tsx
// 공통 facet 필터 진입점: 활성 facet 칩들 + [＋ 필터]. controlled(facets/value/onChange).
// 검색·그룹·뷰는 포함하지 않음 — 호출부가 옆에 조합한다.
import type { ReactNode } from 'react';

import { AddFilterButton } from './AddFilterButton';
import { FilterChip } from './FilterChip';
import type { FacetDef, FilterValue } from './types';
import { useFacetToggle } from './useFacetToggle';

export function FacetFilter({
  facets,
  value,
  onChange,
  popoverSide,
  trailing,
}: {
  facets: FacetDef[];
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  /** 「＋ 필터」 팝오버 방향 고정 — 지정하면 뒤집지 않는다(모바일 필터 시트). 미지정이면 기존처럼 자동. */
  popoverSide?: 'top' | 'bottom';
  /** 「＋ 필터」 바로 뒤에 한 덩어리로 붙일 요소(예: 「초기화」) — 줄이 넘쳐도 이것만 따로 떨어지지 않는다. */
  trailing?: ReactNode;
}) {
  // 토글·비우기(연속 토글 lost update 방지 포함)는 빠른 필터 칩과 같은 훅을 쓴다.
  const { toggle, clear } = useFacetToggle(facets, value, onChange);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {facets
        .filter((f) => (value[f.key]?.length ?? 0) > 0)
        .map((f) => (
          <FilterChip
            key={f.key}
            facet={f}
            selected={value[f.key]}
            onToggle={(v) => toggle(f.key, v)}
            onClear={() => clear(f.key)}
          />
        ))}
      {/* 틀은 trailing 유무와 상관없이 늘 둔다 — 틀이 바뀌면 「＋ 필터」 가 다시 마운트돼 팝오버가 닫힌다. */}
      <div className="flex items-center gap-1.5">
        <AddFilterButton facets={facets} value={value} onToggle={toggle} side={popoverSide} />
        {trailing}
      </div>
    </div>
  );
}

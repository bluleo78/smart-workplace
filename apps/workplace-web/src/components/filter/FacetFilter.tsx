// src/components/filter/FacetFilter.tsx
// 공통 facet 필터 진입점: 활성 facet 칩들 + [＋ 필터]. controlled(facets/value/onChange).
// 검색·그룹·뷰는 포함하지 않음 — 호출부가 옆에 조합한다.
import { AddFilterButton } from './AddFilterButton';
import { FilterChip } from './FilterChip';
import type { FacetDef, FacetValue, FilterValue } from './types';

export function FacetFilter({
  facets,
  value,
  onChange,
}: {
  facets: FacetDef[];
  value: FilterValue;
  onChange: (next: FilterValue) => void;
}) {
  // 단일 값 토글 — 있으면 제거, 없으면 추가.
  function toggle(key: string, v: FacetValue) {
    const cur = value[key] ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onChange({ ...value, [key]: next });
  }

  // 해당 facet 의 모든 값 비움.
  function clear(key: string) {
    onChange({ ...value, [key]: [] });
  }

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
      <AddFilterButton facets={facets} value={value} onToggle={toggle} />
    </div>
  );
}

// src/components/filter/FacetFilter.tsx
// 공통 facet 필터 진입점: 활성 facet 칩들 + [＋ 필터]. controlled(facets/value/onChange).
// 검색·그룹·뷰는 포함하지 않음 — 호출부가 옆에 조합한다.
import { useEffect, useRef } from 'react';

import { AddFilterButton } from './AddFilterButton';
import { FilterChip } from './FilterChip';
import type { FacetDef, FacetValue, FilterValue } from './types';

export function FacetFilter({
  facets,
  value,
  onChange,
  popoverSide,
}: {
  facets: FacetDef[];
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  /** 「＋ 필터」 팝오버 방향 고정 — 지정하면 뒤집지 않는다(모바일 필터 시트). 미지정이면 기존처럼 자동. */
  popoverSide?: 'top' | 'bottom';
}) {
  // 직전에 내보낸 값의 최신 스냅샷.
  // onChange 가 URL(search params) 왕복을 거치는 호출부에서는 value prop 반영이 한 틱 이상
  // 지연될 수 있어(React Router 는 navigation 을 transition 으로 처리), 연속 토글 시 두 번째
  // 클릭이 갱신 전 value 를 읽어 첫 선택을 덮어쓰는 lost update 가 발생한다. 낙관적으로
  // ref 를 먼저 갱신해 다음 토글이 이어받게 한다.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  // 단일 값 토글 — 있으면 제거, 없으면 추가.
  function toggle(key: string, v: FacetValue) {
    const base = latest.current;
    const cur = base[key] ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    const merged = { ...base, [key]: next };
    latest.current = merged;
    onChange(merged);
  }

  // 해당 facet 의 모든 값 비움.
  function clear(key: string) {
    const merged = { ...latest.current, [key]: [] };
    latest.current = merged;
    onChange(merged);
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
      <AddFilterButton facets={facets} value={value} onToggle={toggle} side={popoverSide} />
    </div>
  );
}

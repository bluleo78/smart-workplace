// src/components/filter/useFacetToggle.ts
// facet 값 토글·비우기 — 「＋ 필터」(FacetFilter)와 빠른 필터 칩(QuickFilterBar·모바일 칩 줄)이 같은 규칙을 쓴다.
import { useEffect, useRef } from 'react';

import type { FacetDef, FacetValue, FilterValue } from './types';

/**
 * 값 토글(single facet 은 대체)·facet 비우기를 돌려준다.
 * 직전에 내보낸 값의 최신 스냅샷을 ref 로 들고 있다 — onChange 가 URL(search params) 왕복을 거치는 호출부에서는
 * value prop 반영이 한 틱 이상 늦을 수 있어(React Router 는 navigation 을 transition 으로 처리), 연속 토글 때 두 번째
 * 클릭이 갱신 전 value 를 읽어 첫 선택을 덮어쓰는 lost update 가 났다. 낙관적으로 ref 를 먼저 갱신해 다음 토글이 이어받는다.
 */
export function useFacetToggle(facets: FacetDef[], value: FilterValue, onChange: (next: FilterValue) => void) {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  // 단일 값 토글 — 있으면 제거, 없으면 추가(single facet 은 대체, 같은 값을 다시 고르면 해제).
  function toggle(key: string, v: FacetValue) {
    const base = latest.current;
    const cur = base[key] ?? [];
    const single = facets.find((f) => f.key === key)?.single;
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : single ? [v] : [...cur, v];
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

  return { toggle, clear };
}

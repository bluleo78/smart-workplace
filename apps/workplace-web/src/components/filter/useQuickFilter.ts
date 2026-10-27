// src/components/filter/useQuickFilter.ts
// 빠른 필터 칩 줄의 상태 — 데스크톱 QuickFilterBar 와 모바일 칩 줄(MobileQuickFilterRow)이 같은 계산을 쓴다(WP-1020).
import { useMemo } from 'react';

import { isPinnedAsChip, moreFacets, quickChipKeys, togglePinned } from './quickFilterLayout';
import type { FacetDef, FilterValue } from './types';
import { useFacetToggle } from './useFacetToggle';
import { useQuickFilterPrefs } from './useQuickFilterPrefs';

export interface QuickFilterInput {
  facets: FacetDef[];
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  /** 화면별 기본 칩(facet key, 보이는 순서). */
  defaultChips: readonly string[];
  /** 칩 고정·숨김을 기억할 localStorage 키. 없으면 고정·숨김 메뉴를 감추고 기억하지 않는다. */
  storageKey?: string;
}

export function useQuickFilter({ facets, value, onChange, defaultChips, storageKey }: QuickFilterInput, openKey?: string | null) {
  const [prefs, setPrefs] = useQuickFilterPrefs(storageKey);
  const { toggle, clear } = useFacetToggle(facets, value, onChange);
  const chipKeys = useMemo(() => quickChipKeys(facets, value, defaultChips, prefs, openKey), [facets, value, defaultChips, prefs, openKey]);
  const chips = useMemo(
    () => chipKeys.map((k) => facets.find((f) => f.key === k)).filter((f): f is FacetDef => f != null),
    [chipKeys, facets],
  );
  const more = useMemo(() => moreFacets(facets, chipKeys), [facets, chipKeys]);

  return {
    chips,
    more,
    /** 전체 facet(facet 순서) — 칩 고정 목록은 이 순서로 그린다. 고정할 때마다 행이 칩/더 보기 사이를 옮겨 다니면 누른 자리가 튄다. */
    all: facets,
    toggle,
    clear,
    /** 고정·숨김 메뉴를 보일지 — 기억할 곳(storageKey)이 있을 때만. */
    customizable: storageKey != null,
    isPinned: (key: string) => isPinnedAsChip(key, defaultChips, prefs),
    togglePin: (key: string) => setPrefs(togglePinned(key, defaultChips, prefs)),
  };
}

export type QuickFilterState = ReturnType<typeof useQuickFilter>;

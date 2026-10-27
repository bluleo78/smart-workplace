// src/components/filter/quickFilterLayout.ts
// 빠른 필터 칩 줄(WP-1020)의 순수 규칙 — 어떤 facet 을 칩으로 바로 보이고, 무엇을 「더 보기」에 넣는가.
// 화면마다 기본 칩 목록이 다르고(팀 = 담당자·상태·유형·라벨·우선순위, 개인·내 작업 = 상태·우선순위),
// 사용자가 「더 보기」에서 칩을 고정(pin)·숨김(hide)하면 그 선택을 화면별로 기억한다(useQuickFilterPrefs).
import type { FacetDef, FilterValue } from './types';

/** 사용자의 칩 고정·숨김 — 기본 칩 목록에 대한 차이만 담아, 기본 목록이 바뀌어도 사용자의 선택이 덮이지 않는다. */
export interface QuickFilterPrefs {
  /** 기본 칩이 아닌데 칩으로 고정한 facet(고정한 순서). */
  pinned: string[];
  /** 기본 칩인데 숨긴 facet. */
  hidden: string[];
}

export const EMPTY_QUICK_FILTER_PREFS: QuickFilterPrefs = { pinned: [], hidden: [] };

/** 값이 걸린 facet 인가. */
export function isFacetActive(value: FilterValue, key: string): boolean {
  return (value[key]?.length ?? 0) > 0;
}

/** 사용자 설정상 칩으로 보이는 facet 인가(값이 걸려 칩으로 끌려 나온 것과는 별개). 「더 보기」의 고정 토글 표시에 쓴다. */
export function isPinnedAsChip(key: string, defaults: readonly string[], prefs: QuickFilterPrefs): boolean {
  return defaults.includes(key) ? !prefs.hidden.includes(key) : prefs.pinned.includes(key);
}

/** 칩 고정·숨김 토글 — 기본 칩이면 숨김 목록을, 아니면 고정 목록을 고친다. */
export function togglePinned(key: string, defaults: readonly string[], prefs: QuickFilterPrefs): QuickFilterPrefs {
  if (defaults.includes(key)) {
    const hidden = prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key];
    return { ...prefs, hidden };
  }
  const pinned = prefs.pinned.includes(key) ? prefs.pinned.filter((k) => k !== key) : [...prefs.pinned, key];
  return { ...prefs, pinned };
}

/**
 * 칩으로 바로 보일 facet key 순서 — 기본 칩(숨긴 것 제외, 기본 순서) → 고정한 칩(고정 순서) → 그 밖에 값이 걸린 facet(facet 순서).
 * 값이 걸린 facet 은 숨겼거나 「더 보기」 소속이어도 칩으로 꺼낸다 — 저장 뷰·링크가 실어 온 필터가 화면에서 보이지 않으면 풀 곳이 없다.
 * 이 화면에 없는 facet(데이터가 없어 빠진 사이클·구성요소 등)은 고정했어도 빠진다.
 */
export function quickChipKeys(
  facets: readonly FacetDef[],
  value: FilterValue,
  defaults: readonly string[],
  prefs: QuickFilterPrefs,
  /** 팝오버가 열려 있는 칩 — 값을 모두 풀어도 닫힐 때까지 칩으로 남겨, 고르는 도중 팝오버가 사라지지 않게 한다. */
  openKey?: string | null,
): string[] {
  const available = new Set(facets.map((f) => f.key));
  const keys: string[] = [];
  const push = (k: string) => {
    if (available.has(k) && !keys.includes(k)) keys.push(k);
  };
  defaults.filter((k) => !prefs.hidden.includes(k)).forEach(push);
  prefs.pinned.forEach(push);
  facets.filter((f) => f.key === openKey || isFacetActive(value, f.key)).forEach((f) => push(f.key));
  return keys;
}

/** 「더 보기」에 들어갈 facet — 칩으로 보이지 않는 나머지(facet 순서). */
export function moreFacets(facets: readonly FacetDef[], chipKeys: readonly string[]): FacetDef[] {
  return facets.filter((f) => !chipKeys.includes(f.key));
}

/** 값이 걸린 칩을 앞으로(그 안의 순서는 유지) — 모바일 가로 스크롤 줄에서 걸린 필터가 늘 화면 안에 보이게. */
export function appliedFirst(keys: readonly string[], value: FilterValue): string[] {
  return [...keys.filter((k) => isFacetActive(value, k)), ...keys.filter((k) => !isFacetActive(value, k))];
}

/** 저장된 칩 설정 읽기 — 깨진 값·모양이 다른 값은 버리고 빈 설정으로 시작한다(문자열 배열만 받는다). */
export function parseQuickFilterPrefs(raw: string | null): QuickFilterPrefs {
  if (!raw) return EMPTY_QUICK_FILTER_PREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_QUICK_FILTER_PREFS;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const o = parsed as Record<string, unknown>;
    return { pinned: strings(o.pinned), hidden: strings(o.hidden) };
  } catch {
    return EMPTY_QUICK_FILTER_PREFS;
  }
}

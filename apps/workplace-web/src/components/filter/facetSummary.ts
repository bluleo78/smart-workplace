// src/components/filter/facetSummary.ts
// 걸린 facet 의 값 요약(첫 값 + 나머지 개수) — 「＋ 필터」 칩(FilterChip)과 빠른 필터 칩이 같은 판정을 쓴다.
import type { FacetDef, FacetOption, FacetValue } from './types';

export interface FacetSummary {
  /** 첫 선택값의 옵션 — 옵션 목록에 없으면(삭제된 라벨·제외된 담당자 등) undefined. */
  firstOpt?: FacetOption;
  /** 옵션에 없어도 facet 이 주는 값 문구(직접 지정한 기간 등). */
  customLabel?: string;
  /** 옵션에도 facet 문구에도 없는 값 — 원시 ID 대신 「(알 수 없음)」을 흐리게 보인다(#609). */
  isUnresolved: boolean;
  /** 첫 값 말고 더 걸린 개수. */
  extra: number;
  /** AND 결합 facet(라벨)이 2개 이상 걸림 — 「모두 포함」을 밝혀 OR facet 과 구분한다(#626). */
  isAndCombine: boolean;
  /** 첫 값의 글자 문구(render 가 없을 때·접근성 이름용). */
  text: string;
}

export function summarizeFacet(facet: FacetDef, selected: FacetValue[]): FacetSummary {
  const firstOpt = facet.options.find((o) => o.value === selected[0]);
  const customLabel = firstOpt || selected.length === 0 ? undefined : facet.valueLabel?.(selected[0]);
  const isUnresolved = selected.length > 0 && !firstOpt && !customLabel;
  const extra = Math.max(0, selected.length - 1);
  const isAndCombine = facet.combineMode === 'and' && extra > 0;
  const text = firstOpt?.label ?? customLabel ?? (isUnresolved ? '(알 수 없음)' : String(selected[0] ?? ''));
  return { firstOpt, customLabel, isUnresolved, extra, isAndCombine, text };
}

/** 값 목록 위 검색칸을 둘까 — 단일 선택 facet(완료일 기간)처럼 옵션이 몇 개 안 되고 고정된 것엔 두지 않는다(WP-1020). */
export function facetSearchable(facet: FacetDef): boolean {
  return !facet.single && facet.options.length > 0;
}

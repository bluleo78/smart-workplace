// 이슈 필터 바의 「구성요소」 facet(WP-933) — 데스크톱 필터 바·모바일 필터 시트가 같은 정의를 쓴다.
// 사용 중 구성요소(목록 순서) → 「구성요소 없음」 → 보관된 것은 아래 「보관됨」 묶음. 다른 facet 처럼 이슈 수는 보이지 않는다.
// 「구성요소 없음」은 facet 값 'none'(URL component 의 none 토큰)으로 담아, 배지 수·칩 문구가 특별 처리 없이 맞게 한다.

import type { FacetDef, FacetValue } from '@/components/filter';

import { ComponentChip } from '../../../components/components/ComponentChip';
import { hasActiveComponents } from '../../../lib/issueComponents';
import type { ComponentResponse } from '../../../types/component';

/** 「구성요소 없음」 facet 값 — URL·서버의 none 토큰과 같은 글자. */
export const COMPONENT_NONE = 'none';

/**
 * 사용 중 구성요소가 없으면 null — facet 을 넣지 않는다(구성요소를 쓰지 않는 프로젝트의 필터 바는 그대로).
 * 단, 구성요소 필터가 이미 걸려 있으면(링크·저장 뷰가 실어 온 뒤 모두 보관됨) facet 을 남긴다 — 숨기면 걸린 필터를 풀 곳이 없다.
 */
export function buildComponentFacet(list: ComponentResponse[], filterActive = false): FacetDef | null {
  if (!hasActiveComponents(list) && !filterActive) return null;
  const option = (c: ComponentResponse) => ({
    value: c.id,
    label: c.name,
    render: <ComponentChip component={c} size="sm" />,
    ...(c.archived ? { group: '보관됨' } : {}),
  });
  return {
    key: 'component',
    label: '구성요소',
    options: [
      ...list.filter((c) => !c.archived).map(option),
      { value: COMPONENT_NONE, label: '구성요소 없음' },
      ...list.filter((c) => c.archived).map(option),
    ],
  };
}

/** 필터 값(구성요소 id + 「구성요소 없음」) → facet 선택값. */
export function componentFacetValue(componentIds: number[], componentNone: boolean): FacetValue[] {
  return [...componentIds, ...(componentNone ? [COMPONENT_NONE] : [])];
}

/** facet 선택값 → 필터 값. 숫자는 구성요소 id, 'none' 은 「구성요소 없음」. */
export function componentFilterFromFacet(values: FacetValue[] | undefined): { componentIds: number[]; componentNone: boolean } {
  const vs = values ?? [];
  return {
    componentIds: vs.filter((v): v is number => typeof v === 'number'),
    componentNone: vs.includes(COMPONENT_NONE),
  };
}

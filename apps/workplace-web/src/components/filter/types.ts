// src/components/filter/types.ts
// 범용 facet 필터의 도메인 비결합 타입. 이슈/연락처 등 어떤 상태 모델과도 무관.
import type { ReactNode } from 'react';

// facet 값. 문자열 enum(상태·우선순위) 또는 숫자 id(라벨·사이클·유형) 모두 허용.
export type FacetValue = string | number;

// facet 의 개별 선택 옵션. render 가 있으면 칩/배지/아바타 등 커스텀 표시, 없으면 label 텍스트.
export interface FacetOption {
  value: FacetValue;
  label: string;
  render?: ReactNode;
}

// 하나의 필터 차원(facet) 정의. options 는 호출부가 정적/페치해 전달.
export interface FacetDef {
  key: string; // 'status' | 'priority' | 'label' | 'cycle' | 'type' ...
  label: string; // '상태' '우선순위' ...
  options: FacetOption[];
}

// facetKey → 선택된 값들. 멀티셀렉트(AND/OR 결합 의미는 호출부 책임).
export type FilterValue = Record<string, FacetValue[]>;

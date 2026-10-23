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
  // 값 2개 이상 선택 시 결합 방식. 생략(기본) = OR(합집합).
  // 'and' 는 선택한 값을 모두 가진 항목만 매칭(예: 라벨) — 다른 facet과 의미가 달라 UI 에 명시해야 한다 (#626).
  combineMode?: 'and';
  // 단일 선택 facet(예: 완료일 기간) — 값을 고르면 기존 값을 대체하고, 같은 값을 다시 고르면 해제한다. 생략(기본) = 멀티셀렉트.
  single?: boolean;
  // options 에 없는 값의 칩 문구(예: 직접 지정한 기간 「10/1–10/10」). undefined 를 돌려주면 「(알 수 없음)」으로 본다.
  valueLabel?: (v: FacetValue) => string | undefined;
  // 옵션 목록 아래 추가 영역(예: 「기간 직접 지정」 달력). select 는 값을 (대체하여) 고른다 — 이미 골라진 값이면 아무것도 하지 않는다.
  // expanded/setExpanded — 추가 영역이 크게 펼쳐졌는가(달력). 펼친 동안 옵션 목록을 접어 팝오버가 화면 높이 안에 들게 한다.
  renderExtra?: (args: {
    selected: FacetValue[];
    select: (v: FacetValue) => void;
    expanded: boolean;
    setExpanded: (expanded: boolean) => void;
  }) => ReactNode;
}

// facetKey → 선택된 값들. 멀티셀렉트(AND/OR 결합 의미는 호출부 책임).
export type FilterValue = Record<string, FacetValue[]>;

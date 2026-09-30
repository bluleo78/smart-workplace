// 이슈 목록 다중 선택 상태(#606) — 평면 목록(IssueListView)과 사이클 구간 목록(IssueCycleGroupedList, #878)이 공유한다.
// 선택은 이슈 number 집합이고, 목록 기준(scopeKey)이 바뀌면 이전 기준의 선택은 의미가 없어 초기화한다.

import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';

export interface IssueSelection {
  selected: Set<number>;
  setSelected: Dispatch<SetStateAction<Set<number>>>;
  /** 한 이슈 선택 토글. */
  toggle: (number: number) => void;
  clear: () => void;
}

/**
 * @param scopeKey 목록 기준의 직렬화 값(필터·그룹). 객체 동일성이 아니라 이 값으로 비교해, 부모가 다른 이유(사이클 목록 갱신 등)로
 *   다시 렌더돼 같은 내용의 새 filters 객체가 와도 선택이 날아가지 않게 한다.
 */
export function useIssueSelection(scopeKey: string): IssueSelection {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // 기준 변경 시 초기화 — 렌더 중 조건부 setState(React 권장 "prop 변화에 state 리셋" 패턴)로 effect 왕복 렌더를 피한다.
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey);
  if (prevScopeKey !== scopeKey) {
    setPrevScopeKey(scopeKey);
    setSelected(new Set());
  }

  // useCallback 으로 안정화 — IssueRow 가 React.memo 라 콜백이 매 렌더 새로 생기면 memo 가 무력화된다(#716).
  const toggle = useCallback((number: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, setSelected, toggle, clear };
}

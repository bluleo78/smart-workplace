// 정렬 쓰기 훅(WP-1238) — 목록 열 머리 클릭과 필터 막대 정렬 칩(useIssueFilterControls.setSort)이 함께 쓴다.
// 실제 쿼리 만들기는 withSortParams 하나라 어디서 골라도 같은 정렬은 같은 주소가 된다(필터 쓰기와 같은 정규형).
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { type IssueSortValue, withSortParams } from '../../../lib/issueSort';

/** 정렬 쓰기 함수 — null(또는 기본과 같은 정렬)이면 sort·direction 을 지워 기본 정렬로. replace 로 써 조건 기억(WP-1035)·뒤로 가기 규칙이 필터 변경과 같다. */
export function useSetIssueSort(): (next: IssueSortValue | null) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (next) => setParams((prev) => withSortParams(prev, next), { replace: true }),
    [setParams],
  );
}

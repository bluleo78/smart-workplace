import { useSearchParams } from 'react-router-dom';

import { carryViewOptions } from '../../../lib/issueFilters';

/** 필터 초기화 — view·group(과 모바일 보드 탭·목록 열 구성)은 유지하고 나머지 필터 파라미터만 지운다. 빈 상태·불러오기 실패(4xx) 상태가 공유한다. */
export function useResetIssueFilters(): () => void {
  const [, setParams] = useSearchParams();
  return () =>
    setParams((prev) => {
      const p = new URLSearchParams();
      const view = prev.get('view');
      const group = prev.get('group');
      if (view) p.set('view', view);
      if (group) p.set('group', group);
      return carryViewOptions(p, prev);
    }, { replace: true });
}

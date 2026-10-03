// 필터 결과 없음 빈 상태 — 디자인 시스템 empty state 4요소(아이콘·제목·설명·액션, #337).
// 평면 목록(IssueListView)과 사이클 구간 목록(IssueCycleGroupedList, #878)이 공유한다.

import { SearchX } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '../../../components/ui/button';
import { carryBoardTab } from '../../../lib/issueFilters';

export function IssueFilterEmptyState({
  title = '검색 결과가 없습니다',
  description = '다른 키워드나 필터 조건을 사용해 보세요.',
}: {
  title?: string;
  description?: string;
}) {
  const [, setParams] = useSearchParams();

  // view·group 은 유지하고 나머지 필터 파라미터만 초기화. 모바일 보드 탭(boardTab)도 필터 컨트롤 초기화와 같이 유지.
  function handleResetFilters() {
    setParams((prev) => {
      const p = new URLSearchParams();
      const view = prev.get('view');
      const group = prev.get('group');
      if (view) p.set('view', view);
      if (group) p.set('group', group);
      return carryBoardTab(p, prev);
    }, { replace: true });
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
      data-testid="empty-filter"
    >
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={handleResetFilters} data-testid="empty-reset-filter">
        필터 초기화
      </Button>
    </div>
  );
}

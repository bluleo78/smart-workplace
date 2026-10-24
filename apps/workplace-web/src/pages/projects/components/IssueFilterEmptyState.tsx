// 필터 결과 없음 빈 상태 — 디자인 시스템 empty state 4요소(아이콘·제목·설명·액션, #337).
// 평면 목록(IssueListView)과 사이클 구간 목록(IssueCycleGroupedList, #878)이 공유한다.
// 레이아웃은 공용 ListEmptyState 를 그대로 쓴다 — 다른 이슈 목록 빈 상태와 같은 마크업 한 벌(WP-919).

import { SearchX } from 'lucide-react';

import { ListEmptyState } from '../../../components/issue/ListEmptyState';
import { useResetIssueFilters } from '../hooks/useResetIssueFilters';

export function IssueFilterEmptyState({
  title = '검색 결과가 없습니다',
  description = '다른 키워드나 필터 조건을 사용해 보세요.',
}: {
  title?: string;
  description?: string;
}) {
  const handleResetFilters = useResetIssueFilters();

  return (
    <ListEmptyState
      icon={SearchX}
      title={title}
      description={description}
      action={{ label: '필터 초기화', onClick: handleResetFilters, testId: 'empty-reset-filter' }}
      testId="empty-filter"
    />
  );
}

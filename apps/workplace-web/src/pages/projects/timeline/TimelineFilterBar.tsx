// 타임라인 v1 필터바 — 상태 다중 선택만 노출(담당자/마일스톤 UI는 디자이너 리뷰 후 확장).
// URL SearchParams 가 단일 source of truth — IssueFilterBar 와 동일하게 parseFilters/filtersToParams 를 통과한다.
import { useSearchParams } from 'react-router-dom';

import { type FacetDef, FacetFilter, type FilterValue } from '@/components/filter';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { filtersToParams, parseFilters } from '../../../lib/issueFilters';
import type { IssueStatus } from '../../../types/issue';

const STATUS_OPTIONS = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

export function TimelineFilterBar() {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);

  const facets: FacetDef[] = [
    {
      key: 'status',
      label: '상태',
      options: STATUS_OPTIONS.map((o) => ({
        value: o.value,
        label: o.label,
        render: (
          <span className="flex items-center gap-1.5">
            <IssueStatusIcon status={o.value as IssueStatus} />
            {o.label}
          </span>
        ),
      })),
    },
  ];

  const filterValue: FilterValue = { status: filters.statuses };

  function handleFilterChange(next: FilterValue) {
    // 타임라인은 view/group 개념이 없어 고정값으로 직렬화한다.
    setParams(
      filtersToParams({ ...filters, statuses: (next.status ?? []) as string[] }, 'list', null),
      { replace: true },
    );
  }

  return (
    <div className="flex items-center gap-2 py-2">
      <FacetFilter facets={facets} value={filterValue} onChange={handleFilterChange} />
    </div>
  );
}

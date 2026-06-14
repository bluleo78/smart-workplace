// 프로젝트 횡단 "내 작업"/"AI 위임" 목록용 공통 facet 필터 바.
// 프로젝트별 IssueFilterBar 와 달리 projectKey 가 없으므로 정적 enum(상태·우선순위)만 노출한다.
// (label/cycle/type 은 프로젝트별 동적 옵션 — 횡단 뷰에는 단일 옵션 소스가 없어 제외.)
// URL SearchParams 가 단일 source of truth — 탭(경로 세그먼트)·assignee/reporter(프로그램 인자)와
// 독립적으로 status/priority 만 query 로 읽고 쓴다.
import { useSearchParams } from 'react-router-dom';

import { type FacetDef, FacetFilter, type FilterValue } from '@/components/filter';

import { parseFilters } from '../../lib/issueFilters';

// 상태 옵션 — 백엔드 IssueStatus enum 과 일치. IssueFilterBar 와 동일 라벨 유지.
const STATUS_OPTIONS = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

// 우선순위 옵션 — 본 코드베이스의 IssuePriority 는 LOW/MID/HIGH (URGENT 없음).
const PRIORITY_OPTIONS = [
  { value: 'LOW', label: '낮음' },
  { value: 'MID', label: '보통' },
  { value: 'HIGH', label: '높음' },
];

export function MeTaskFilterBar() {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);

  // URL filters → 범용 FilterValue (상태/우선순위만).
  const filterValue: FilterValue = {
    status: filters.statuses,
    priority: filters.priorities,
  };

  const facets: FacetDef[] = [
    { key: 'status', label: '상태', options: STATUS_OPTIONS },
    { key: 'priority', label: '우선순위', options: PRIORITY_OPTIONS },
  ];

  // FilterValue → URL. status/priority 만 갱신하고 다른 query 키(있다면)는 보존.
  // setParams(query-only) 이므로 탭 경로 세그먼트는 그대로 유지된다.
  function handleFilterChange(next: FilterValue) {
    const p = new URLSearchParams(params);
    const statuses = (next.status ?? []) as string[];
    const priorities = (next.priority ?? []) as string[];
    if (statuses.length) p.set('status', statuses.join(','));
    else p.delete('status');
    if (priorities.length) p.set('priority', priorities.join(','));
    else p.delete('priority');
    setParams(p, { replace: true });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1" data-testid="me-task-filter-bar">
      <FacetFilter facets={facets} value={filterValue} onChange={handleFilterChange} />
    </div>
  );
}

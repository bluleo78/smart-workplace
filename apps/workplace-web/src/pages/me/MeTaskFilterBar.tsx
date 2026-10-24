// 프로젝트 횡단 "내 작업"/"AI 위임" 목록용 공통 facet 필터 바.
// 프로젝트별 IssueFilterBar 와 달리 projectKey 가 없으므로 정적 enum(상태·우선순위)만 노출한다.
// (label/cycle/type 은 프로젝트별 동적 옵션 — 횡단 뷰에는 단일 옵션 소스가 없어 제외.)
// URL SearchParams 가 단일 source of truth — 탭(경로 세그먼트)·assignee/reporter(프로그램 인자)와
// 독립적으로 status/priority 만 query 로 읽고 쓴다.
import { CircleCheckBig } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { type FacetDef, FacetFilter, type FilterValue } from '@/components/filter';
import { Button } from '@/components/ui/button';
import { ghostToggleClass } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

import { parseFilters } from '../../lib/issueFilters';
import { overridesMyTasksClosedHiding } from './myTasksQuery';

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

/** showClosedToggle — 「완료 모두 보기」 토글 노출(할당 탭만, WP-916). 내가 만든 탭은 만든 이력이라 완료를 숨기지 않는다. */
export function MeTaskFilterBar({ showClosedToggle = false }: { showClosedToggle?: boolean }) {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  // 상태 범주를 직접 고르면 숨김이 이미 풀린다 — 프로젝트 목록처럼 눌린 채 비활성. 판정은 숨김 쿼리와 같은 함수(myTasksQuery).
  const closedHidingOverridden = overridesMyTasksClosedHiding(filters);

  // URL filters → 범용 FilterValue (상태/우선순위만).
  const filterValue: FilterValue = {
    status: filters.statuses,
    priority: filters.priorities,
  };

  const facets: FacetDef[] = [
    // 범주 facet — 프로젝트 화면 필터 바와 같은 이름(「상태 범주」, WP-808). 여러 프로젝트를 걸치므로 개별 상태 facet 은 없다.
    { key: 'status', label: '상태 범주', options: STATUS_OPTIONS },
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

  // 「완료 모두 보기」 — 프로젝트 목록과 같은 URL 키(closed=all)로 켜고 끈다. 다른 query 키는 보존.
  function toggleShowAllClosed() {
    const p = new URLSearchParams(params);
    if (filters.showAllClosed) p.delete('closed');
    else p.set('closed', 'all');
    setParams(p, { replace: true });
  }

  const closedPressed = filters.showAllClosed || closedHidingOverridden;

  return (
    <div className="flex flex-wrap items-center gap-2 py-1" data-testid="me-task-filter-bar">
      <FacetFilter facets={facets} value={filterValue} onChange={handleFilterChange} />
      {/* 모양·문구는 프로젝트 목록 IssueFilterBar 의 토글과 같다. */}
      {showClosedToggle && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="show-all-closed-toggle"
          aria-pressed={closedPressed}
          disabled={closedHidingOverridden}
          onClick={toggleShowAllClosed}
          className={cn('ml-auto transition-colors', ghostToggleClass(closedPressed))}
        >
          <CircleCheckBig aria-hidden="true" /> 완료 모두 보기
        </Button>
      )}
    </div>
  );
}

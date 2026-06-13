// 태스크 필터/검색 + 뷰(list/board) 토글 바.
// URL 의 SearchParams 가 단일 source of truth — 내부 state 는 q 입력 debounce 버퍼뿐.

import { LayoutGrid, List, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { type FacetDef, FacetFilter, type FilterValue } from '@/components/filter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { useCycles } from '../../../hooks/queries/useCycles';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { useLabels } from '../../../hooks/queries/useLabels';
import { filtersToParams, parseFilters, parseGroupBy, parseView } from '../../../lib/issueFilters';
import type { IssueFilters, IssueGroupBy, IssueView } from '../../../types/issue';

const STATUS_OPTIONS = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

// 본 코드베이스의 IssuePriority 는 LOW/MID/HIGH (URGENT 없음) — 백엔드 enum 일치.
const PRIORITY_OPTIONS = [
  { value: 'LOW', label: '낮음' },
  { value: 'MID', label: '보통' },
  { value: 'HIGH', label: '높음' },
];

// 그룹 기준 옵션 (#58). null = 그룹 없음(평탄 리스트 / 상태 보드).
const GROUP_OPTIONS: { value: IssueGroupBy | null; label: string }[] = [
  { value: null, label: '없음' },
  { value: 'status', label: '상태' },
  { value: 'assignee', label: '담당자' },
  { value: 'priority', label: '우선순위' },
];

// 개인 프로젝트 등에서 일부 컨트롤을 숨기거나 라벨을 바꾸기 위한 옵션. 기본값 = 팀 전체 동작.
export interface IssueFilterBarOptions {
  showCycle?: boolean; // 기본 true
  showType?: boolean; // 기본 true
  groupOptions?: { value: IssueGroupBy | null; label: string }[]; // 기본 GROUP_OPTIONS
  listLabel?: string; // 뷰토글의 'list' 버튼 접근성 라벨. 기본 '리스트'
  listIcon?: LucideIcon; // 뷰토글의 'list' 버튼 아이콘. 기본 List(목록). 개인=ListChecks(체크리스트)
}

export function IssueFilterBar({
  projectKey,
  options,
}: {
  projectKey: string;
  options?: IssueFilterBarOptions;
}) {
  const showCycle = options?.showCycle ?? true;
  const showType = options?.showType ?? true;
  const groupOptions = options?.groupOptions ?? GROUP_OPTIONS;
  const listLabel = options?.listLabel ?? '리스트';
  const ListIcon = options?.listIcon ?? List;
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const view = parseView(params);
  const groupBy = parseGroupBy(params);
  const [qDraft, setQDraft] = useState(filters.q);
  const labels = useLabels(projectKey);
  // useCycles/useIssueTypes 는 훅 규칙상 항상 호출하지만, showCycle/showType=false 면
  // 렌더하지 않는다(개인 프로젝트). 네트워크는 발생하나 결과가 비어 무해.
  const cycles = useCycles(projectKey);
  const types = useIssueTypes(projectKey);

  // URL 의 q 가 외부 변경(예: 초기화 버튼)으로 바뀌면 입력값을 동기화한다.
  useEffect(() => {
    setQDraft(filters.q);
  }, [filters.q]);

  // 검색어는 300ms debounce 후 URL 에 반영 — 매 키 입력마다 네트워크 호출을 막는다.
  useEffect(() => {
    if (qDraft === filters.q) return;
    const t = setTimeout(() => {
      writeFilters({ ...filters, q: qDraft }, view, groupBy);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  // view·groupBy 는 IssueFilters 와 분리된 URL 키 — 필터 변경 시에도 함께 보존해야 한다.
  function writeFilters(
    next: IssueFilters,
    nextView: IssueView,
    nextGroupBy: IssueGroupBy | null,
  ) {
    setParams(filtersToParams(next, nextView, nextGroupBy), { replace: true });
  }

  function setView(v: IssueView) {
    writeFilters(filters, v, groupBy);
  }

  // 그룹 기준 변경 — 필터/view 는 유지하고 group 만 교체 (#58).
  function setGroupBy(g: IssueGroupBy | null) {
    writeFilters(filters, view, g);
  }

  // 초기화는 view·group 은 유지하고 나머지 필터만 비운다.
  function reset() {
    const p = new URLSearchParams();
    if (view === 'board') p.set('view', 'board');
    if (groupBy) p.set('group', groupBy);
    setParams(p, { replace: true });
  }

  // 적용된 필터가 하나라도 있을 때만 초기화 버튼을 노출 — 평소엔 숨겨 툴바를 깔끔하게.
  const hasActiveFilters =
    filters.q !== '' ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.cycleIds.length > 0 ||
    filters.typeIds.length > 0;

  // URL filters → 범용 FilterValue. 상태/우선순위는 문자열, 라벨/사이클/유형은 숫자 id.
  const filterValue: FilterValue = {
    status: filters.statuses,
    priority: filters.priorities,
    label: filters.labelIds,
    cycle: filters.cycleIds,
    type: filters.typeIds,
  };

  // facet 정의 — 노출 여부는 showCycle/showType 옵션으로 결정.
  const facets: FacetDef[] = [
    {
      key: 'status',
      label: '상태',
      options: STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    },
    {
      key: 'priority',
      label: '우선순위',
      options: PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    },
    {
      key: 'label',
      label: '라벨',
      options: (labels.data ?? []).map((l) => ({
        value: l.id,
        label: l.name,
        render: (
          <LabelChip label={{ id: l.id, name: l.name, colorToken: l.colorToken }} size="sm" />
        ),
      })),
    },
    ...(showCycle
      ? [
          {
            key: 'cycle',
            label: '사이클',
            options: (cycles.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          } satisfies FacetDef,
        ]
      : []),
    ...(showType
      ? [
          {
            key: 'type',
            label: '유형',
            options: (types.data ?? []).map((t) => ({
              value: t.id,
              label: t.name,
              render: (
                <IssueTypeBadge
                  type={{ id: t.id, name: t.name, colorToken: t.colorToken, icon: t.icon }}
                  size="sm"
                />
              ),
            })),
          } satisfies FacetDef,
        ]
      : []),
  ];

  // FilterValue → URL filters. 숫자 facet 값은 number 로 왕복(DOM stringify 금지).
  function handleFilterChange(next: FilterValue) {
    writeFilters(
      {
        ...filters,
        statuses: (next.status ?? []) as string[],
        priorities: (next.priority ?? []) as string[],
        labelIds: (next.label ?? []) as number[],
        cycleIds: (next.cycle ?? []) as number[],
        typeIds: (next.type ?? []) as number[],
      },
      view,
      groupBy,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Input
        value={qDraft}
        onChange={(e) => setQDraft(e.target.value)}
        placeholder="태스크 검색"
        className="w-64"
        aria-label="태스크 검색"
      />

      <FacetFilter facets={facets} value={filterValue} onChange={handleFilterChange} />

      {/* 그룹 기준 — 셀렉트(드롭다운). null='none' 으로 매핑. */}
      <div className="flex items-center gap-1 ml-auto">
        <span className="text-xs text-muted-foreground">그룹</span>
        <Select
          value={groupBy ?? 'none'}
          onValueChange={(v) => setGroupBy(v === 'none' ? null : (v as IssueGroupBy))}
        >
          <SelectTrigger
            size="sm"
            className="w-28"
            aria-label="그룹 기준"
            data-testid="group-by-trigger"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groupOptions.map((opt) => (
              <SelectItem
                key={opt.value ?? 'none'}
                value={opt.value ?? 'none'}
                data-testid={`group-by-${opt.value ?? 'none'}`}
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 뷰 전환 — 아이콘 토글. 접근성 라벨은 listLabel/'보드' 로 유지(E2E·스크린리더). */}
      <div className="flex items-center gap-1" role="group" aria-label="뷰 전환">
        <Button
          variant={view === 'list' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('list')}
          aria-pressed={view === 'list'}
          aria-label={listLabel}
          title={listLabel}
        >
          <ListIcon className="h-4 w-4" />
        </Button>
        <Button
          variant={view === 'board' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('board')}
          aria-pressed={view === 'board'}
          aria-label="보드"
          title="보드"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
      </div>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={reset}>
          초기화
        </Button>
      )}
    </div>
  );
}

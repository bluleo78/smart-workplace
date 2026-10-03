// 이슈 필터 바 로직 훅 — 데스크톱 IssueFilterBar 와 모바일 툴바가 공유한다.
// URL 의 SearchParams 가 단일 source of truth — 내부 state 는 q 입력 debounce 버퍼뿐.

import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { FacetDef, FilterValue } from '@/components/filter';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { useCycles } from '../../../hooks/queries/useCycles';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { useLabels } from '../../../hooks/queries/useLabels';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useIssueGroupBy } from '../../../hooks/useIssueGroupBy';
import {
  carryBoardTab,
  filtersToParams,
  overridesClosedHiding,
  parseFilters,
  parseView,
} from '../../../lib/issueFilters';
import { ISSUE_GROUP_BY_LABEL } from '../../../lib/issueGrouping';
import type {
  IssueFilters,
  IssueGroupBy,
  IssueGroupParam,
  IssuePriority,
  IssueStatus,
  IssueView,
} from '../../../types/issue';

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
// 사이클(#878)은 팀 목록 전용 — 보드·사이클 비사용 화면에선 목록에서 빠진다(아래 visibleGroupOptions).
// 라벨은 ISSUE_GROUP_BY_LABEL 공용 맵에서 — AI 화면 컨텍스트(WP-54)와 같은 문구를 쓴다(키 순서 = 옵션 순서).
const GROUP_OPTIONS: { value: IssueGroupBy | null; label: string }[] = [
  { value: null, label: '없음' },
  ...(Object.entries(ISSUE_GROUP_BY_LABEL) as [IssueGroupBy, string][]).map(([value, label]) => ({ value, label })),
];

// 개인 프로젝트 등에서 일부 컨트롤을 숨기거나 라벨을 바꾸기 위한 옵션. 기본값 = 팀 전체 동작.
export interface IssueFilterBarOptions {
  showCycle?: boolean; // 기본 true
  showType?: boolean; // 기본 true
  showClosedToggle?: boolean; // 「완료 모두 보기」 노출. 기본 true — 종료 이슈 숨김 범위를 안 쓰는 화면(개인)은 false
  groupOptions?: { value: IssueGroupBy | null; label: string }[]; // 기본 GROUP_OPTIONS
  listLabel?: string; // 뷰토글의 'list' 버튼 접근성 라벨. 기본 '리스트'
  listIcon?: LucideIcon; // 뷰토글의 'list' 버튼 아이콘. 기본 List(목록). 개인=ListChecks(체크리스트)
}


// 훅이 노출하는 필터 컨트롤 — 소비자(데스크톱 바/모바일 툴바)는 이 값만 쓴다.
export interface IssueFilterControls {
  filters: IssueFilters;
  view: IssueView;
  groupParam: IssueGroupParam | null; // URL 원값
  groupBy: IssueGroupBy | null; // 적용 중(사이클 기본값 반영)
  qDraft: string;
  setQDraft: (q: string) => void; // 300ms debounce 후 URL q
  facets: FacetDef[];
  filterValue: FilterValue;
  onFilterChange: (next: FilterValue) => void;
  activeFilterCount: number; // 값이 있는 facet 수(q 제외)
  hasActiveFilters: boolean; // q 포함
  setView: (v: IssueView) => void;
  setGroupBy: (g: IssueGroupBy | null) => void;
  visibleGroupOptions: { value: IssueGroupBy | null; label: string }[];
  reset: () => void;
  showClosedToggle: boolean;
  closedHidingOverridden: boolean;
  toggleShowAllClosed: () => void;
  clearFacets: () => void; // q·view·group 유지, facet 값만 비움
}

export function useIssueFilterControls(
  projectKey: string,
  options?: IssueFilterBarOptions,
): IssueFilterControls {
  const showCycle = options?.showCycle ?? true;
  const showType = options?.showType ?? true;
  const showClosedToggle = options?.showClosedToggle ?? true;
  const groupOptions = options?.groupOptions ?? GROUP_OPTIONS;
  const [params, setParams] = useSearchParams();
  // params 는 URL(search)이 바뀔 때만 새 객체 — 파싱 결과를 메모해 아래 filterValue 메모가 매 렌더 깨지지 않게 한다.
  const filters = useMemo(() => parseFilters(params), [params]);
  const view = parseView(params);
  // groupParam = URL 원값(부재/none/값) — 필터를 다시 쓸 때 그대로 보존해야 명시한 「없음」이 기본값으로 되돌지 않는다.
  // groupBy = 실제 적용 중인 그룹(사이클 기본값 반영) — 셀렉트 표시용.
  const { raw: groupParam, groupBy } = useIssueGroupBy(projectKey, showCycle);
  const [qDraft, setQDraft] = useState(filters.q);
  const labels = useLabels(projectKey);
  // useCycles/useIssueTypes/useProjectMembers 는 훅 규칙상 항상 호출하지만,
  // showCycle/showType=false 면 렌더하지 않는다(개인 프로젝트). 네트워크는 발생하나 결과가 비어 무해.
  const cycles = useCycles(projectKey);
  const types = useIssueTypes(projectKey);
  // 프로젝트 멤버 목록 — 담당자 필터 facet 옵션 구성에 사용.
  const members = useProjectMembers(projectKey);

  // URL 의 q 가 외부 변경(예: 초기화 버튼)으로 바뀌면 입력값을 동기화한다.
  // 외부 소스(URL)→로컬 draft 동기화는 의도된 effect 패턴이라 규칙을 명시 해제한다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQDraft(filters.q);
  }, [filters.q]);

  // 검색어는 300ms debounce 후 URL 에 반영 — 매 키 입력마다 네트워크 호출을 막는다.
  useEffect(() => {
    if (qDraft === filters.q) return;
    const t = setTimeout(() => {
      writeFilters({ ...filters, q: qDraft }, view, groupParam);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  // view·groupBy 는 IssueFilters 와 분리된 URL 키 — 필터 변경 시에도 함께 보존해야 한다.
  function writeFilters(
    next: IssueFilters,
    nextView: IssueView,
    nextGroupBy: IssueGroupParam | null,
  ) {
    setParams((prev) => carryBoardTab(filtersToParams(next, nextView, nextGroupBy), prev), { replace: true });
  }

  function setView(v: IssueView) {
    writeFilters(filters, v, groupParam);
  }

  // 그룹 기준 변경 — 필터/view 는 유지하고 group 만 교체 (#58).
  // 「없음」은 group=none 으로 명시한다 — 키를 지우면 사이클이 있는 프로젝트는 기본 사이클 그룹으로 되돌아간다(#878).
  function setGroupBy(g: IssueGroupBy | null) {
    writeFilters(filters, view, g ?? 'none');
  }

  // 초기화는 view·group 은 유지하고 나머지 필터만 비운다.
  function reset() {
    setParams((prev) => {
      const p = new URLSearchParams();
      if (view === 'board') p.set('view', 'board');
      if (groupParam) p.set('group', groupParam);
      return carryBoardTab(p, prev);
    }, { replace: true });
  }

  // 셀렉트에 보일 그룹 옵션 — 사이클 그룹은 사이클을 쓰는 화면의 목록 뷰에서만 고를 수 있다.
  const visibleGroupOptions = groupOptions.filter(
    (o) => o.value !== 'cycle' || (showCycle && view === 'list'),
  );

  // 명시 필터가 이미 종료 이슈 숨김을 해제했는지 — 토글 표시 상태에 반영(#876).
  const closedHidingOverridden = overridesClosedHiding(filters);

  // 적용된 필터가 하나라도 있을 때만 초기화 버튼을 노출 — 평소엔 숨겨 툴바를 깔끔하게.
  const hasActiveFilters =
    filters.q !== '' ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.cycleIds.length > 0 ||
    filters.typeIds.length > 0 ||
    filters.assigneeIds.length > 0 ||
    filters.includeUnassigned;

  // URL filters → 범용 FilterValue. 상태/우선순위는 문자열, 라벨/사이클/유형/담당자는 숫자 id.
  const filterValue: FilterValue = useMemo(
    () => ({
      status: filters.statuses,
      priority: filters.priorities,
      label: filters.labelIds,
      cycle: filters.cycleIds,
      type: filters.typeIds,
      assignee: filters.assigneeIds,
    }),
    [filters],
  );

  // facet 정의 — 노출 여부는 showCycle/showType 옵션으로 결정.
  // 쿼리 데이터가 바뀔 때만 다시 만든다(옵션 render 노드 포함) — FacetFilter 가 매 렌더 새 배열을 받지 않게.
  const facets: FacetDef[] = useMemo(
    () => [
      {
        key: 'status',
        label: '상태',
        // 이슈 목록 행의 IssueStatusIcon 과 동일한 아이콘을 드롭다운 옵션에 표시해 시각 일관성 확보.
        options: STATUS_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          render: (
            <span className="flex items-center gap-1.5">
              <IssueStatusIcon status={o.value as IssueStatus} decorative />
              {o.label}
            </span>
          ),
        })),
      },
      {
        key: 'priority',
        label: '우선순위',
        // 이슈 목록 행의 IssuePriorityBars 와 동일한 아이콘을 드롭다운 옵션에 표시해 시각 일관성 확보.
        options: PRIORITY_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          render: (
            <span className="flex items-center gap-1.5">
              <IssuePriorityBars priority={o.value as IssuePriority} />
              {o.label}
            </span>
          ),
        })),
      },
      {
        key: 'label',
        label: '라벨',
        // 백엔드가 선택된 라벨을 AND 결합(모두 가진 이슈만)하므로 다른 facet(OR)과 구분 표시 (#626)
        combineMode: 'and',
        options: (labels.data ?? []).map((l) => ({
          value: l.id,
          label: l.name,
          render: (
            <LabelChip label={{ id: l.id, name: l.name, colorToken: l.colorToken }} size="sm" />
          ),
        })),
      },
      // 담당자 facet — 프로젝트 멤버 목록을 옵션으로 사용. (#363)
      {
        key: 'assignee',
        label: '담당자',
        options: (members.data ?? []).map((m) => ({
          value: m.userId,
          label: m.name,
        })),
      } satisfies FacetDef,
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
    ],
    [labels.data, members.data, cycles.data, types.data, showCycle, showType],
  );

  // FilterValue → URL filters. 숫자 facet 값은 number 로 왕복(DOM stringify 금지).
  function onFilterChange(next: FilterValue) {
    writeFilters(
      {
        ...filters,
        statuses: (next.status ?? []) as string[],
        priorities: (next.priority ?? []) as string[],
        labelIds: (next.label ?? []) as number[],
        cycleIds: (next.cycle ?? []) as number[],
        typeIds: (next.type ?? []) as number[],
        // 담당자 필터 — 숫자 id 배열로 왕복. (#363)
        assigneeIds: (next.assignee ?? []) as number[],
      },
      view,
      groupParam,
    );
  }

  // 활성 facet 수(q 제외) — 모바일 필터 버튼 배지용.
  // 담당자 「미지정」(includeUnassigned)은 filterValue 에 안 담기므로 담당자 facet 이 활성인 것으로 한 번만 센다.
  const activeFilterCount =
    Object.entries(filterValue).filter(([k, v]) => (v?.length ?? 0) > 0 || (k === 'assignee' && filters.includeUnassigned)).length;

  // 「완료 모두 보기」 토글 — 데스크톱 버튼과 모바일 뷰 시트가 공유.
  function toggleShowAllClosed() {
    writeFilters({ ...filters, showAllClosed: !filters.showAllClosed }, view, groupParam);
  }

  // facet 값만 비운다 — 모바일 필터 시트 「전체 해제」. 검색어·view·group·에픽 범위는 유지.
  function clearFacets() {
    writeFilters(
      { ...filters, statuses: [], priorities: [], labelIds: [], cycleIds: [], typeIds: [], assigneeIds: [], includeUnassigned: false },
      view,
      groupParam,
    );
  }

  return {
    filters,
    view,
    groupParam,
    groupBy,
    qDraft,
    setQDraft,
    facets,
    filterValue,
    onFilterChange,
    activeFilterCount,
    hasActiveFilters,
    setView,
    setGroupBy,
    visibleGroupOptions,
    reset,
    showClosedToggle,
    closedHidingOverridden,
    toggleShowAllClosed,
    clearFacets,
  };
}

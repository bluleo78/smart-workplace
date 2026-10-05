// 타임라인 필터 로직 훅(WP-197) — 데스크톱 TimelineFilterBar(아바타 스택 + FacetFilter)와 모바일 아젠다 필터 시트가 공유한다.
// URL SearchParams 가 단일 source of truth — IssueFilterBar 와 같이 parseFilters/filtersToParams 를 통과한다(타임라인은 view/group 이 없어 고정값).
import { useSearchParams } from 'react-router-dom';

import type { FacetDef, FilterValue } from '@/components/filter';
import type { MemberResponse } from '@/types/project';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { LabelChip } from '../../../components/labels/LabelChip';
import { useLabels } from '../../../hooks/queries/useLabels';
import { useMilestones } from '../../../hooks/queries/useMilestones';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { filtersToParams, parseFilters } from '../../../lib/issueFilters';
import type { IssueFilters, IssueStatus } from '../../../types/issue';
import type { MobileFilterControls } from '../components/mobile/MobileFilterSheet';

const STATUS_OPTIONS = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

export interface TimelineFilterControls extends MobileFilterControls {
  filters: IssueFilters;
  members: MemberResponse[];
  /** 아바타 스택 클릭 = 담당자 필터 토글(데스크톱). */
  toggleAssignee: (userId: number) => void;
}

/**
 * @param includeAssignee 담당자 facet 포함 — 모바일엔 아바타 스택이 없어 필터 시트에 담당자를 둔다. 데스크톱은 false
 *   (아바타 스택이 담당자 필터의 유일한 쓰기 경로라 facet 중복 노출을 피한다 — #647).
 */
export function useTimelineFilterControls(
  projectKey: string,
  { includeAssignee = false }: { includeAssignee?: boolean } = {},
): TimelineFilterControls {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const labels = useLabels(projectKey);
  const members = useProjectMembers(projectKey);
  const milestones = useMilestones(projectKey);
  // filtersToParams 는 URL 을 새로 만든다 — 타임라인 전용 `period`(WP-247)는 필터 모델 밖이라 이전 값을 옮겨 둔다.
  const write = (next: IssueFilters) =>
    setParams(
      (prev) => {
        const out = filtersToParams(next, 'list', null);
        const period = prev.get('period');
        if (period) out.set('period', period);
        return out;
      },
      { replace: true },
    );

  const facets: FacetDef[] = [
    {
      key: 'status',
      label: '상태',
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
      key: 'label',
      label: '라벨',
      // 백엔드가 선택된 라벨을 AND 결합(모두 가진 이슈만)하므로 다른 facet(OR)과 구분 표시 (#626)
      combineMode: 'and',
      options: (labels.data ?? []).map((l) => ({
        value: l.id,
        label: l.name,
        render: <LabelChip label={{ id: l.id, name: l.name, colorToken: l.colorToken }} size="sm" />,
      })),
    },
    {
      key: 'milestone',
      label: '마일스톤',
      options: (milestones.data ?? []).map((m) => ({ value: m.id, label: m.name })),
    },
    ...(includeAssignee
      ? [{ key: 'assignee', label: '담당자', options: (members.data ?? []).map((m) => ({ value: m.userId, label: m.name })) } satisfies FacetDef]
      : []),
  ];

  const filterValue: FilterValue = {
    status: filters.statuses,
    label: filters.labelIds,
    milestone: filters.milestoneIds,
    ...(includeAssignee ? { assignee: filters.assigneeIds } : {}),
  };

  function onFilterChange(next: FilterValue) {
    write({
      ...filters,
      statuses: (next.status ?? []) as string[],
      labelIds: (next.label ?? []) as number[],
      milestoneIds: (next.milestone ?? []) as number[],
      // 데스크톱은 담당자 facet 이 없으므로 기존 값을 그대로 유지한다(아바타 스택이 유일한 쓰기 경로).
      assigneeIds: includeAssignee ? ((next.assignee ?? []) as number[]) : filters.assigneeIds,
    });
  }

  // 활성 필터 수 — 상태·라벨·마일스톤·담당자(아바타로 건 담당자도 모바일 칩 「필터 N」에 센다).
  const activeFilterCount = [filters.statuses, filters.labelIds, filters.milestoneIds, filters.assigneeIds].filter(
    (v) => v.length > 0,
  ).length;

  // 모바일 필터 시트 「전체 해제」 — 위 4종을 모두 비운다(검색어 등 그 밖의 URL 값은 parseFilters 왕복으로 유지).
  const clearFacets = () =>
    write({ ...filters, statuses: [], labelIds: [], milestoneIds: [], assigneeIds: [], includeUnassigned: false });

  const toggleAssignee = (userId: number) => {
    const cur = filters.assigneeIds;
    write({ ...filters, assigneeIds: cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId] });
  };

  return { filters, facets, filterValue, onFilterChange, activeFilterCount, clearFacets, members: members.data ?? [], toggleAssignee };
}

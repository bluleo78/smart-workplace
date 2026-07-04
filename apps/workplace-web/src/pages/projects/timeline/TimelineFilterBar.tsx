// 타임라인 필터바 — 담당자 아바타 스택 + 상태/라벨/마일스톤 facet 노출 (#638, #647,
// 스펙 docs/superpowers/specs/2026-07-04-project-timeline-design.md).
// URL SearchParams 가 단일 source of truth — IssueFilterBar 와 동일하게 parseFilters/filtersToParams 를 통과한다.
import { useSearchParams } from 'react-router-dom';

import { type FacetDef, FacetFilter, type FilterValue } from '@/components/filter';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { LabelChip } from '../../../components/labels/LabelChip';
import { useLabels } from '../../../hooks/queries/useLabels';
import { useMilestones } from '../../../hooks/queries/useMilestones';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { filtersToParams, parseFilters } from '../../../lib/issueFilters';
import type { IssueStatus } from '../../../types/issue';
import { AssigneeAvatarStack } from './AssigneeAvatarStack';

const STATUS_OPTIONS = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

export function TimelineFilterBar({ projectKey }: { projectKey: string }) {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const labels = useLabels(projectKey);
  const members = useProjectMembers(projectKey);
  const milestones = useMilestones(projectKey);

  // 담당자 facet 은 아바타 스택으로 대체 — 중복 노출 제거 (#647).
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
    {
      key: 'milestone',
      label: '마일스톤',
      options: (milestones.data ?? []).map((m) => ({ value: m.id, label: m.name })),
    },
  ];

  const filterValue: FilterValue = {
    status: filters.statuses,
    label: filters.labelIds,
    milestone: filters.milestoneIds,
  };

  function handleFilterChange(next: FilterValue) {
    // 타임라인은 view/group 개념이 없어 고정값으로 직렬화한다.
    // assigneeIds 는 아바타 스택 토글이 유일한 쓰기 경로이므로 기존 값을 그대로 유지한다.
    setParams(
      filtersToParams(
        {
          ...filters,
          statuses: (next.status ?? []) as string[],
          assigneeIds: filters.assigneeIds,
          labelIds: (next.label ?? []) as number[],
          milestoneIds: (next.milestone ?? []) as number[],
        },
        'list',
        null,
      ),
      { replace: true },
    );
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <AssigneeAvatarStack
        members={members.data ?? []}
        selectedIds={filters.assigneeIds}
        onToggle={(userId) => {
          // 아바타 클릭 = 담당자 필터 토글 — URL SearchParams 단일 소스 유지.
          const cur = filters.assigneeIds;
          const next = cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId];
          setParams(filtersToParams({ ...filters, assigneeIds: next }, 'list', null), { replace: true });
        }}
      />
      <div className="h-5 w-px bg-border" aria-hidden="true" />
      <FacetFilter facets={facets} value={filterValue} onChange={handleFilterChange} />
    </div>
  );
}

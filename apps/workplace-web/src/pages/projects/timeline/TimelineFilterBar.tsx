// 타임라인 필터바 — 상태/담당자/라벨/마일스톤 4종 노출 (#638, 스펙 docs/superpowers/specs/2026-07-04-project-timeline-design.md).
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
      key: 'assignee',
      label: '담당자',
      options: (members.data ?? []).map((m) => ({ value: m.userId, label: m.name })),
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
    assignee: filters.assigneeIds,
    label: filters.labelIds,
    milestone: filters.milestoneIds,
  };

  function handleFilterChange(next: FilterValue) {
    // 타임라인은 view/group 개념이 없어 고정값으로 직렬화한다.
    setParams(
      filtersToParams(
        {
          ...filters,
          statuses: (next.status ?? []) as string[],
          assigneeIds: (next.assignee ?? []) as number[],
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
    <div className="flex items-center gap-2 py-2">
      <FacetFilter facets={facets} value={filterValue} onChange={handleFilterChange} />
    </div>
  );
}

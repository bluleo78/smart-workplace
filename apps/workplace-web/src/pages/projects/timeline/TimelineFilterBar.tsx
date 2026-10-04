// 타임라인 필터바 — 담당자 아바타 스택 + 상태/라벨/마일스톤 facet 노출 (#638, #647,
// 스펙 docs/superpowers/specs/2026-07-04-project-timeline-design.md).
// 로직(URL 왕복·facet 정의)은 useTimelineFilterControls 가 담당 — 모바일 아젠다 필터 시트와 공유(WP-197).
import { FacetFilter } from '@/components/filter';

import { AssigneeAvatarStack } from './AssigneeAvatarStack';
import { useTimelineFilterControls } from './useTimelineFilterControls';

export function TimelineFilterBar({ projectKey }: { projectKey: string }) {
  const t = useTimelineFilterControls(projectKey);
  return (
    <div className="flex items-center gap-3 py-2">
      <AssigneeAvatarStack members={t.members} selectedIds={t.filters.assigneeIds} onToggle={t.toggleAssignee} />
      <div className="h-5 w-px bg-border" aria-hidden="true" />
      <FacetFilter facets={t.facets} value={t.filterValue} onChange={t.onFilterChange} />
    </div>
  );
}

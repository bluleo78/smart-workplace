// 개인 체크리스트 뷰 — 이슈 목록(useIssueSearch) 을 행으로 렌더. 기본 size 100.
import { useIssueSearch } from '@/hooks/queries/useIssueSearch';
import type { IssueFilters } from '@/types/issue';

import { PersonalChecklistRow } from './PersonalChecklistRow';

export function PersonalChecklistView({ projectKey, filters }: { projectKey: string; filters: IssueFilters }) {
  const q = useIssueSearch(projectKey, filters, 100);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  if (q.isLoading) return <p className="text-sm text-muted-foreground">로딩 중…</p>;
  if (q.error) return <p className="text-sm text-destructive">작업을 불러올 수 없습니다</p>;
  if (items.length === 0)
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">작업이 없습니다. + 빠른 추가로 시작하세요.</p>
    );

  return (
    <div className="space-y-0.5" data-testid="personal-checklist">
      {items.map((it) => (
        <PersonalChecklistRow key={it.id} projectKey={projectKey} issue={it} />
      ))}
    </div>
  );
}

// 개인 체크리스트 뷰 — 마감 기준 섹션(지남/오늘/이번 주/예정/없음) + 완료(접힘) 하단. 최대폭 제한.
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { useIssueSearch } from '@/hooks/queries/useIssueSearch';
import { cn } from '@/lib/utils';
import type { IssueFilters } from '@/types/issue';

import { PersonalChecklistRow } from './PersonalChecklistRow';
import { groupByDue } from './personalGrouping';

export function PersonalChecklistView({ projectKey, filters }: { projectKey: string; filters: IssueFilters }) {
  const q = useIssueSearch(projectKey, filters, 100);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const [showDone, setShowDone] = useState(false);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">로딩 중…</p>;
  if (q.error) return <p className="text-sm text-destructive">작업을 불러올 수 없습니다</p>;
  if (items.length === 0)
    return <p className="py-12 text-center text-sm text-muted-foreground">작업이 없습니다. + 빠른 추가로 시작하세요.</p>;

  const { active, done } = groupByDue(items);
  // 전부 CANCELED 등으로 활성·완료 모두 비면 백지 대신 빈 상태 안내.
  if (active.length === 0 && done.length === 0)
    return <p className="py-12 text-center text-sm text-muted-foreground">표시할 작업이 없습니다.</p>;

  return (
    <div className="space-y-5" data-testid="personal-checklist">
      {active.map((g) => (
        <section key={g.key} data-testid={`personal-section-${g.key}`}>
          <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.label} <span className="ml-1 text-muted-foreground/60">{g.items.length}</span>
          </h3>
          <div className="space-y-0.5">
            {g.items.map((it) => <PersonalChecklistRow key={it.id} projectKey={projectKey} issue={it} />)}
          </div>
        </section>
      ))}
      {done.length > 0 && (
        <section data-testid="personal-section-done">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="flex items-center gap-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showDone && 'rotate-90')} />
            완료 <span className="text-muted-foreground/60">{done.length}</span>
          </button>
          {showDone && (
            <div className="mt-1 space-y-0.5">
              {done.map((it) => <PersonalChecklistRow key={it.id} projectKey={projectKey} issue={it} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

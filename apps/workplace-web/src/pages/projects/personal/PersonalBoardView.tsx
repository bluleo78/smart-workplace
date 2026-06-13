// 개인 보드 뷰 — 상태 기준 3컬럼 고정(할일/진행/완료). CANCELED 는 개인 화면에서 표시하지 않음.
import { useSearchParams } from 'react-router-dom';

import { useIssueSearch } from '@/hooks/queries/useIssueSearch';
import { cn } from '@/lib/utils';
import type { IssueFilters, IssueResponse, IssueStatus } from '@/types/issue';

import { AiDelegationBadge } from './aiDelegation';

const COLUMNS: { status: Extract<IssueStatus, 'TODO' | 'IN_PROGRESS' | 'DONE'>; label: string }[] = [
  { status: 'TODO', label: '할 일' },
  { status: 'IN_PROGRESS', label: '진행 중' },
  { status: 'DONE', label: '완료' },
];

export function PersonalBoardView({ projectKey, filters }: { projectKey: string; filters: IssueFilters }) {
  const [, setParams] = useSearchParams();
  const q = useIssueSearch(projectKey, filters, 100);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  // 카드 클릭 → 우측 패널(Task 5). ?task=N 설정.
  const openPanel = (n: number) =>
    setParams((p) => { const x = new URLSearchParams(p); x.set('task', String(n)); return x; }, { replace: true });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">로딩 중…</p>;
  if (q.error) return <p className="text-sm text-destructive">작업을 불러올 수 없습니다</p>;

  const byStatus = (s: IssueStatus) => items.filter((it) => it.status === s);

  return (
    <div className="flex gap-4" data-testid="personal-board">
      {COLUMNS.map((col) => (
        <div key={col.status} data-testid={`personal-board-col-${col.status}`} className="flex-1">
          <div className="mb-2 text-xs font-medium text-muted-foreground">{col.label}</div>
          <div className="space-y-2">
            {byStatus(col.status).map((it) => (
              <PersonalBoardCard key={it.id} issue={it} onOpen={() => openPanel(it.number)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// 보드 카드 — 제목 + AI 배지. 클릭 시 패널 오픈.
function PersonalBoardCard({ issue, onOpen }: { issue: IssueResponse; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-testid={`personal-board-card-${issue.number}`}
      className={cn('w-full rounded-md border bg-card p-3 text-left text-sm hover:border-primary/40')}>
      <div className="truncate">{issue.title}</div>
      <div className="mt-1"><AiDelegationBadge issue={issue} /></div>
    </button>
  );
}
